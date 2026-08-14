/**
 * dsh-token-stats — 客户端插件（AMD bundle，由前端 /plugins/dsh-token-stats/client.js 加载）。
 *
 * 挂载点：
 *  - sidebar.footer.action —— 侧边栏底部"用量宠物"开关（v0.6.0）：显示/隐藏悬浮宠物，
 *    不再常驻显示数字
 *  - shell.overlay —— 浮动"用量宠物"（v0.6.0 / 实时活动 v0.7.0）：可拖拽史莱姆
 *    （纯 CSS/SVG 绘制，无图片资源）。情绪 = 实时工作状态 + 今日用量：
 *    正在工作（服务端 activity 2.5s 轮询）→ 专注盯小电脑 + 右上角脉冲点；
 *    空闲 → 打瞌睡（0 请求）/ 休息眯眼 / 冒汗 / 晕眩。多任务或子代理每完成一个
 *    弹"✅ 任务完成"提示 + 扩散光环，全部收工弹"💤 收工啦"。悬停吐泡泡看一行
 *    摘要，点击弹出今日汇总面板（计费输入/输出/请求 + 7 天迷你柱状图），
 *    位置与可见性持久化 localStorage
 *  - settings.section —— 设置页"用量统计"分区（克制数据面板 v0.3.1）：
 *      无卡片盒子：一个主数字（计费输入）+ 三个次级数字，靠留白分隔
 *      + 一行次要指标（命中率/均值）+ 一行对账（顶层 ＋ 子代理 ＝ 总计）
 *      + 模型明细表（发丝分隔线、数字右对齐等宽、细占比条）
 *      + 会话明细表（顶层 / 子代理分组，子代理标注父会话）
 *      + 最近 7 天迷你柱状图（带图例）与逐日表
 *
 * 数据：同源 fetch /token-stats/summary、/token-stats/history 与
 * /token-stats/sessions（由服务端插件提供），每 30s 轮询 + 窗口聚焦/可见时刷新。
 *
 * 样式：全部 inline style，复用宿主 CSS 变量（--dsw-alias-* / --dsw-font-mono），
 * 深浅色主题自动适配；数字用等宽字体 tabular-nums 对齐。
 */

// ── 类型 ──────────────────────────────────────────────────────────────

/** 宿主模块加载器（AMD bundle 入口）。 */
interface Window {
	__ModuleLoader__: { load(mod: { id: string; factory: (require: (id: string) => any) => unknown }): void };
}

/** 统计桶形状（summary/history 共用）。 */
interface StatsLike {
	requests: number;
	inputTokens: number;
	cacheReadTokens: number;
	cacheWriteTokens: number;
	outputTokens: number;
	reasoningTokens: number;
}

/** 一次完成的模型调用（服务端实时推送）。 */
interface ActivityCompletion {
	at: number;
	sessionId: string;
	subagent: boolean;
	billedInput: number;
	outputTokens: number;
}

/** summary 附带的实时活动信息。 */
interface ActivityData {
	lastAt: number;
	completions: ActivityCompletion[];
}

interface SummaryData {
	day: string;
	total: StatsLike;
	providers: Record<string, { total: StatsLike; models: Record<string, StatsLike> }>;
	activity?: ActivityData;
}

interface HistoryData {
	days: { day: string; total: StatsLike }[];
}

interface SessionRow {
	id: string;
	parent: string | null;
	subagent: boolean;
	requests: number;
	inputTokens: number;
	cacheReadTokens: number;
	cacheWriteTokens: number;
	outputTokens: number;
	reasoningTokens: number;
	lastAt: number;
}

interface SessionsData {
	day: string;
	sessions: SessionRow[];
}

/** slot 上下文（仅用到 effect/slots 两个面）。 */
interface SlotCtx {
	effect(fn: () => unknown, label?: string): unknown;
	slots: {
		inject(name: string, fn: () => unknown): unknown;
		register(def: Record<string, unknown>, component: unknown): unknown;
	};
}

window.__ModuleLoader__.load({
	id: "dsh-token-stats",
	factory: (require: (id: string) => any) => {
		var module: { exports: Record<string, unknown> } = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react_jsx_runtime = require("react/jsx-runtime");
		let react = require("react") as typeof import("react");

		// ── 工具 ─────────────────────────────────────────────────────────────
		/** 完整数字（千分位），用于表格与提示。 */
		const fmt = (n: number | string | null | undefined): string => Number(n || 0).toLocaleString("zh-CN");

		/** k/m/b 缩写，1 位小数：1234 → 1.2k，58000000 → 58.0M；千以下保留至多 1 位小数。 */
		const fmtCompact = (n: number | string | null | undefined): string => {
			const v = Number(n || 0);
			if (Math.abs(v) >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
			if (Math.abs(v) >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
			if (Math.abs(v) >= 1e3) return `${(v / 1e3).toFixed(1)}k`;
			return Number.isInteger(v) ? String(v) : String(Math.round(v * 10) / 10);
		};

		const pct = (part: number, whole: number): number => (whole > 0 ? (part / whole) * 100 : 0);

		const todayKey = (): string => {
			const d = new Date();
			return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
		};

		const fetchJson = async (url: string): Promise<any> => {
			const res = await fetch(url, { cache: "no-store" });
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			return res.json();
		};

		/** 轮询 + 聚焦刷新的数据钩子。 */
		const useStats = (
			intervalMs = 30000
		): {
			summary: SummaryData | null;
			history: HistoryData | null;
			sessions: SessionsData | null;
			error: string | null;
		} => {
			const [summary, setSummary] = react.useState<SummaryData | null>(null);
			const [history, setHistory] = react.useState<HistoryData | null>(null);
			const [sessions, setSessions] = react.useState<SessionsData | null>(null);
			const [error, setError] = react.useState<string | null>(null);
			const load = react.useCallback(() => {
				fetchJson(`/token-stats/summary?day=${todayKey()}`)
					.then((data: SummaryData) => {
						setSummary(data);
						setError(null);
					})
					.catch((e: unknown) => setError(String(e && typeof e === "object" && "message" in e ? (e as { message: unknown }).message : e)));
				fetchJson("/token-stats/history?days=7")
					.then(setHistory)
					.catch(() => {});
				fetchJson(`/token-stats/sessions?day=${todayKey()}`)
					.then(setSessions)
					.catch(() => {});
			}, []);
			react.useEffect(() => {
				load();
				const timer = setInterval(load, intervalMs);
				const onVisibility = () => {
					if (document.visibilityState === "visible") load();
				};
				document.addEventListener("visibilitychange", onVisibility);
				window.addEventListener("focus", load);
				return () => {
					clearInterval(timer);
					document.removeEventListener("visibilitychange", onVisibility);
					window.removeEventListener("focus", load);
				};
			}, [load, intervalMs]);
			return { summary, history, sessions, error };
		};

		/**
		 * 实时活动钩子：每 intervalMs 拉一次 summary（轻量），供"工作/休息/完成"
		 * 状态机使用。返回值：
		 *  - summary：最新汇总（含 activity）
		 *  - working：lastAt 距今 < workingWindowMs 视为工作中
		 *  - flash：上次轮询以来新完成的调用（合并），null = 无
		 */
		const useActivity = (
			intervalMs = 2500,
			workingWindowMs = 15000
		): { summary: SummaryData | null; working: boolean; flash: ActivityFlash | null; error: string | null } => {
			const [summary, setSummary] = react.useState<SummaryData | null>(null);
			const [working, setWorking] = react.useState(false);
			const [flash, setFlash] = react.useState<ActivityFlash | null>(null);
			const [error, setError] = react.useState<string | null>(null);
			const lastSeenAt = react.useRef(Date.now());
			const flashTimer = react.useRef<ReturnType<typeof setTimeout> | null>(null);

			react.useEffect(() => {
				const tick = () => {
					fetchJson(`/token-stats/summary?day=${todayKey()}`)
						.then((data: SummaryData) => {
							setSummary(data);
							setError(null);
							const act = data.activity;
							if (!act) return;
							const now = Date.now();
							setWorking(act.lastAt > 0 && now - act.lastAt < workingWindowMs);
							// 收集上次轮询以来新完成的调用（忽略挂载前的历史）
							const fresh = act.completions.filter((c) => c.at > lastSeenAt.current);
							if (fresh.length > 0) {
								lastSeenAt.current = Math.max(...fresh.map((c) => c.at));
								const billed = fresh.reduce((a, c) => a + c.billedInput, 0);
								const last = fresh[fresh.length - 1];
								setFlash({
									id: Date.now(),
									count: fresh.length,
									billed,
									sessionId: fresh.length === 1 ? last.sessionId : "",
									subagent: fresh.length === 1 ? last.subagent : false,
									outputTokens: fresh.reduce((a, c) => a + c.outputTokens, 0)
								});
								if (flashTimer.current) clearTimeout(flashTimer.current);
								flashTimer.current = setTimeout(() => setFlash(null), 4000);
							}
						})
						.catch((e: unknown) =>
							setError(String(e && typeof e === "object" && "message" in e ? (e as { message: unknown }).message : e))
						);
				};
				tick();
				const timer = setInterval(tick, intervalMs);
				const onVisibility = () => {
					if (document.visibilityState === "visible") tick();
				};
				document.addEventListener("visibilitychange", onVisibility);
				window.addEventListener("focus", tick);
				return () => {
					clearInterval(timer);
					if (flashTimer.current) clearTimeout(flashTimer.current);
					document.removeEventListener("visibilitychange", onVisibility);
					window.removeEventListener("focus", tick);
				};
			}, [intervalMs, workingWindowMs]);
			return { summary, working, flash, error };
		};

		/** 一次"完成"提示的内容。 */
		interface ActivityFlash {
			id: number;
			count: number;
			billed: number;
			sessionId: string;
			subagent: boolean;
			outputTokens: number;
		}

		/** 注入一次关键帧动画样式（幂等）。 */
		const injectKeyframes = (): void => {
			if (document.getElementById("dsh-token-stats-keyframes")) return;
			const style = document.createElement("style");
			style.id = "dsh-token-stats-keyframes";
			style.textContent = `
				@keyframes dts-pulse { 0%,100% { opacity:1; transform:scale(1); } 50% { opacity:.4; transform:scale(.75); } }
				@keyframes dts-breath { 0%,100% { opacity:.3; } 50% { opacity:.7; } }
				@keyframes dts-ring { 0% { transform:scale(.6); opacity:.9; } 100% { transform:scale(2.6); opacity:0; } }
				@keyframes dts-pop { 0% { opacity:0; transform:translateY(3px); } 15% { opacity:1; transform:translateY(0); } 80% { opacity:1; } 100% { opacity:0; } }
			`;
			document.head.appendChild(style);
		};

		const billedInput = (stats: StatsLike | null | undefined): number =>
			stats ? stats.inputTokens + stats.cacheReadTokens + stats.cacheWriteTokens : 0;

		// ── 样式令牌（复用宿主 CSS 变量，带回退值） ──────────────────────────
		const STYLE = {
			labelPrimary: "var(--dsw-alias-label-primary, #1f2329)",
			labelSecondary: "var(--dsw-alias-label-secondary, #646a73)",
			labelTertiary: "var(--dsw-alias-label-tertiary, #8a919f)",
			borderL1: "var(--dsw-alias-border-l1, rgba(128,128,128,.14))",
			borderL2: "var(--dsw-alias-border-l2, rgba(128,128,128,.25))",
			surfaceL1: "var(--dsw-alias-bg-layer-1, rgba(128,128,128,.05))",
			surfaceL2: "var(--dsw-alias-bg-layer-2, rgba(128,128,128,.09))",
			fillHover: "var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.12))",
			accent: "var(--dsw-alias-accent, #3370ff)",
			mono: "var(--dsw-font-mono, ui-monospace, SFMono-Regular, Consolas, 'Courier New', monospace)"
		};
		/** 数字样式：等宽 + 表格数字对齐。 */
		const NUM = { fontFamily: STYLE.mono, fontVariantNumeric: "tabular-nums" };

		// ── 用量宠物：共享状态（sidebar 开关与悬浮宠物同步，持久化 localStorage） ──
		const LS_PET_VISIBLE = "dsh-token-stats.pet.visible";
		const LS_PET_POS = "dsh-token-stats.pet.pos";

		/** 宠物渲染尺寸（px）。 */
		const PET_SIZE = 56;

		/** 情绪阈值：今日计费输入达到该值切换情绪。 */
		const MOOD_BUSY_AT = 100_000;
		const MOOD_DIZZY_AT = 300_000;

		type Mood = "sleepy" | "rest" | "busy" | "dizzy" | "working" | "happy";

		/**
		 * 按实时工作状态 + 今日数据推断情绪（数据即状态：不用打开任何东西就能感知
		 * 用量与是否在工作）。正在工作 → working；否则按今日用量：0 请求 → 打瞌睡、
		 * 轻用量 → 休息、重用量 → 冒汗 / 晕眩。
		 */
		const moodOf = (total: StatsLike | null, working: boolean): Mood => {
			if (working) return "working";
			if (!total || total.requests <= 0) return "sleepy";
			const billed = billedInput(total);
			if (billed >= MOOD_DIZZY_AT) return "dizzy";
			if (billed >= MOOD_BUSY_AT) return "busy";
			return "rest";
		};

		// 模块级宠物状态：两个挂载点共享；useSyncExternalStore 订阅（快照为字符串）。
		let petVisible = true;
		let petPos: { x: number; y: number } | null = null;
		let petSnap = "";
		const petListeners = new Set<() => void>();
		const petSnapshot = (): string =>
			`${petVisible ? "1" : "0"}|${petPos ? `${Math.round(petPos.x)},${Math.round(petPos.y)}` : ""}`;
		const petEmit = (): void => {
			petSnap = petSnapshot();
			for (const cb of petListeners) cb();
		};
		const petInit = (): void => {
			try {
				petVisible = localStorage.getItem(LS_PET_VISIBLE) !== "0";
				const raw = localStorage.getItem(LS_PET_POS);
				if (raw) {
					const p = JSON.parse(raw);
					if (p && typeof p === "object" && typeof p.x === "number" && typeof p.y === "number") {
						petPos = { x: p.x, y: p.y };
					}
				}
			} catch {
				// localStorage 不可用：保持默认
			}
			petSnap = petSnapshot();
		};
		const petSubscribe = (cb: () => void): (() => void) => {
			petListeners.add(cb);
			return () => {
				petListeners.delete(cb);
			};
		};
		const petGetSnapshot = (): string => petSnap;
		const petSetVisible = (v: boolean): void => {
			if (v === petVisible) return;
			petVisible = v;
			try {
				localStorage.setItem(LS_PET_VISIBLE, v ? "1" : "0");
			} catch {
				// ignore
			}
			petEmit();
		};
		const petSetPos = (p: { x: number; y: number } | null): void => {
			petPos = p;
			try {
				if (p) localStorage.setItem(LS_PET_POS, JSON.stringify(p));
				else localStorage.removeItem(LS_PET_POS);
			} catch {
				// ignore
			}
			petEmit();
		};
		petInit();

		/** 宠物动画 CSS（纯 keyframes，随组件注入一次）。 */
		const PET_CSS = `
.ts-pet-breathe { animation: ts-pet-breathe 3.2s ease-in-out infinite; transform-box: fill-box; transform-origin: 50% 100%; }
@keyframes ts-pet-breathe { 0%, 100% { transform: scale(1, 1); } 50% { transform: scale(1.05, 0.96); } }
.ts-pet-eye { animation: ts-pet-blink 4.6s ease-in-out infinite; transform-box: fill-box; transform-origin: center; }
@keyframes ts-pet-blink { 0%, 90%, 100% { transform: scaleY(1); } 93%, 96% { transform: scaleY(0.08); } }
.ts-pet-sprout { animation: ts-pet-sway 4s ease-in-out infinite; transform-box: fill-box; transform-origin: 50% 100%; }
@keyframes ts-pet-sway { 0%, 100% { transform: rotate(-7deg); } 50% { transform: rotate(7deg); } }
.ts-pet-sweat { animation: ts-pet-sweatfall 1.5s linear infinite; transform-box: fill-box; }
@keyframes ts-pet-sweatfall { 0% { transform: translateY(2px); opacity: 0; } 20% { opacity: 1; } 100% { transform: translateY(14px); opacity: 0; } }
.ts-pet-zzz { animation: ts-pet-zzz 2.2s ease-out infinite; transform-box: fill-box; }
@keyframes ts-pet-zzz { 0% { transform: translate(0, 0) scale(0.6); opacity: 0; } 30% { opacity: 0.9; } 100% { transform: translate(7px, -13px) scale(1.2); opacity: 0; } }
.ts-pet-bounce { animation: ts-pet-bounce 0.45s ease; transform-box: fill-box; }
@keyframes ts-pet-bounce { 0% { transform: translateY(0); } 40% { transform: translateY(-12px); } 70% { transform: translateY(0) scale(1.06, 0.92); } 100% { transform: translateY(0); } }
.ts-pet-work { animation: ts-pet-work 0.5s ease-in-out infinite; }
@keyframes ts-pet-work { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-3px); } }
`;

		/** 史莱姆 SVG（纯 CSS/SVG 绘制，无图片资源；mood 决定表情，bounceKey 触发跳跃）。 */
		function SlimeSvg(props: { size: number; mood: Mood; bounceKey?: number }) {
			const { size, mood, bounceKey } = props;
			const eye = STYLE.labelPrimary;
			const blush = "rgba(255, 110, 130, 0.5)";
			const stroke = { fill: "none", stroke: eye, strokeWidth: 2.4, strokeLinecap: "round" as const };
			const face = (() => {
				if (mood === "sleepy") {
					return [
						react.createElement("path", { key: "e1", d: "M20 35 Q23.5 31.5 27 35", ...stroke }),
						react.createElement("path", { key: "e2", d: "M37 35 Q40.5 31.5 44 35", ...stroke }),
						react.createElement("circle", { key: "m", cx: 32, cy: 45, r: 2, fill: eye }),
						react.createElement("text", { key: "z1", x: 40, y: 15, fontSize: 9, fontWeight: 700, fill: STYLE.labelTertiary, className: "ts-pet-zzz" }, "z"),
						react.createElement("text", { key: "z2", x: 47, y: 6, fontSize: 6.5, fontWeight: 700, fill: STYLE.labelTertiary, className: "ts-pet-zzz", style: { animationDelay: "1.1s" } }, "z")
					];
				}
				if (mood === "busy") {
					return [
						react.createElement("path", { key: "e1", d: "M20.5 31.5 L26.5 37.5 M26.5 31.5 L20.5 37.5", ...stroke }),
						react.createElement("path", { key: "e2", d: "M37.5 31.5 L43.5 37.5 M43.5 31.5 L37.5 37.5", ...stroke }),
						react.createElement("path", { key: "m", d: "M26 46 Q32 49 38 46", ...stroke, strokeWidth: 2.2 }),
						react.createElement("path", { key: "s", d: "M49 14 C 52 19, 52 22.5, 49 24.5 C 46 22.5, 46 19, 49 14 Z", fill: "#8fd8ff", className: "ts-pet-sweat" })
					];
				}
				if (mood === "dizzy") {
					return [
						react.createElement("path", { key: "e1", d: "M20.5 31.5 L26.5 37.5 M26.5 31.5 L20.5 37.5", ...stroke }),
						react.createElement("path", { key: "e2", d: "M37.5 31.5 L43.5 37.5 M43.5 31.5 L37.5 37.5", ...stroke }),
						react.createElement("path", { key: "m", d: "M24 47 Q28 44.5 32 47 Q36 49.5 40 47", ...stroke, strokeWidth: 2.2 }),
						react.createElement("text", { key: "s", x: 12, y: 13, fontSize: 8, fill: STYLE.labelTertiary, className: "ts-pet-zzz" }, "★")
					];
				}
				if (mood === "working") {
					return [
						// 专注眼（圆眼 + 眉毛）+ 抿嘴
						react.createElement("circle", { key: "e1", cx: 23.5, cy: 33.5, r: 3.2, fill: eye }),
						react.createElement("circle", { key: "e2", cx: 40.5, cy: 33.5, r: 3.2, fill: eye }),
						react.createElement("path", { key: "b1", d: "M20 27.5 L26.5 30.5", ...stroke, strokeWidth: 2 }),
						react.createElement("path", { key: "b2", d: "M37.5 30.5 L44 27.5", ...stroke, strokeWidth: 2 }),
						react.createElement("path", { key: "m", d: "M29 45.5 L35 45.5", ...stroke, strokeWidth: 2.2 })
					];
				}
				if (mood === "rest") {
					return [
						// 眯眼微笑（干完活的休息态）
						react.createElement("path", { key: "e1", d: "M20 35 Q23.5 31.5 27 35", ...stroke }),
						react.createElement("path", { key: "e2", d: "M37 35 Q40.5 31.5 44 35", ...stroke }),
						react.createElement("path", { key: "m", d: "M27 44 Q32 48 37 44", ...stroke }),
						react.createElement("ellipse", { key: "c1", cx: 17, cy: 42.5, rx: 3.4, ry: 2.1, fill: blush }),
						react.createElement("ellipse", { key: "c2", cx: 47, cy: 42.5, rx: 3.4, ry: 2.1, fill: blush })
					];
				}
				return [
					react.createElement("circle", { key: "e1", cx: 23.5, cy: 34.5, r: 3.4, fill: eye, className: "ts-pet-eye" }),
					react.createElement("circle", { key: "e2", cx: 40.5, cy: 34.5, r: 3.4, fill: eye, className: "ts-pet-eye" }),
					react.createElement("path", { key: "m", d: "M26 44 Q32 49.5 38 44", ...stroke }),
					react.createElement("ellipse", { key: "c1", cx: 17, cy: 42.5, rx: 3.4, ry: 2.1, fill: blush }),
					react.createElement("ellipse", { key: "c2", cx: 47, cy: 42.5, rx: 3.4, ry: 2.1, fill: blush })
				];
			})();

			return react.createElement(
				"svg",
				{
					key: bounceKey ? `b${bounceKey}` : undefined,
					width: size,
					height: size,
					viewBox: "0 0 64 64",
					"aria-hidden": true,
					className: bounceKey ? "ts-pet-bounce" : mood === "working" ? "ts-pet-work" : undefined,
					style: { display: "block", overflow: "visible" }
				},
				[
					react.createElement(
						"g",
						{ key: "sprout", className: "ts-pet-sprout" },
						[
							react.createElement("path", { key: "stem", d: "M32 9 C 32 5, 33.5 3, 36 1.5", fill: "none", stroke: STYLE.labelTertiary, strokeWidth: 2, strokeLinecap: "round" }),
							react.createElement("ellipse", { key: "leaf", cx: 38.5, cy: 1.5, rx: 4.6, ry: 2.8, fill: STYLE.accent, opacity: 0.75, transform: "rotate(-14 38.5 1.5)" })
						]
					),
					react.createElement(
						"g",
						{ key: "body", className: "ts-pet-breathe" },
						[
							react.createElement("path", {
								key: "blob",
								d: "M32 7.5 C 45 7.5, 56 20, 56 36 C 56 48, 49 56.5, 40 56.5 L 24 56.5 C 15 56.5, 8 48, 8 36 C 8 20, 19 7.5, 32 7.5 Z",
								fill: STYLE.accent
							}),
							react.createElement("ellipse", { key: "hl", cx: 21, cy: 19, rx: 7.5, ry: 4.6, fill: "#ffffff", opacity: 0.28, transform: "rotate(-18 21 19)" })
						]
					),
					// 工作时面前的小电脑（进度条 + 键盘底座）
					mood === "working"
						? react.createElement(
								"g",
								{ key: "laptop", className: "ts-pet-laptop" },
								[
									react.createElement("rect", { key: "screen", x: 16, y: 39, width: 32, height: 12, rx: 2, fill: STYLE.labelTertiary, opacity: 0.3 }),
									react.createElement("rect", { key: "prog", x: 18, y: 43.5, width: 14, height: 3, rx: 1.5, fill: STYLE.accent }),
									react.createElement("rect", { key: "base", x: 13, y: 50, width: 38, height: 6, rx: 3, fill: STYLE.labelTertiary, opacity: 0.45 })
								]
							)
						: null,
					react.createElement("g", { key: "face" }, face)
				]
			);
		}

		// ── 侧边栏小部件（显示/隐藏宠物开关） ────────────────────────────────
		function PetToggleWidget(props: Record<string, unknown>) {
			const snap = react.useSyncExternalStore(petSubscribe, petGetSnapshot);
			const visible = snap.charAt(0) === "1";
			return react.createElement(
				"button",
				{
					type: "button",
					onClick: () => petSetVisible(!visible),
					title: visible ? "隐藏用量宠物（悬浮史莱姆）" : "显示用量宠物（悬浮史莱姆）",
					style: {
						display: "flex",
						alignItems: "center",
						gap: 6,
						background: "none",
						border: "none",
						padding: "4px 8px",
						borderRadius: 6,
						cursor: "pointer",
						color: STYLE.labelPrimary,
						fontSize: 12,
						fontFamily: "inherit",
						textAlign: "left"
					},
					onMouseEnter: (e: { currentTarget: HTMLElement }) => (e.currentTarget.style.background = STYLE.fillHover),
					onMouseLeave: (e: { currentTarget: HTMLElement }) => (e.currentTarget.style.background = "none")
				},
				[
					react.createElement(
						"span",
						{ key: "icon", style: { display: "flex", flex: "none", opacity: visible ? 1 : 0.45 } },
						react.createElement(SlimeSvg, { size: 16, mood: "happy" })
					),
					react.createElement("span", { key: "text", style: { color: visible ? STYLE.labelPrimary : STYLE.labelTertiary } }, visible ? "隐藏宠物" : "显示宠物")
				]
			);
		}

		// ── 设置页通用小块 ──────────────────────────────────────────────────
		/** 分区标题：小字号次级色，靠留白分段，不用盒子。 */
		const sectionTitle = (text: string) =>
			react.createElement(
				"div",
				{ style: { margin: "30px 0 10px", fontSize: 13, fontWeight: 600, letterSpacing: "0.02em", color: STYLE.labelSecondary } },
				text
			);

		/** 头部统计组：小标签在上、数字在下，无边框，靠留白分隔。 */
		const statGroup = (label: string, value: string, opts: { size?: number; weight?: number } = {}) =>
			react.createElement(
				"div",
				{ key: label, style: { display: "flex", flexDirection: "column", gap: 2, minWidth: 0 } },
				[
					react.createElement(
						"div",
						{ key: "l", style: { fontSize: 11, letterSpacing: "0.06em", color: STYLE.labelTertiary, whiteSpace: "nowrap" } },
						label
					),
					react.createElement(
						"div",
						{
							key: "v",
							style: {
								fontSize: opts.size || 16,
								fontWeight: opts.weight || 500,
								color: STYLE.labelPrimary,
								...NUM,
								lineHeight: 1.25,
								whiteSpace: "nowrap"
							}
						},
						value
					)
				]
			);

		/** 占比条：轨道 + 填充（0~1），细而低调。 */
		const shareBar = (ratio: number) =>
			react.createElement(
				"div",
				{
					style: {
						width: 44,
						height: 4,
						borderRadius: 2,
						background: STYLE.surfaceL2,
						overflow: "hidden",
						flex: "none"
					}
				},
				react.createElement("div", {
					style: {
						width: `${Math.max(0, Math.min(100, ratio * 100))}%`,
						height: "100%",
						borderRadius: 2,
						background: STYLE.accent,
						opacity: 0.8
					}
				})
			);

		/** 表格行 hover 高亮。 */
		const rowHover = {
			onMouseEnter: (e: { currentTarget: HTMLElement }) => (e.currentTarget.style.background = STYLE.fillHover),
			onMouseLeave: (e: { currentTarget: HTMLElement }) => (e.currentTarget.style.background = "none")
		};

		// ── 悬浮用量宠物（shell.overlay） ────────────────────────────────────
		/** 拖拽起点（用于区分点击与拖拽）。 */
		type DragStart = { startX: number; startY: number; moved: boolean };

		function TokenStatsPet(props: Record<string, unknown>) {
			const snap = react.useSyncExternalStore(petSubscribe, petGetSnapshot);
			const [open, setOpen] = react.useState(false);
			const [hover, setHover] = react.useState(false);
			const [dragPos, setDragPos] = react.useState<{ x: number; y: number } | null>(null);
			const [dragging, setDragging] = react.useState(false);
			const [bounceKey, setBounceKey] = react.useState(0);
			const petRef = react.useRef<HTMLButtonElement | null>(null);
			const popRef = react.useRef<HTMLDivElement | null>(null);
			// 实时活动（2.5s 轮询 summary 附带 activity）+ 低频历史/会话数据
			const { summary, working, flash, error } = useActivity(2500, 15000);
			const { history } = useStats(30000);

			const parsed = react.useMemo(() => {
				const i = snap.indexOf("|");
				const vis = snap.slice(0, i) === "1";
				const raw = snap.slice(i + 1);
				const pos = raw && raw.length > 0 ? raw.split(",").map(Number) : null;
				return { visible: vis, pos: pos && pos.length === 2 ? { x: pos[0], y: pos[1] } : null };
			}, [snap]);

			/** 当前位置：拖拽中优先，否则持久化位置，都没有则默认右下角。 */
			const pos = react.useMemo(() => {
				const base = dragPos || parsed.pos;
				if (base) return base;
				return { x: Math.max(8, window.innerWidth - PET_SIZE - 24), y: Math.max(8, window.innerHeight - PET_SIZE - 24) };
			}, [dragPos, parsed.pos]);

			const total = summary ? summary.total : null;
			const mood = moodOf(total, working);
			const billedTotal = billedInput(total);
			const hitRate = pct(total ? total.cacheReadTokens : 0, billedTotal);
			const today = summary ? summary.day : todayKey();

			// ── 实时活动接入：工作脉冲点 / 完成提示 / 收工提示 ────────────────
			react.useEffect(() => injectKeyframes(), []);

			/** 收工提示（本段工作中出现过子代理/并发完成才显示）。 */
			const [restFlash, setRestFlash] = react.useState<ActivityFlash | null>(null);
			const restTimer = react.useRef<ReturnType<typeof setTimeout> | null>(null);
			const prevWorking = react.useRef(false);
			const sawMultiEpisode = react.useRef(false);

			// 完成提示：仅"多任务/子代理完成"时蹦一下（普通单会话回复不打扰）；
			// 同时维护"本段工作出现过多任务"标志 —— 收工提示只在多任务段落结束后出现。
			// 注意：flash 与 working 可能在同一提交到达，标志的置位/复位必须同源，
			// 避免"开工时复位把同提交的置位踩掉"的竞态。
			react.useEffect(() => {
				const isMulti = !!(flash && (flash.subagent || flash.count > 1));
				if (isMulti) {
					sawMultiEpisode.current = true;
					setBounceKey((k) => k + 1);
				}
				if (working && !prevWorking.current && !isMulti) sawMultiEpisode.current = false;
				if (prevWorking.current && !working && sawMultiEpisode.current) {
					sawMultiEpisode.current = false;
					setRestFlash({
						id: Date.now(),
						count: 0,
						billed: billedTotal,
						sessionId: "",
						subagent: false,
						outputTokens: 0
					});
					if (restTimer.current) clearTimeout(restTimer.current);
					restTimer.current = setTimeout(() => setRestFlash(null), 4000);
					setBounceKey((k) => k + 1);
				}
				prevWorking.current = working;
			}, [working, flash, billedTotal]);
			react.useEffect(() => {
				return () => {
					if (restTimer.current) clearTimeout(restTimer.current);
				};
			}, []);

			/** 是否有需要展示的完成/收工提示。 */
			const toastActive = !!(restFlash || (flash && (flash.subagent || flash.count > 1)));

			// 点击外部 / Escape 关闭面板
			react.useEffect(() => {
				if (!open) return;
				const onDown = (e: PointerEvent) => {
					const t = e.target as Node | null;
					if (!t) return;
					if (petRef.current && petRef.current.contains(t)) return;
					if (popRef.current && popRef.current.contains(t)) return;
					setOpen(false);
				};
				const onKey = (e: KeyboardEvent) => {
					if (e.key === "Escape") setOpen(false);
				};
				document.addEventListener("pointerdown", onDown);
				document.addEventListener("keydown", onKey);
				return () => {
					document.removeEventListener("pointerdown", onDown);
					document.removeEventListener("keydown", onKey);
				};
			}, [open]);

			// 窗口尺寸变化时把位置拉回可视区
			react.useEffect(() => {
				const onResize = () => {
					if (!parsed.pos) return;
					const nx = Math.max(0, Math.min(window.innerWidth - PET_SIZE, parsed.pos.x));
					const ny = Math.max(0, Math.min(window.innerHeight - PET_SIZE, parsed.pos.y));
					if (nx !== parsed.pos.x || ny !== parsed.pos.y) petSetPos({ x: nx, y: ny });
				};
				window.addEventListener("resize", onResize);
				return () => window.removeEventListener("resize", onResize);
			}, [parsed.pos]);

			// 悬停气泡：延迟 220ms 出现
			const hoverTimer = react.useRef<ReturnType<typeof setTimeout> | null>(null);
			react.useEffect(() => {
				return () => {
					if (hoverTimer.current) clearTimeout(hoverTimer.current);
				};
			}, []);
			const onMouseEnter = () => {
				if (hoverTimer.current) clearTimeout(hoverTimer.current);
				hoverTimer.current = setTimeout(() => setHover(true), 220);
			};
			const onMouseLeave = () => {
				if (hoverTimer.current) clearTimeout(hoverTimer.current);
				hoverTimer.current = null;
				setHover(false);
			};

			// 拖拽（window 级 pointermove/up；位移 < 5px 视为点击）
			const dragState = react.useRef<DragStart | null>(null);
			const onPointerDown = (e: { button: number; clientX: number; clientY: number; preventDefault(): void }) => {
				if (e.button !== 0) return;
				e.preventDefault();
				const start: DragStart = { startX: e.clientX, startY: e.clientY, moved: false };
				dragState.current = start;
				const onMove = (ev: PointerEvent) => {
					const dx = ev.clientX - start.startX;
					const dy = ev.clientY - start.startY;
					if (!start.moved && Math.hypot(dx, dy) < 5) return;
					if (!start.moved) {
						start.moved = true;
						setDragging(true);
					}
					setDragPos({
						x: Math.max(0, Math.min(window.innerWidth - PET_SIZE, pos.x + dx)),
						y: Math.max(0, Math.min(window.innerHeight - PET_SIZE, pos.y + dy))
					});
				};
				const onUp = () => {
					window.removeEventListener("pointermove", onMove);
					window.removeEventListener("pointerup", onUp);
					setDragging(false);
					if (!start.moved) {
						// 点击：切换面板 + 蹦一下
						setOpen(!open);
						setBounceKey((k) => k + 1);
						return;
					}
					// 拖拽结束：提交位置（持久化）
					setDragPos((cur) => {
						petSetPos(cur);
						return null;
					});
				};
				window.addEventListener("pointermove", onMove);
				window.addEventListener("pointerup", onUp);
			};

			const bubbleText = error
				? "统计接口不可用…"
				: working
					? "正在干活…"
					: !total
						? "今天还没开工呢…"
						: mood === "sleepy"
							? "今天还没用过 token 呢…"
							: mood === "busy"
								? `今天吃了 ${fmtCompact(billedTotal)} token，忙不过来啦…`
								: mood === "dizzy"
									? `${fmtCompact(billedTotal)} token… 转圈圈了…`
									: `今天吃了 ${fmtCompact(billedTotal)} token，歇会儿～`;

			// 7 天迷你柱状图数据（旧 → 新）
			const chartDays = (history && history.days ? [...history.days].reverse() : []).map((d) => ({
				day: d.day,
				input: billedInput(d.total),
				output: d.total.outputTokens
			}));
			const chartMax = Math.max(1, ...chartDays.map((d) => Math.max(d.input, d.output)));
			const CHART_H = 40;

			// 面板几何（默认在宠物上方；空间不足时转到下方）
			const POP_W = 286;
			const POP_H = 340;
			const popLeft = Math.max(8, Math.min(window.innerWidth - POP_W - 8, pos.x + PET_SIZE - POP_W + 12));
			const popTop = pos.y - POP_H - 10 < 8 ? pos.y + PET_SIZE + 10 : pos.y - POP_H - 10;

			if (!parsed.visible) return null;

			return react.createElement(
				react.Fragment,
				null,
				[
					react.createElement("style", { key: "css" }, PET_CSS),
					hover && !open
						? react.createElement(
								"div",
								{
									key: "bubble",
									style: {
										position: "fixed",
										left: pos.x - 10,
										top: pos.y - 36 - (toastActive ? 46 : 0),
										transform: "translateX(-100%)",
										background: "var(--dsw-alias-bg-layer-2, #ffffff)",
										border: `1px solid ${STYLE.borderL2}`,
										borderRadius: 8,
										boxShadow: "0 4px 14px rgba(0,0,0,.14)",
										padding: "5px 10px",
										fontSize: 12,
										color: STYLE.labelPrimary,
										whiteSpace: "nowrap",
										pointerEvents: "none",
										maxWidth: 260,
										overflow: "hidden",
										textOverflow: "ellipsis"
									}
								},
								bubbleText
							)
						: null,
					// 工作中：右上角脉冲点
					working
						? react.createElement("div", {
								key: "pulse",
								className: "dts-pulse",
								style: {
									position: "fixed",
									left: pos.x + 40,
									top: pos.y - 4,
									width: 10,
									height: 10,
									borderRadius: "50%",
									background: STYLE.accent,
									boxShadow: `0 0 0 3px ${STYLE.surfaceL2}`,
									pointerEvents: "none",
									zIndex: 9997
								}
							})
						: null,
					// 完成/收工：扩散光环
					toastActive
						? react.createElement("div", {
								key: "ring",
								className: "dts-ring",
								style: {
									position: "fixed",
									left: pos.x - 6,
									top: pos.y - 6,
									width: PET_SIZE + 12,
									height: PET_SIZE + 12,
									borderRadius: "50%",
									border: `2px solid ${STYLE.accent}`,
									pointerEvents: "none",
									zIndex: 9997
								}
							})
						: null,
					// 完成/收工提示卡片
					toastActive
						? react.createElement(
								"div",
								{
									key: restFlash ? `r${restFlash.id}` : `f${flash && flash.id}`,
									className: "dts-pop",
									style: {
										position: "fixed",
										left: pos.x - 10,
										top: pos.y - 40,
										transform: "translateX(-100%)",
										background: "var(--dsw-alias-bg-layer-2, #ffffff)",
										border: `1px solid ${STYLE.borderL2}`,
										borderRadius: 10,
										boxShadow: "0 4px 14px rgba(0,0,0,.14)",
										padding: "6px 10px",
										fontSize: 11.5,
										color: STYLE.labelPrimary,
										pointerEvents: "none",
										whiteSpace: "nowrap",
										maxWidth: 320,
										overflow: "hidden",
										textOverflow: "ellipsis",
										zIndex: 9998
									}
								},
								restFlash
									? `💤 收工啦～ 今天吃了 ${fmtCompact(billedTotal)}`
									: flash
										? `✅ 任务完成${flash.count > 1 ? ` ×${flash.count}` : ""} · 输入 ${fmtCompact(flash.billed)}${flash.outputTokens > 0 ? ` · 输出 ${fmtCompact(flash.outputTokens)}` : ""}${flash.subagent ? " · 子代理" : ""}`
										: ""
							)
						: null,
					react.createElement(
						"button",
						{
							key: "pet",
							type: "button",
							ref: petRef,
							onPointerDown: onPointerDown,
							onMouseEnter: onMouseEnter,
							onMouseLeave: onMouseLeave,
							onDragStart: (e: { preventDefault(): void }) => e.preventDefault(),
							"aria-label": open ? "收起今日 token 用量面板" : "查看今日 token 用量（点击展开，拖拽可移动）",
							style: {
								position: "fixed",
								left: pos.x,
								top: pos.y,
								width: PET_SIZE,
								height: PET_SIZE,
								padding: 0,
								margin: 0,
								border: "none",
								background: "none",
								cursor: dragging ? "grabbing" : "grab",
								touchAction: "none",
								userSelect: "none",
								WebkitUserSelect: "none",
								outline: "none"
							}
						},
						react.createElement(SlimeSvg, { size: PET_SIZE, mood, bounceKey })
					),
					open
						? react.createElement(
								"div",
								{
									key: "pop",
									ref: popRef,
									style: {
										position: "fixed",
										left: popLeft,
										top: popTop,
										width: POP_W,
										maxHeight: 380,
										overflowY: "auto",
										background: "var(--dsw-alias-bg-layer-2, #ffffff)",
										border: `1px solid ${STYLE.borderL2}`,
										borderRadius: 12,
										boxShadow: "0 8px 28px rgba(0,0,0,.18)",
										padding: "14px 16px 12px",
										zIndex: 9999,
										fontSize: 12.5,
										color: STYLE.labelPrimary
									}
								},
								[
									react.createElement(
										"div",
										{
											key: "head",
											style: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }
										},
										[
											react.createElement("span", { key: "t", style: { fontSize: 13, fontWeight: 700, color: STYLE.labelPrimary } }, "今日用量"),
											react.createElement("span", { key: "d", style: { fontSize: 11, color: STYLE.labelTertiary, ...NUM } }, today),
											react.createElement(
												"button",
												{
													key: "x",
													type: "button",
													onClick: () => setOpen(false),
													"aria-label": "关闭",
													style: {
														background: "none",
														border: "none",
														padding: "2px 6px",
														borderRadius: 5,
														cursor: "pointer",
														color: STYLE.labelTertiary,
														fontSize: 13,
														lineHeight: 1
													},
													onMouseEnter: (e: { currentTarget: HTMLElement }) => (e.currentTarget.style.color = STYLE.labelPrimary),
													onMouseLeave: (e: { currentTarget: HTMLElement }) => (e.currentTarget.style.color = STYLE.labelTertiary)
												},
												"✕"
											)
										]
									),
									error
										? react.createElement(
												"p",
												{ key: "err", style: { color: STYLE.labelSecondary, fontSize: 12.5, marginTop: 10 } },
												`统计接口不可用：${error}（请确认 dsh-token-stats 服务端插件已加载）`
											)
										: total
											? react.createElement(
													"div",
													{ key: "body" },
													[
														react.createElement(
															"div",
															{ key: "nums", style: { display: "flex", flexWrap: "wrap", gap: "6px 26px", alignItems: "flex-end", marginTop: 12 } },
															[
																statGroup("计费输入", fmtCompact(billedTotal), { size: 22, weight: 700 }),
																statGroup("输出", fmtCompact(total.outputTokens), {}),
																statGroup("请求", String(total.requests), {}),
																statGroup("缓存读", fmtCompact(total.cacheReadTokens), {})
															]
														),
														react.createElement(
															"div",
															{ key: "meta", style: { marginTop: 8, fontSize: 11.5, color: STYLE.labelTertiary } },
															`缓存命中率 ${hitRate.toFixed(0)}%${total.reasoningTokens > 0 ? ` · 推理 ${fmtCompact(total.reasoningTokens)}` : ""}`
														),
														chartDays.length > 0
															? react.createElement(
																	"div",
																	{ key: "chart", style: { marginTop: 12 } },
																	[
																		react.createElement(
																			"div",
																			{ key: "legend", style: { display: "flex", gap: 10, fontSize: 10, color: STYLE.labelTertiary, marginBottom: 4 } },
																			[
																				react.createElement(
																					"span",
																					{ key: "in", style: { display: "flex", alignItems: "center", gap: 5 } },
																					[
																						react.createElement("span", { key: "d", style: { width: 6, height: 6, borderRadius: "50%", background: STYLE.accent, flex: "none" } }),
																						"计费输入"
																					]
																				),
																				react.createElement(
																					"span",
																					{ key: "out", style: { display: "flex", alignItems: "center", gap: 5 } },
																					[
																						react.createElement("span", { key: "d", style: { width: 6, height: 6, borderRadius: "50%", background: STYLE.labelTertiary, flex: "none" } }),
																						"输出"
																					]
																				)
																			]
																		),
																		react.createElement(
																			"div",
																			{ key: "bars", style: { display: "flex", alignItems: "flex-end", gap: 6, height: CHART_H + 16 } },
																			chartDays.map((d) =>
																				react.createElement(
																					"div",
																					{
																						key: d.day,
																						title: `${d.day}\n计费输入 ${fmt(d.input)}\n输出 ${fmt(d.output)}`,
																						style: { display: "flex", flexDirection: "column", alignItems: "center", gap: 3, flex: 1, minWidth: 0 }
																					},
																					[
																						react.createElement("div", {
																							key: "in",
																							style: {
																								width: 9,
																								height: Math.max(2, Math.round((d.input / chartMax) * CHART_H)),
																								borderRadius: "2px 2px 0 0",
																								background: STYLE.accent,
																								opacity: 0.85
																							}
																						}),
																						react.createElement("div", {
																							key: "out",
																							style: {
																								width: 9,
																								height: Math.max(2, Math.round((d.output / chartMax) * CHART_H)),
																								borderRadius: "2px 2px 0 0",
																								background: STYLE.labelTertiary,
																								opacity: 0.55
																							}
																						}),
																						react.createElement("div", { key: "l", style: { fontSize: 9, color: STYLE.labelTertiary, ...NUM } }, d.day.slice(5))
																					]
																				)
																			)
																		)
																	]
																)
															: null,
														react.createElement(
															"div",
															{ key: "cap", style: { marginTop: 12, fontSize: 11, color: STYLE.labelTertiary } },
															"完整明细见 设置 → 用量统计"
														)
													]
												)
											: react.createElement(
													"p",
													{ key: "empty", style: { color: STYLE.labelSecondary, fontSize: 12.5, marginTop: 10 } },
													"今天还没有记录到模型调用。"
												)
								]
							)
						: null
				]
			);
		}

		// ── 设置页分区 ───────────────────────────────────────────────────────
		function TokenStatsSection(props: Record<string, unknown>) {
			const { summary, history, sessions, error } = useStats(30000);
			const total = summary ? summary.total : null;
			const providers = summary ? summary.providers : null;
			const today = summary ? summary.day : todayKey();

			const tableStyle = {
				width: "100%",
				borderCollapse: "collapse",
				fontSize: 12.5,
				color: STYLE.labelPrimary
			};
			/** 表头：小号次级色，无边框，数字右对齐。 */
			const thStyle = {
				textAlign: "right",
				padding: "0 12px 6px",
				fontWeight: 500,
				fontSize: 11,
				color: STYLE.labelTertiary,
				whiteSpace: "nowrap"
			};
			const thLeft = { ...thStyle, textAlign: "left" };
			/** 单元格：细发丝分隔线，数字等宽右对齐。 */
			const tdStyle = {
				padding: "5px 12px",
				borderBottom: `1px solid ${STYLE.borderL1}`,
				whiteSpace: "nowrap"
			};
			const tdNum = { ...tdStyle, ...NUM, textAlign: "right" };

			// 今日聚合指标
			const billedTotal = billedInput(total);
			const hitRate = pct(total ? total.cacheReadTokens : 0, billedTotal);
			const avgIn = total && total.requests > 0 ? billedTotal / total.requests : 0;
			const avgOut = total && total.requests > 0 ? total.outputTokens / total.requests : 0;

			// 按会话对账（顶层 / 子代理，按计费输入降序）
			const sessList: SessionRow[] = sessions && Array.isArray(sessions.sessions) ? sessions.sessions : [];
			const sessBilled = (s: SessionRow): number => s.inputTokens + s.cacheReadTokens + s.cacheWriteTokens;
			const topSess = sessList.filter((s) => !s.subagent).sort((a, b) => sessBilled(b) - sessBilled(a));
			const subSess = sessList.filter((s) => s.subagent).sort((a, b) => sessBilled(b) - sessBilled(a));
			const topBilled = topSess.reduce((a, s) => a + sessBilled(s), 0);
			const subBilled = subSess.reduce((a, s) => a + sessBilled(s), 0);

			// 按会话明细表（一行一个会话；子代理在会话格内标注父会话）
			const sessionTableBody = (list: SessionRow[]) =>
				list.length === 0
					? null
					: react.createElement(
							"table",
							{ style: tableStyle },
							react.createElement(
								"thead",
								null,
								react.createElement(
									"tr",
									null,
									["会话", "计费输入", "未缓存", "缓存读", "输出", "推理", "请求", "占比"].map((h, i) =>
										react.createElement("th", { key: h, style: i === 0 ? thLeft : thStyle }, h)
									)
								)
							),
							react.createElement(
								"tbody",
								null,
								list.map((s) => {
									const billed = sessBilled(s);
									const parent8 = s.parent ? String(s.parent).slice(0, 8) : "";
									return react.createElement(
										"tr",
										{ key: s.id, ...rowHover },
										[
											react.createElement(
												"td",
												{ key: "id", style: { ...tdStyle, ...NUM }, title: s.id },
												react.createElement(
													"span",
													null,
													String(s.id).slice(0, 8),
													s.subagent
														? react.createElement(
																"span",
																{
																	style: { color: STYLE.labelTertiary, fontSize: 11 },
																	title: `子代理会话（GUI 会话列表不显示）\n父会话 ${s.parent || "?"}`
																},
																` → ${parent8 || "?"}`
															)
														: null
												)
											),
											react.createElement("td", { key: "b", style: tdNum }, fmt(billed)),
											react.createElement("td", { key: "i", style: tdNum }, fmt(s.inputTokens)),
											react.createElement("td", { key: "cr", style: tdNum }, fmt(s.cacheReadTokens)),
											react.createElement("td", { key: "o", style: tdNum }, fmt(s.outputTokens)),
											react.createElement("td", { key: "r", style: tdNum }, s.reasoningTokens > 0 ? fmt(s.reasoningTokens) : "—"),
											react.createElement("td", { key: "n", style: tdNum }, String(s.requests)),
											react.createElement(
												"td",
												{ key: "s", style: tdNum },
												react.createElement(
													"div",
													{ style: { display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 6 } },
													[
														shareBar(pct(billed, billedTotal)),
														react.createElement("span", { key: "t", style: { color: STYLE.labelSecondary } }, `${pct(billed, billedTotal).toFixed(0)}%`)
													]
												)
											)
										]
									);
								})
							)
						);
			const groupHeader = (text: string, count: number) =>
				react.createElement(
					"div",
					{ style: { margin: "16px 0 2px", fontSize: 12, fontWeight: 600, color: STYLE.labelSecondary } },
					`${text}（${count}）`
				);

			// 7 天柱状图数据（旧 → 新）
			const chartDays = (history && history.days ? [...history.days].reverse() : []).map((d) => ({
				day: d.day,
				input: billedInput(d.total),
				output: d.total.outputTokens
			}));
			const chartMax = Math.max(1, ...chartDays.map((d) => Math.max(d.input, d.output)));
			const BAR_H = 48;

			return react.createElement(
				"div",
				{ style: { padding: "2px 0 4px" } },
				react.createElement(
					"h3",
					{ style: { margin: 0, fontSize: 16, fontWeight: 700, letterSpacing: "-0.01em", color: STYLE.labelPrimary } },
					"今日用量"
				),
				react.createElement(
					"div",
					{ style: { marginTop: 2, fontSize: 11, color: STYLE.labelTertiary, ...NUM } },
					today
				),
				error
					? react.createElement("p", { style: { color: STYLE.labelSecondary, fontSize: 13, marginTop: 10 } }, `统计接口不可用：${error}（请确认 dsh-token-stats 服务端插件已加载）`)
					: total
						? react.createElement(
								"div",
								null,
								// 头部统计：一个主数字 + 三个次级数字，无盒子，靠留白分隔
								react.createElement(
									"div",
									{ style: { display: "flex", flexWrap: "wrap", gap: "8px 44px", alignItems: "flex-end", marginTop: 18 } },
									[
										statGroup("计费输入", fmtCompact(billedTotal), { size: 26, weight: 700 }),
										statGroup("请求", String(total.requests), {}),
										statGroup("输出", fmtCompact(total.outputTokens), {}),
										statGroup("缓存读", fmtCompact(total.cacheReadTokens), {})
									]
								),
								// 一行次要指标
								react.createElement(
									"div",
									{ style: { marginTop: 12, fontSize: 12, color: STYLE.labelTertiary } },
									`缓存命中率 ${hitRate.toFixed(1)}% · 平均输入 ${fmtCompact(avgIn)}/请求 · 平均输出 ${fmtCompact(avgOut)}/请求${total.reasoningTokens > 0 ? ` · 推理 ${fmtCompact(total.reasoningTokens)}` : ""}`
								),
								// 对账一行（无盒子）
								sessList.length > 0
									? react.createElement(
											"div",
											{ style: { marginTop: 8, fontSize: 12, color: STYLE.labelSecondary } },
											[
												react.createElement(
													"span",
													{ key: "l", style: NUM },
													`对账：顶层会话 ${fmtCompact(topBilled)} ＋ 子代理会话 ${fmtCompact(subBilled)}（${subSess.length} 个）＝ 总计 ${fmtCompact(billedTotal)}`
												),
												react.createElement(
													"span",
													{ key: "n", style: { color: STYLE.labelTertiary, fontSize: 11 } },
													"　GUI 会话列表只显示顶层会话，插件统计全部会话（含子代理）"
												)
											]
										)
									: null,
								// 模型明细
								sectionTitle("模型明细"),
								// 模型明细表
								react.createElement(
									"table",
									{ style: tableStyle },
									react.createElement(
										"thead",
										null,
										react.createElement(
											"tr",
											null,
											["提供商", "模型", "计费输入", "未缓存", "缓存读", "输出", "推理", "请求", "占比"].map((h, i) =>
												react.createElement("th", { key: h, style: i < 2 ? thLeft : thStyle }, h)
											)
										)
									),
									react.createElement(
										"tbody",
										null,
										Object.entries(providers || {}).flatMap(([provider, pv]) =>
											Object.entries(pv.models).map(([model, ms]) => {
												const billed = billedInput(ms);
												return react.createElement(
													"tr",
													{ key: `${provider}:${model}`, ...rowHover },
													[
														react.createElement("td", { key: "p", style: { ...tdStyle, color: STYLE.labelSecondary }, title: provider }, provider),
														react.createElement("td", { key: "m", style: { ...tdStyle, fontWeight: 600 }, title: model }, model),
														react.createElement("td", { key: "b", style: tdNum }, fmt(billed)),
														react.createElement("td", { key: "i", style: tdNum }, fmt(ms.inputTokens)),
														react.createElement("td", { key: "cr", style: tdNum }, fmt(ms.cacheReadTokens)),
														react.createElement("td", { key: "o", style: tdNum }, fmt(ms.outputTokens)),
														react.createElement("td", { key: "r", style: tdNum }, ms.reasoningTokens > 0 ? fmt(ms.reasoningTokens) : "—"),
														react.createElement("td", { key: "n", style: tdNum }, String(ms.requests)),
														react.createElement(
															"td",
															{ key: "s", style: tdNum },
															react.createElement(
																"div",
																{ style: { display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 6 } },
																[
																	shareBar(pct(billed, billedTotal)),
																	react.createElement("span", { key: "t", style: { color: STYLE.labelSecondary } }, `${pct(billed, billedTotal).toFixed(0)}%`)
																]
															)
														)
													]
												);
											})
										)
									)
								),
								// 会话明细（顶层 / 子代理分组）
								sessList.length > 0
									? react.createElement(
											"div",
											null,
											[
												sectionTitle("会话明细"),
												topSess.length > 0
													? react.createElement(
															react.Fragment,
															{ key: "top" },
															groupHeader("顶层会话", topSess.length),
															sessionTableBody(topSess)
														)
													: null,
												subSess.length > 0
													? react.createElement(
															react.Fragment,
															{ key: "sub" },
															groupHeader("子代理会话", subSess.length),
															sessionTableBody(subSess)
														)
													: null
											]
										)
									: null,
								// 最近 7 天：迷你柱状图 + 逐日表
								sectionTitle("最近 7 天"),
								react.createElement(
									"div",
									{ style: { display: "flex", gap: 14, marginBottom: 2, fontSize: 10, color: STYLE.labelTertiary } },
									[
										react.createElement(
											"span",
											{ key: "in", style: { display: "flex", alignItems: "center", gap: 5 } },
											[
												react.createElement("span", { key: "d", style: { width: 6, height: 6, borderRadius: "50%", background: STYLE.accent, flex: "none" } }),
												"计费输入"
											]
										),
										react.createElement(
											"span",
											{ key: "out", style: { display: "flex", alignItems: "center", gap: 5 } },
											[
												react.createElement("span", { key: "d", style: { width: 6, height: 6, borderRadius: "50%", background: STYLE.labelTertiary, flex: "none" } }),
												"输出"
											]
										)
									]
								),
								react.createElement(
									"div",
									{
										style: {
											display: "flex",
											alignItems: "flex-end",
											gap: 10,
											padding: "10px 2px 4px",
											overflowX: "auto"
										}
									},
									chartDays.map((d) =>
										react.createElement(
											"div",
											{
												key: d.day,
												title: `${d.day}\n计费输入 ${fmt(d.input)}\n输出 ${fmt(d.output)}`,
												style: {
													display: "flex",
													flexDirection: "column",
													alignItems: "center",
													gap: 4,
													flex: "none"
												}
											},
											[
												react.createElement(
													"div",
													{
														key: "bars",
														style: { display: "flex", alignItems: "flex-end", gap: 3, height: BAR_H }
													},
													[
														react.createElement("div", {
															key: "in",
															style: {
																width: 8,
																height: Math.max(2, Math.round((d.input / chartMax) * BAR_H)),
																borderRadius: "2px 2px 0 0",
																background: STYLE.accent,
																opacity: 0.85
															}
														}),
														react.createElement("div", {
															key: "out",
															style: {
																width: 8,
																height: Math.max(2, Math.round((d.output / chartMax) * BAR_H)),
																borderRadius: "2px 2px 0 0",
																background: STYLE.labelTertiary,
																opacity: 0.55
															}
														})
													]
												),
												react.createElement(
													"div",
													{ key: "label", style: { fontSize: 10, color: STYLE.labelTertiary, ...NUM } },
													d.day.slice(5)
												)
											]
										)
									)
								),
								history && history.days && history.days.length > 0
									? react.createElement(
											"table",
											{ style: { ...tableStyle, marginTop: 10 } },
											react.createElement(
												"thead",
												null,
												react.createElement(
													"tr",
													null,
													["日期", "计费输入", "缓存读", "输出", "请求"].map((h, i) =>
														react.createElement("th", { key: h, style: i === 0 ? thLeft : thStyle }, h)
													)
												)
											),
											react.createElement(
												"tbody",
												null,
												history.days.map((row) =>
													react.createElement(
														"tr",
														{ key: row.day, ...rowHover },
														[
															react.createElement("td", { key: "d", style: { ...tdStyle, ...NUM } }, row.day),
															react.createElement("td", { key: "i", style: tdNum }, fmt(billedInput(row.total))),
															react.createElement("td", { key: "cr", style: tdNum }, fmt(row.total.cacheReadTokens)),
															react.createElement("td", { key: "o", style: tdNum }, fmt(row.total.outputTokens)),
															react.createElement("td", { key: "n", style: tdNum }, String(row.total.requests))
														]
													)
												)
											)
										)
									: react.createElement(
											"p",
											{ style: { color: STYLE.labelSecondary, fontSize: 13, marginTop: 8 } },
											"暂无历史数据。"
										)
							)
						: react.createElement("p", { style: { color: STYLE.labelSecondary, fontSize: 13 } }, "今天还没有记录到模型调用。")
			);
		}

		// ── 插件注册 ─────────────────────────────────────────────────────────
		const inject = ["slots"];

		function apply(ctx: SlotCtx) {
			ctx.effect(
				() =>
					ctx.slots.inject("sidebar.footer.action", () =>
						ctx.slots.register(
							{
								name: "sidebar.footer.action",
								id: "token-stats",
								order: 200,
								label: "显示/隐藏用量宠物"
							},
							PetToggleWidget
						)
					),
				"token-stats: sidebar pet toggle"
			);
			ctx.effect(
				() =>
					ctx.slots.inject("shell.overlay", () =>
						ctx.slots.register(
							{
								name: "shell.overlay",
								id: "token-stats-pet",
								order: 1000,
								label: "用量宠物"
							},
							TokenStatsPet
						)
					),
				"token-stats: floating pet"
			);
			ctx.effect(
				() =>
					ctx.slots.inject("settings.section", () =>
						ctx.slots.register(
							{
								name: "settings.section",
								id: "token-stats",
								order: 90,
								label: "用量统计"
							},
							TokenStatsSection
						)
					),
				"token-stats: settings section"
			);
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
