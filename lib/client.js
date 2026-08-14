"use strict";
/**
 * dsh-token-stats — 客户端插件（AMD bundle，由前端 /plugins/dsh-token-stats/client.js 加载）。
 *
 * 挂载点：
 *  - sidebar.footer.action —— 侧边栏底部"用量宠物"开关（v0.6.0）：显示/隐藏悬浮宠物，
 *    不再常驻显示数字
 *  - shell.overlay —— 浮动"用量宠物"（v0.6.0 / 实时活动 v0.7.0 / v0.8.0 打磨）：可拖拽史莱姆
 *    （纯 CSS/SVG 绘制，无图片资源）。v0.8.0 起参考 Codex 桌宠（Boba / Desk Otter）
 *    的设计语言打磨：角色描边 + 底部暗影 + 地面阴影落地、尺寸加大、hover 探头，
 *    双击逗宠物（爱心飘起 + 蹦跳 + 开心脸），情绪 = 实时工作状态 + 今日用量：
 *    正在工作（服务端 activity 2.5s 轮询）→ 专注盯小电脑（进度条动画）+ 右上角脉冲点；
 *    空闲 → 打瞌睡（0 请求）/ 休息眯眼 / 冒汗（汗滴）/ 晕眩（双星旋转）。多任务或
 *    子代理每完成一个弹"✅ 任务完成"提示（绿边 + 小史莱姆图标）+ 扩散光环，全部收工
 *    弹"💤 收工啦"。悬停吐泡泡看一行摘要，点击弹出今日汇总面板（计费输入/输出/请求
 *    + 缓存命中率条 + 7 天迷你柱状图 + 7 天合计），位置与可见性持久化 localStorage
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
window.__ModuleLoader__.load({
    id: "dsh-token-stats",
    factory: (require) => {
        var module = { exports: {} };
        var exports = module.exports;
        Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
        let react_jsx_runtime = require("react/jsx-runtime");
        let react = require("react");
        // ── 工具 ─────────────────────────────────────────────────────────────
        /** 完整数字（千分位），用于表格与提示。 */
        const fmt = (n) => Number(n || 0).toLocaleString("zh-CN");
        /** k/m/b 缩写，1 位小数：1234 → 1.2k，58000000 → 58.0M；千以下保留至多 1 位小数。 */
        const fmtCompact = (n) => {
            const v = Number(n || 0);
            if (Math.abs(v) >= 1e9)
                return `${(v / 1e9).toFixed(1)}B`;
            if (Math.abs(v) >= 1e6)
                return `${(v / 1e6).toFixed(1)}M`;
            if (Math.abs(v) >= 1e3)
                return `${(v / 1e3).toFixed(1)}k`;
            return Number.isInteger(v) ? String(v) : String(Math.round(v * 10) / 10);
        };
        const pct = (part, whole) => (whole > 0 ? (part / whole) * 100 : 0);
        const todayKey = () => {
            const d = new Date();
            return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        };
        const fetchJson = async (url) => {
            const res = await fetch(url, { cache: "no-store" });
            if (!res.ok)
                throw new Error(`HTTP ${res.status}`);
            return res.json();
        };
        /** 轮询 + 聚焦刷新的数据钩子。 */
        const useStats = (intervalMs = 30000) => {
            const [summary, setSummary] = react.useState(null);
            const [history, setHistory] = react.useState(null);
            const [sessions, setSessions] = react.useState(null);
            const [error, setError] = react.useState(null);
            const [lastUpdated, setLastUpdated] = react.useState(0);
            const load = react.useCallback(() => {
                fetchJson(`/token-stats/summary?day=${todayKey()}`)
                    .then((data) => {
                    setSummary(data);
                    setError(null);
                    setLastUpdated(Date.now());
                })
                    .catch((e) => setError(String(e && typeof e === "object" && "message" in e ? e.message : e)));
                fetchJson("/token-stats/history?days=7")
                    .then(setHistory)
                    .catch(() => { });
                fetchJson(`/token-stats/sessions?day=${todayKey()}`)
                    .then(setSessions)
                    .catch(() => { });
            }, []);
            react.useEffect(() => {
                load();
                const timer = setInterval(load, intervalMs);
                const onVisibility = () => {
                    if (document.visibilityState === "visible")
                        load();
                };
                document.addEventListener("visibilitychange", onVisibility);
                window.addEventListener("focus", load);
                return () => {
                    clearInterval(timer);
                    document.removeEventListener("visibilitychange", onVisibility);
                    window.removeEventListener("focus", load);
                };
            }, [load, intervalMs]);
            return { summary, history, sessions, error, lastUpdated, reload: load };
        };
        /**
         * 实时活动钩子：每 intervalMs 拉一次 summary（轻量），供"工作/休息/完成"
         * 状态机使用。返回值：
         *  - summary：最新汇总（含 activity）
         *  - working：lastAt 距今 < workingWindowMs 视为工作中
         *  - flash：上次轮询以来新完成的调用（合并），null = 无
         */
        const useActivity = (intervalMs = 2500, workingWindowMs = 15000) => {
            const [summary, setSummary] = react.useState(null);
            const [working, setWorking] = react.useState(false);
            const [flash, setFlash] = react.useState(null);
            const [error, setError] = react.useState(null);
            const lastSeenAt = react.useRef(Date.now());
            const flashTimer = react.useRef(null);
            react.useEffect(() => {
                const tick = () => {
                    fetchJson(`/token-stats/summary?day=${todayKey()}`)
                        .then((data) => {
                        setSummary(data);
                        setError(null);
                        const act = data.activity;
                        if (!act)
                            return;
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
                            if (flashTimer.current)
                                clearTimeout(flashTimer.current);
                            flashTimer.current = setTimeout(() => setFlash(null), 4000);
                        }
                    })
                        .catch((e) => setError(String(e && typeof e === "object" && "message" in e ? e.message : e)));
                };
                tick();
                const timer = setInterval(tick, intervalMs);
                const onVisibility = () => {
                    if (document.visibilityState === "visible")
                        tick();
                };
                document.addEventListener("visibilitychange", onVisibility);
                window.addEventListener("focus", tick);
                return () => {
                    clearInterval(timer);
                    if (flashTimer.current)
                        clearTimeout(flashTimer.current);
                    document.removeEventListener("visibilitychange", onVisibility);
                    window.removeEventListener("focus", tick);
                };
            }, [intervalMs, workingWindowMs]);
            return { summary, working, flash, error };
        };
        /** 注入一次关键帧动画样式（幂等）。 */
        const injectKeyframes = () => {
            if (document.getElementById("dsh-token-stats-keyframes"))
                return;
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
        const billedInput = (stats) => stats ? stats.inputTokens + stats.cacheReadTokens + stats.cacheWriteTokens : 0;
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
        const PET_SIZE = 64;
        /** 情绪阈值：今日计费输入达到该值切换情绪。 */
        const MOOD_BUSY_AT = 100_000;
        const MOOD_DIZZY_AT = 300_000;
        /**
         * 按实时工作状态 + 今日数据推断情绪（数据即状态：不用打开任何东西就能感知
         * 用量与是否在工作）。正在工作 → working；否则按今日用量：0 请求 → 打瞌睡、
         * 轻用量 → 休息、重用量 → 冒汗 / 晕眩。
         */
        const moodOf = (total, working) => {
            if (working)
                return "working";
            if (!total || total.requests <= 0)
                return "sleepy";
            const billed = billedInput(total);
            if (billed >= MOOD_DIZZY_AT)
                return "dizzy";
            if (billed >= MOOD_BUSY_AT)
                return "busy";
            return "rest";
        };
        // 模块级宠物状态：两个挂载点共享；useSyncExternalStore 订阅（快照为字符串）。
        let petVisible = true;
        let petPos = null;
        let petSnap = "";
        const petListeners = new Set();
        const petSnapshot = () => `${petVisible ? "1" : "0"}|${petPos ? `${Math.round(petPos.x)},${Math.round(petPos.y)}` : ""}`;
        const petEmit = () => {
            petSnap = petSnapshot();
            for (const cb of petListeners)
                cb();
        };
        const petInit = () => {
            try {
                petVisible = localStorage.getItem(LS_PET_VISIBLE) !== "0";
                const raw = localStorage.getItem(LS_PET_POS);
                if (raw) {
                    const p = JSON.parse(raw);
                    if (p && typeof p === "object" && typeof p.x === "number" && typeof p.y === "number") {
                        petPos = { x: p.x, y: p.y };
                    }
                }
            }
            catch {
                // localStorage 不可用：保持默认
            }
            petSnap = petSnapshot();
        };
        const petSubscribe = (cb) => {
            petListeners.add(cb);
            return () => {
                petListeners.delete(cb);
            };
        };
        const petGetSnapshot = () => petSnap;
        const petSetVisible = (v) => {
            if (v === petVisible)
                return;
            petVisible = v;
            try {
                localStorage.setItem(LS_PET_VISIBLE, v ? "1" : "0");
            }
            catch {
                // ignore
            }
            petEmit();
        };
        const petSetPos = (p) => {
            petPos = p;
            try {
                if (p)
                    localStorage.setItem(LS_PET_POS, JSON.stringify(p));
                else
                    localStorage.removeItem(LS_PET_POS);
            }
            catch {
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
.ts-pet-sprout-fast { animation: ts-pet-sway 1.1s ease-in-out infinite; transform-box: fill-box; transform-origin: 50% 100%; }
.ts-pet-sweat { animation: ts-pet-sweatfall 1.5s linear infinite; transform-box: fill-box; }
@keyframes ts-pet-sweatfall { 0% { transform: translateY(2px); opacity: 0; } 20% { opacity: 1; } 100% { transform: translateY(14px); opacity: 0; } }
.ts-pet-zzz { animation: ts-pet-zzz 2.2s ease-out infinite; transform-box: fill-box; }
@keyframes ts-pet-zzz { 0% { transform: translate(0, 0) scale(0.6); opacity: 0; } 30% { opacity: 0.9; } 100% { transform: translate(7px, -13px) scale(1.2); opacity: 0; } }
.ts-pet-bounce { animation: ts-pet-bounce 0.45s ease; transform-box: fill-box; }
@keyframes ts-pet-bounce { 0% { transform: translateY(0); } 40% { transform: translateY(-12px); } 70% { transform: translateY(0) scale(1.06, 0.92); } 100% { transform: translateY(0); } }
.ts-pet-work { animation: ts-pet-work 0.5s ease-in-out infinite; }
@keyframes ts-pet-work { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-3px); } }
.ts-pet-sleep { animation: ts-pet-sleep 3.6s ease-in-out infinite; transform-box: fill-box; transform-origin: 50% 100%; }
@keyframes ts-pet-sleep { 0%, 100% { transform: scale(1, 1); } 50% { transform: scale(1.04, 0.94); } }
.ts-pet-svg { transition: transform 200ms ease; }
.ts-pet-perk { transform: scale(1.08) translateY(-2px); }
.ts-pet-prog { animation: ts-pet-prog 0.9s ease-in-out infinite; transform-box: fill-box; transform-origin: 0 50%; }
@keyframes ts-pet-prog { 0%, 100% { transform: scaleX(0.45); } 50% { transform: scaleX(1); } }
.ts-pet-heart { animation: ts-pet-heart 1.5s ease-out forwards; transform-box: fill-box; }
@keyframes ts-pet-heart { 0% { transform: translate(0, 0) scale(0.5); opacity: 0; } 20% { opacity: 1; } 100% { transform: translate(9px, -26px) scale(1.25); opacity: 0; } }
.ts-pet-star2 { animation: ts-pet-star2 1.6s ease-in-out infinite; transform-box: fill-box; transform-origin: 32px 8px; }
@keyframes ts-pet-star2 { 0%, 100% { transform: rotate(-14deg) translateY(0); opacity: .8; } 50% { transform: rotate(14deg) translateY(-5px); opacity: 1; } }
.ts-pet-shade { transition: transform 200ms ease, opacity 200ms ease; }
.ts-pet-shade-grow { transform: scaleX(1.2); opacity: .75; }
/* 表情切换：弹入（约 180ms） */
.ts-pet-facepop { animation: ts-pet-facepop 180ms ease-out; transform-box: fill-box; transform-origin: 50% 50%; }
@keyframes ts-pet-facepop { 0% { transform: scale(0.92); opacity: 0; } 100% { transform: scale(1); opacity: 1; } }
/* 身体轻微上下浮动（和 breathe 叠加，振幅 ≤2px） */
.pt-float { animation: pt-float 3.2s ease-in-out infinite; transform-box: fill-box; transform-origin: 50% 100%; }
@keyframes pt-float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-1.6px); } }
/* 眼睛左顾右盼：长停顿 + 短暂平移（与 blink 叠加） */
.pt-lookaround { animation: pt-lookaround 7s ease-in-out infinite; transform-box: fill-box; transform-origin: 50% 50%; }
@keyframes pt-lookaround { 0%, 60%, 100% { transform: translate(0, 0); } 68% { transform: translate(1.5px, 0); } 78% { transform: translate(-1.5px, 0); } 86% { transform: translate(1.5px, 0); } 94% { transform: translate(0, 0); } }
/* 工作态：屏幕闪烁光标 */
.pt-cursor { animation: pt-cursor 1s steps(2, end) infinite; }
@keyframes pt-cursor { 0%, 49% { opacity: 1; } 50%, 100% { opacity: 0; } }
/* 加载点：错开淡入淡出 */
.pt-load-dot { animation: pt-load-dot 1.2s ease-in-out infinite; }
@keyframes pt-load-dot { 0%, 100% { opacity: 0.25; } 50% { opacity: 1; } }
/* 晕眩：左侧星环绕（小轨道） */
.pt-star-orbit { animation: pt-star-orbit 1.6s ease-in-out infinite; transform-box: fill-box; transform-origin: 32px 8px; }
@keyframes pt-star-orbit { 0%, 100% { transform: rotate(14deg) translateY(0); opacity: .8; } 50% { transform: rotate(-14deg) translateY(-5px); opacity: 1; } }
/* 晕眩：身体轻微晃动 */
.pt-dizzy-wobble { animation: pt-dizzy-wobble 0.6s ease-in-out infinite; transform-box: fill-box; transform-origin: 50% 100%; }
@keyframes pt-dizzy-wobble { 0%, 100% { transform: rotate(0); } 25% { transform: rotate(-2deg); } 75% { transform: rotate(2deg); } }
`;
        /** 史莱姆 SVG（纯 CSS/SVG 绘制，无图片资源；mood 决定表情，bounceKey 触发跳跃）。 */
        function SlimeSvg(props) {
            const { size, mood, bounceKey, perk, pokeKey } = props;
            const eye = STYLE.labelPrimary;
            const blush = "rgba(255, 110, 130, 0.5)";
            const stroke = { fill: "none", stroke: eye, strokeWidth: 2.4, strokeLinecap: "round" };
            const face = (() => {
                if (mood === "sleepy") {
                    const eyes = [
                        react.createElement("path", { key: "e1", d: "M20 35 Q23.5 31.5 27 35", ...stroke }),
                        react.createElement("path", { key: "e2", d: "M37 35 Q40.5 31.5 44 35", ...stroke })
                    ];
                    return [
                        react.createElement("g", { key: "eyes", className: "pt-lookaround" }, eyes),
                        react.createElement("circle", { key: "m", cx: 32, cy: 45, r: 2, fill: eye }),
                        react.createElement("text", { key: "z1", x: 40, y: 15, fontSize: 9, fontWeight: 700, fill: STYLE.labelTertiary, className: "ts-pet-zzz" }, "z"),
                        react.createElement("text", { key: "z2", x: 47, y: 6, fontSize: 6.5, fontWeight: 700, fill: STYLE.labelTertiary, className: "ts-pet-zzz", style: { animationDelay: "1.1s" } }, "z")
                    ];
                }
                if (mood === "busy") {
                    const eyes = [
                        react.createElement("path", { key: "e1", d: "M20.5 31.5 L26.5 37.5 M26.5 31.5 L20.5 37.5", ...stroke }),
                        react.createElement("path", { key: "e2", d: "M37.5 31.5 L43.5 37.5 M43.5 31.5 L37.5 37.5", ...stroke })
                    ];
                    return [
                        react.createElement("g", { key: "eyes", className: "pt-lookaround" }, eyes),
                        react.createElement("path", { key: "m", d: "M26 46 Q32 49 38 46", ...stroke, strokeWidth: 2.2 }),
                        react.createElement("path", { key: "s", d: "M49 14 C 52 19, 52 22.5, 49 24.5 C 46 22.5, 46 19, 49 14 Z", fill: "#8fd8ff", className: "ts-pet-sweat" })
                    ];
                }
                if (mood === "dizzy") {
                    const eyes = [
                        react.createElement("path", { key: "e1", d: "M20.5 31.5 L26.5 37.5 M26.5 31.5 L20.5 37.5", ...stroke }),
                        react.createElement("path", { key: "e2", d: "M37.5 31.5 L43.5 37.5 M43.5 31.5 L37.5 37.5", ...stroke })
                    ];
                    return [
                        react.createElement("g", { key: "eyes", className: "pt-lookaround" }, eyes),
                        react.createElement("path", { key: "m", d: "M24 47 Q28 44.5 32 47 Q36 49.5 40 47", ...stroke, strokeWidth: 2.2 }),
                        // 双星左右对称环绕（左侧 pt-star-orbit 错开 0.8s 节奏相反；右侧保留 ts-pet-star2）
                        react.createElement("text", { key: "s", x: 12, y: 13, fontSize: 8, fill: STYLE.labelTertiary, className: "pt-star-orbit", style: { animationDelay: "0.8s" } }, "★"),
                        react.createElement("text", { key: "s2", x: 47, y: 21, fontSize: 7.5, fill: STYLE.labelTertiary, className: "ts-pet-star2" }, "★")
                    ];
                }
                if (mood === "working") {
                    const eyes = [
                        react.createElement("circle", { key: "e1", cx: 23.5, cy: 33.5, r: 3.2, fill: eye }),
                        react.createElement("circle", { key: "e2", cx: 40.5, cy: 33.5, r: 3.2, fill: eye })
                    ];
                    return [
                        react.createElement("g", { key: "eyes", className: "pt-lookaround" }, eyes),
                        // 专注眼（圆眼 + 眉毛） + 抿嘴
                        react.createElement("path", { key: "b1", d: "M20 27.5 L26.5 30.5", ...stroke, strokeWidth: 2 }),
                        react.createElement("path", { key: "b2", d: "M37.5 30.5 L44 27.5", ...stroke, strokeWidth: 2 }),
                        react.createElement("path", { key: "m", d: "M29 45.5 L35 45.5", ...stroke, strokeWidth: 2.2 })
                    ];
                }
                if (mood === "rest") {
                    const eyes = [
                        react.createElement("path", { key: "e1", d: "M20 35 Q23.5 31.5 27 35", ...stroke }),
                        react.createElement("path", { key: "e2", d: "M37 35 Q40.5 31.5 44 35", ...stroke })
                    ];
                    return [
                        react.createElement("g", { key: "eyes", className: "pt-lookaround" }, eyes),
                        // 眯眼微笑（干完活的休息态）
                        react.createElement("path", { key: "m", d: "M27 44 Q32 48 37 44", ...stroke }),
                        react.createElement("ellipse", { key: "c1", cx: 17, cy: 42.5, rx: 3.4, ry: 2.1, fill: blush }),
                        react.createElement("ellipse", { key: "c2", cx: 47, cy: 42.5, rx: 3.4, ry: 2.1, fill: blush })
                    ];
                }
                const eyes = [
                    react.createElement("circle", { key: "e1", cx: 23.5, cy: 34.5, r: 3.4, fill: eye, className: "ts-pet-eye" }),
                    react.createElement("circle", { key: "e2", cx: 40.5, cy: 34.5, r: 3.4, fill: eye, className: "ts-pet-eye" })
                ];
                return [
                    react.createElement("g", { key: "eyes", className: "pt-lookaround" }, eyes),
                    react.createElement("path", { key: "m", d: "M26 44 Q32 49.5 38 44", ...stroke }),
                    react.createElement("ellipse", { key: "c1", cx: 17, cy: 42.5, rx: 3.4, ry: 2.1, fill: blush }),
                    react.createElement("ellipse", { key: "c2", cx: 47, cy: 42.5, rx: 3.4, ry: 2.1, fill: blush })
                ];
            })();
            return react.createElement("svg", {
                key: bounceKey ? `b${bounceKey}` : undefined,
                width: size,
                height: size,
                viewBox: "0 0 64 64",
                "aria-hidden": true,
                className: [bounceKey ? "ts-pet-bounce" : mood === "working" ? "ts-pet-work" : mood === "sleepy" ? "ts-pet-sleep" : undefined, "ts-pet-svg", perk ? "ts-pet-perk" : undefined]
                    .filter(Boolean)
                    .join(" ") || undefined,
                style: { display: "block", overflow: "visible" }
            }, [
                react.createElement("g", { key: "sprout", className: perk ? "ts-pet-sprout-fast" : "ts-pet-sprout" }, [
                    react.createElement("path", { key: "stem", d: "M32 9 C 32 5, 33.5 3, 36 1.5", fill: "none", stroke: STYLE.labelTertiary, strokeWidth: 2, strokeLinecap: "round" }),
                    react.createElement("ellipse", { key: "leaf", cx: 38.5, cy: 1.5, rx: 4.6, ry: 2.8, fill: STYLE.accent, opacity: 0.75, transform: "rotate(-14 38.5 1.5)" })
                ]),
                react.createElement("g", { key: "float", className: "pt-float" }, react.createElement("g", { key: "wobble", className: mood === "dizzy" ? "pt-dizzy-wobble" : undefined }, react.createElement("g", { key: "body", className: "ts-pet-breathe" }, [
                    react.createElement("path", {
                        key: "blob",
                        d: "M32 7.5 C 45 7.5, 56 20, 56 36 C 56 48, 49 56.5, 40 56.5 L 24 56.5 C 15 56.5, 8 48, 8 36 C 8 20, 19 7.5, 32 7.5 Z",
                        fill: STYLE.accent,
                        style: { stroke: STYLE.labelPrimary, strokeOpacity: 0.22, strokeWidth: 2.2 }
                    }),
                    react.createElement("ellipse", { key: "sh", cx: 32, cy: 50.5, rx: 18.5, ry: 7, fill: STYLE.labelPrimary, opacity: 0.08 }),
                    react.createElement("ellipse", { key: "hl", cx: 21, cy: 19, rx: 7.5, ry: 4.6, fill: "#ffffff", opacity: 0.28, transform: "rotate(-18 21 19)" })
                ]))),
                // 工作时面前的小电脑（进度条 + 闪烁光标 + 加载点 + 键盘底座）
                mood === "working"
                    ? react.createElement("g", { key: "laptop", className: "ts-pet-laptop" }, [
                        react.createElement("rect", { key: "screen", x: 15.5, y: 38.5, width: 33, height: 13, rx: 2.5, fill: "#f2f5f9", stroke: STYLE.labelTertiary, strokeOpacity: 0.4, strokeWidth: 1 }),
                        react.createElement("rect", { key: "prog", x: 17.5, y: 43, width: 15, height: 3.5, rx: 1.75, fill: STYLE.accent, className: "ts-pet-prog" }),
                        // 屏幕右下角闪烁光标（紧贴进度条末端）
                        react.createElement("rect", { key: "cursor", x: 34, y: 43, width: 1.5, height: 3.5, rx: 0.5, fill: STYLE.accent, className: "pt-cursor" }),
                        react.createElement("rect", { key: "base", x: 13, y: 50, width: 38, height: 6, rx: 3, fill: STYLE.labelTertiary, opacity: 0.55 }),
                        // 加载点：屏幕右下角，错开 delay 淡入淡出
                        react.createElement("text", { key: "ld1", x: 37, y: 47, fontSize: 8, fontWeight: 700, fill: STYLE.accent, className: "pt-load-dot", style: { animationDelay: "0s" } }, "·"),
                        react.createElement("text", { key: "ld2", x: 41, y: 47, fontSize: 8, fontWeight: 700, fill: STYLE.accent, className: "pt-load-dot", style: { animationDelay: "0.2s" } }, "·"),
                        react.createElement("text", { key: "ld3", x: 45, y: 47, fontSize: 8, fontWeight: 700, fill: STYLE.accent, className: "pt-load-dot", style: { animationDelay: "0.4s" } }, "·")
                    ])
                    : null,
                react.createElement("g", { key: `face-${mood}`, className: "ts-pet-facepop" }, face),
                pokeKey
                    ? [["♥", 30, 18, 9, 0], ["♥", 32.5, 13, 9, 0.22], ["♥", 35, 8, 9, 0.44], ["♥", 33, 4, 11, 0.7]].map(([h, x, y, sz, d], i) => react.createElement("text", {
                        key: `h${i}`,
                        x: x,
                        y: y,
                        fontSize: sz,
                        fill: "#ff6e82",
                        className: "ts-pet-heart",
                        style: { animationDelay: `${d}s` }
                    }, h))
                    : null
            ]);
        }
        // ── 侧边栏小部件（显示/隐藏宠物开关） ────────────────────────────────
        function PetToggleWidget(props) {
            const snap = react.useSyncExternalStore(petSubscribe, petGetSnapshot);
            const visible = snap.charAt(0) === "1";
            return react.createElement("button", {
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
                onMouseEnter: (e) => (e.currentTarget.style.background = STYLE.fillHover),
                onMouseLeave: (e) => (e.currentTarget.style.background = "none")
            }, [
                react.createElement("span", { key: "icon", style: { display: "flex", flex: "none", opacity: visible ? 1 : 0.45 } }, react.createElement(SlimeSvg, { size: 16, mood: "happy" })),
                react.createElement("span", { key: "text", style: { color: visible ? STYLE.labelPrimary : STYLE.labelTertiary } }, visible ? "隐藏宠物" : "显示宠物")
            ]);
        }
        // ── 设置页通用小块 ──────────────────────────────────────────────────
        /** 分区标题：小字号次级色，靠留白分段，不用盒子。 */
        const sectionTitle = (text) => react.createElement("div", { style: { margin: "30px 0 10px", fontSize: 13, fontWeight: 600, letterSpacing: "0.02em", color: STYLE.labelSecondary } }, text);
        /** 头部统计组：小标签在上、数字在下，无边框，靠留白分隔。 */
        const statGroup = (label, value, opts = {}) => react.createElement("div", { key: label, style: { display: "flex", flexDirection: "column", gap: 2, minWidth: 0 } }, [
            react.createElement("div", { key: "l", style: { fontSize: 11, letterSpacing: "0.06em", color: STYLE.labelTertiary, whiteSpace: "nowrap" } }, label),
            react.createElement("div", {
                key: "v",
                style: {
                    fontSize: opts.size || 16,
                    fontWeight: opts.weight || 500,
                    color: STYLE.labelPrimary,
                    ...NUM,
                    lineHeight: 1.25,
                    whiteSpace: "nowrap"
                }
            }, value)
        ]);
        /** 占比条：轨道 + 填充（0~1），细而低调。 */
        const shareBar = (ratio) => react.createElement("div", {
            style: {
                width: 44,
                height: 4,
                borderRadius: 2,
                background: STYLE.surfaceL2,
                overflow: "hidden",
                flex: "none"
            }
        }, react.createElement("div", {
            style: {
                width: `${Math.max(0, Math.min(100, ratio * 100))}%`,
                height: "100%",
                borderRadius: 2,
                background: STYLE.accent,
                opacity: 0.8
            }
        }));
        /** 表格行 hover 高亮。 */
        const rowHover = {
            onMouseEnter: (e) => (e.currentTarget.style.background = STYLE.fillHover),
            onMouseLeave: (e) => (e.currentTarget.style.background = "none")
        };
        function TokenStatsPet(props) {
            const snap = react.useSyncExternalStore(petSubscribe, petGetSnapshot);
            const [open, setOpen] = react.useState(false);
            const [hover, setHover] = react.useState(false);
            const [dragPos, setDragPos] = react.useState(null);
            const [dragging, setDragging] = react.useState(false);
            const [bounceKey, setBounceKey] = react.useState(0);
            const [poke, setPoke] = react.useState(null);
            const pokeTimer = react.useRef(null);
            const lastTap = react.useRef(null);
            const petRef = react.useRef(null);
            const popRef = react.useRef(null);
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
                if (base)
                    return base;
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
            const [restFlash, setRestFlash] = react.useState(null);
            const restTimer = react.useRef(null);
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
                if (working && !prevWorking.current && !isMulti)
                    sawMultiEpisode.current = false;
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
                    if (restTimer.current)
                        clearTimeout(restTimer.current);
                    restTimer.current = setTimeout(() => setRestFlash(null), 4000);
                    setBounceKey((k) => k + 1);
                }
                prevWorking.current = working;
            }, [working, flash, billedTotal]);
            react.useEffect(() => {
                return () => {
                    if (restTimer.current)
                        clearTimeout(restTimer.current);
                    if (pokeTimer.current)
                        clearTimeout(pokeTimer.current);
                };
            }, []);
            /** 是否有需要展示的完成/收工提示。 */
            const toastActive = !!(restFlash || (flash && (flash.subagent || flash.count > 1)));
            // 点击外部 / Escape 关闭面板
            react.useEffect(() => {
                if (!open)
                    return;
                const onDown = (e) => {
                    const t = e.target;
                    if (!t)
                        return;
                    if (petRef.current && petRef.current.contains(t))
                        return;
                    if (popRef.current && popRef.current.contains(t))
                        return;
                    setOpen(false);
                };
                const onKey = (e) => {
                    if (e.key === "Escape")
                        setOpen(false);
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
                    if (!parsed.pos)
                        return;
                    const nx = Math.max(0, Math.min(window.innerWidth - PET_SIZE, parsed.pos.x));
                    const ny = Math.max(0, Math.min(window.innerHeight - PET_SIZE, parsed.pos.y));
                    if (nx !== parsed.pos.x || ny !== parsed.pos.y)
                        petSetPos({ x: nx, y: ny });
                };
                window.addEventListener("resize", onResize);
                return () => window.removeEventListener("resize", onResize);
            }, [parsed.pos]);
            // 悬停气泡：延迟 220ms 出现
            const hoverTimer = react.useRef(null);
            react.useEffect(() => {
                return () => {
                    if (hoverTimer.current)
                        clearTimeout(hoverTimer.current);
                };
            }, []);
            const onMouseEnter = () => {
                if (hoverTimer.current)
                    clearTimeout(hoverTimer.current);
                hoverTimer.current = setTimeout(() => setHover(true), 220);
            };
            const onMouseLeave = () => {
                if (hoverTimer.current)
                    clearTimeout(hoverTimer.current);
                hoverTimer.current = null;
                setHover(false);
            };
            // 拖拽（window 级 pointermove/up；位移 < 5px 视为点击）
            const dragState = react.useRef(null);
            const onPointerDown = (e) => {
                if (e.button !== 0)
                    return;
                e.preventDefault();
                const start = { startX: e.clientX, startY: e.clientY, moved: false };
                dragState.current = start;
                const onMove = (ev) => {
                    const dx = ev.clientX - start.startX;
                    const dy = ev.clientY - start.startY;
                    if (!start.moved && Math.hypot(dx, dy) < 5)
                        return;
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
                        // 单击：切换面板 + 蹦一下；320ms 内的第二次单击 = 双击：逗宠物（爱心 + 开心脸）
                        const now = Date.now();
                        const prev = lastTap.current;
                        lastTap.current = { t: now };
                        if (prev && now - prev.t < 320) {
                            setOpen(false);
                            if (pokeTimer.current)
                                clearTimeout(pokeTimer.current);
                            setPoke({ key: now });
                            pokeTimer.current = setTimeout(() => setPoke(null), 1600);
                            setBounceKey((k) => k + 1);
                            return;
                        }
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
            const POP_W = 300;
            const POP_H = 380;
            const popLeft = Math.max(8, Math.min(window.innerWidth - POP_W - 8, pos.x + PET_SIZE - POP_W + 12));
            const popTop = pos.y - POP_H - 10 < 8 ? pos.y + PET_SIZE + 10 : pos.y - POP_H - 10;
            if (!parsed.visible)
                return null;
            return react.createElement(react.Fragment, null, [
                react.createElement("style", { key: "css" }, PET_CSS),
                hover && !open
                    ? react.createElement("div", {
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
                    }, bubbleText)
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
                            zIndex: 9997,
                            animation: "dts-pulse 1.6s ease-in-out infinite"
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
                            zIndex: 9997,
                            animation: "dts-ring 1.3s ease-out infinite"
                        }
                    })
                    : null,
                // 完成/收工提示卡片（绿边 = 任务完成 / 蓝边 = 收工，带小史莱姆图标）
                toastActive
                    ? react.createElement("div", {
                        key: restFlash ? `r${restFlash.id}` : `f${flash && flash.id}`,
                        className: "dts-pop",
                        style: {
                            position: "fixed",
                            left: pos.x - 10,
                            top: pos.y - 42,
                            transform: "translateX(-100%)",
                            background: "var(--dsw-alias-bg-layer-2, #ffffff)",
                            border: `1px solid ${STYLE.borderL2}`,
                            borderLeft: `3px solid ${restFlash ? STYLE.accent : "#2ebd59"}`,
                            borderRadius: 10,
                            boxShadow: "0 4px 14px rgba(0,0,0,.14)",
                            padding: "6px 10px 6px 8px",
                            fontSize: 11.5,
                            color: STYLE.labelPrimary,
                            pointerEvents: "none",
                            whiteSpace: "nowrap",
                            maxWidth: 340,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            zIndex: 9998
                        }
                    }, react.createElement("div", { style: { display: "flex", alignItems: "center", gap: 8 } }, [
                        react.createElement("span", {
                            key: "ic",
                            style: {
                                flex: "none",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                width: 24,
                                height: 24,
                                borderRadius: "50%",
                                background: restFlash ? "rgba(51,112,255,.12)" : "rgba(46,189,89,.14)"
                            }
                        }, react.createElement(SlimeSvg, { size: 17, mood: restFlash ? "rest" : "happy" })),
                        react.createElement("span", { key: "tx" }, restFlash
                            ? `💤 收工啦～ 今天吃了 ${fmtCompact(billedTotal)}`
                            : flash
                                ? `✅ 任务完成${flash.count > 1 ? ` ×${flash.count}` : ""} · 输入 ${fmtCompact(flash.billed)}${flash.outputTokens > 0 ? ` · 输出 ${fmtCompact(flash.outputTokens)}` : ""}${flash.subagent ? " · 子代理" : ""}`
                                : "")
                    ]))
                    : null,
                // 地面阴影（hover 时放大，增加落地感）
                react.createElement("div", {
                    key: "shadow",
                    className: hover && !open ? "ts-pet-shade ts-pet-shade-grow" : "ts-pet-shade",
                    style: {
                        position: "fixed",
                        left: pos.x + (PET_SIZE - 46) / 2,
                        top: pos.y + PET_SIZE - 4,
                        width: 46,
                        height: 7,
                        borderRadius: "50%",
                        background: "radial-gradient(ellipse at center, rgba(0,0,0,.22) 0%, rgba(0,0,0,0) 72%)",
                        pointerEvents: "none",
                        zIndex: 9996
                    }
                }),
                react.createElement("button", {
                    key: "pet",
                    type: "button",
                    ref: petRef,
                    onPointerDown: onPointerDown,
                    onMouseEnter: onMouseEnter,
                    onMouseLeave: onMouseLeave,
                    onDragStart: (e) => e.preventDefault(),
                    "aria-label": open ? "收起今日 token 用量面板" : "查看今日 token 用量（点击展开 · 双击逗宠物 · 拖拽可移动）",
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
                }, react.createElement(SlimeSvg, {
                    size: PET_SIZE,
                    mood: poke ? "happy" : mood,
                    bounceKey,
                    perk: hover && !open,
                    pokeKey: poke ? poke.key : undefined
                })),
                open
                    ? react.createElement("div", {
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
                    }, [
                        react.createElement("div", {
                            key: "head",
                            style: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }
                        }, [
                            react.createElement("span", { key: "t", style: { fontSize: 13, fontWeight: 700, color: STYLE.labelPrimary } }, "今日用量"),
                            (() => {
                                // 面板情绪行：poke 期间固定为 happy；否则按当前 mood
                                const lm = poke ? "happy" : mood;
                                const entry = {
                                    working: { dot: STYLE.accent, text: "工作中" },
                                    busy: { dot: "#f5a623", text: "忙到冒汗" },
                                    dizzy: { dot: "#ff6e82", text: "转圈圈" },
                                    sleepy: { dot: STYLE.labelTertiary, text: "打瞌睡" },
                                    rest: { dot: "#2ebd59", text: "休息中" },
                                    happy: { dot: "#2ebd59", text: "干完活啦" }
                                }[lm];
                                return react.createElement("span", { key: "mood", style: { display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, color: STYLE.labelTertiary, flex: "none" } }, [
                                    react.createElement("span", { key: "d", style: { width: 6, height: 6, borderRadius: "50%", background: entry.dot, flex: "none" } }),
                                    entry.text
                                ]);
                            })(),
                            react.createElement("span", { key: "d", style: { fontSize: 11, color: STYLE.labelTertiary, ...NUM } }, today),
                            react.createElement("button", {
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
                                onMouseEnter: (e) => (e.currentTarget.style.color = STYLE.labelPrimary),
                                onMouseLeave: (e) => (e.currentTarget.style.color = STYLE.labelTertiary)
                            }, "✕")
                        ]),
                        error
                            ? react.createElement("p", { key: "err", style: { color: STYLE.labelSecondary, fontSize: 12.5, marginTop: 10 } }, `统计接口不可用：${error}（请确认 dsh-token-stats 服务端插件已加载）`)
                            : total
                                ? react.createElement("div", { key: "body" }, [
                                    react.createElement("div", { key: "nums", style: { display: "flex", flexWrap: "wrap", gap: "6px 26px", alignItems: "flex-end", marginTop: 12 } }, [
                                        statGroup("计费输入", fmtCompact(billedTotal), { size: 22, weight: 700 }),
                                        statGroup("输出", fmtCompact(total.outputTokens), {}),
                                        statGroup("请求", String(total.requests), {}),
                                        statGroup("缓存读", fmtCompact(total.cacheReadTokens), {})
                                    ]),
                                    react.createElement("div", { key: "meta", style: { marginTop: 8, fontSize: 11.5, color: STYLE.labelTertiary } }, `${total.reasoningTokens > 0 ? `推理 ${fmtCompact(total.reasoningTokens)} · ` : ""}平均输入 ${fmtCompact(billedTotal / Math.max(1, total.requests))}/请求`),
                                    react.createElement("div", { key: "hit", style: { marginTop: 10 } }, [
                                        react.createElement("div", { key: "l", style: { display: "flex", justifyContent: "space-between", fontSize: 10.5, color: STYLE.labelTertiary, marginBottom: 4 } }, ["缓存命中率", `${hitRate.toFixed(0)}%`]),
                                        react.createElement("div", { key: "t", style: { height: 4, borderRadius: 2, background: STYLE.surfaceL2, overflow: "hidden" } }, react.createElement("div", { key: "f", style: { width: `${Math.min(100, hitRate)}%`, height: "100%", borderRadius: 2, background: STYLE.accent, opacity: 0.8 } }))
                                    ]),
                                    chartDays.length > 0
                                        ? react.createElement("div", { key: "chart", style: { marginTop: 12 } }, [
                                            react.createElement("div", { key: "legend", style: { display: "flex", gap: 10, fontSize: 10, color: STYLE.labelTertiary, marginBottom: 4 } }, [
                                                react.createElement("span", { key: "in", style: { display: "flex", alignItems: "center", gap: 5 } }, [
                                                    react.createElement("span", { key: "d", style: { width: 6, height: 6, borderRadius: "50%", background: STYLE.accent, flex: "none" } }),
                                                    "计费输入"
                                                ]),
                                                react.createElement("span", { key: "out", style: { display: "flex", alignItems: "center", gap: 5 } }, [
                                                    react.createElement("span", { key: "d", style: { width: 6, height: 6, borderRadius: "50%", background: STYLE.labelTertiary, flex: "none" } }),
                                                    "输出"
                                                ])
                                            ]),
                                            react.createElement("div", { key: "bars", style: { display: "flex", alignItems: "flex-end", gap: 6, height: CHART_H + 16 } }, chartDays.map((d) => react.createElement("div", {
                                                key: d.day,
                                                title: `${d.day}\n计费输入 ${fmt(d.input)}\n输出 ${fmt(d.output)}`,
                                                style: { display: "flex", flexDirection: "column", alignItems: "center", gap: 3, flex: 1, minWidth: 0 }
                                            }, [
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
                                            ])))
                                        ])
                                        : null,
                                    react.createElement("div", { key: "cap", style: { marginTop: 12, fontSize: 11, color: STYLE.labelTertiary } }, `近 7 天合计 ${fmtCompact(chartDays.reduce((a, d) => a + d.input, 0))} · 完整明细见 设置 → 用量统计`)
                                ])
                                : react.createElement("p", { key: "empty", style: { color: STYLE.labelSecondary, fontSize: 12.5, marginTop: 10 } }, "今天还没有记录到模型调用。")
                    ])
                    : null
            ]);
        }
        // ── 更清晰的设置页数据面板 ────────────────────────────────────────────
        /**
         * 30 天历史钩子（独立 fetch /token-stats/history?days=30）。
         * 复用 useStats 已有的 fetchJson / setInterval 风格，但与主钩子解耦：
         * 仅当用户展开 30 天面板时才发起请求，避免一上来拉两次接口。
         */
        const stUseMonth = () => {
            const [month, setMonth] = react.useState(null);
            const [loading, setLoading] = react.useState(false);
            const load = react.useCallback(() => {
                setLoading(true);
                fetchJson("/token-stats/history?days=30")
                    .then((d) => {
                    setMonth(d);
                    setLoading(false);
                })
                    .catch(() => setLoading(false));
            }, []);
            return { month, load, loading };
        };
        function TokenStatsSectionPolished(props) {
            const { summary, history, sessions, error, lastUpdated, reload } = useStats(30000);
            const { month: month30, load: loadMonth, loading: loadingMonth } = stUseMonth();
            const total = summary ? summary.total : null;
            const providers = summary ? summary.providers : null;
            const today = summary ? summary.day : todayKey();
            const billedTotal = billedInput(total);
            const hitRate = pct(total ? total.cacheReadTokens : 0, billedTotal);
            const avgIn = total && total.requests > 0 ? billedTotal / total.requests : 0;
            const avgOut = total && total.requests > 0 ? total.outputTokens / total.requests : 0;
            const tableStyle = {
                width: "100%",
                minWidth: 760,
                borderCollapse: "collapse",
                fontSize: 12.5,
                color: STYLE.labelPrimary
            };
            const thStyle = {
                textAlign: "right",
                padding: "0 12px 8px",
                fontWeight: 600,
                fontSize: 10.5,
                letterSpacing: "0.04em",
                color: STYLE.labelTertiary,
                whiteSpace: "nowrap"
            };
            const thLeft = { ...thStyle, textAlign: "left" };
            const tdStyle = {
                padding: "9px 12px",
                borderBottom: `1px solid ${STYLE.borderL1}`,
                whiteSpace: "nowrap"
            };
            const tdNum = { ...tdStyle, ...NUM, textAlign: "right" };
            const sessList = sessions && Array.isArray(sessions.sessions) ? sessions.sessions : [];
            const sessBilled = (s) => s.inputTokens + s.cacheReadTokens + s.cacheWriteTokens;
            const topSess = sessList.filter((s) => !s.subagent).sort((a, b) => sessBilled(b) - sessBilled(a));
            const subSess = sessList.filter((s) => s.subagent).sort((a, b) => sessBilled(b) - sessBilled(a));
            const topBilled = topSess.reduce((a, s) => a + sessBilled(s), 0);
            const subBilled = subSess.reduce((a, s) => a + sessBilled(s), 0);
            const chartDays = (history && history.days ? [...history.days].reverse() : []).map((d) => ({
                day: d.day,
                input: billedInput(d.total),
                output: d.total.outputTokens
            }));
            const chartMax = Math.max(1, ...chartDays.map((d) => Math.max(d.input, d.output)));
            const BAR_H = 64;
            /** 30 天折叠开关（默认收起）。 */
            const [stMonthOpen, stSetMonthOpen] = react.useState(false);
            /** 提供商汇总：每个提供商的计费输入 / 占比 / 细占比条；按计费输入降序。 */
            const providerRows = providers
                ? Object.entries(providers)
                    .map(([name, pv]) => ({ name, billed: billedInput(pv.total), requests: pv.total.requests }))
                    .sort((a, b) => b.billed - a.billed)
                : [];
            const css = `
				.dts-settings { max-width: 980px; padding: 8px 0 28px; color: ${STYLE.labelPrimary}; }
				.dts-settings, .dts-settings * { box-sizing: border-box; }
				.dts-settings button:focus-visible { outline: 2px solid ${STYLE.accent}; outline-offset: 3px; }
				.dts-overview { padding: 18px 20px 20px; border: 1px solid ${STYLE.borderL2}; border-radius: 16px; background: ${STYLE.surfaceL1}; box-shadow: 0 10px 30px rgba(18, 31, 53, .06); }
				.dts-overview-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
				.dts-kicker { font-size: 10px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; color: ${STYLE.accent}; }
				.dts-overview-title { margin-top: 5px; font-size: 20px; font-weight: 750; letter-spacing: -.025em; line-height: 1.1; }
				.dts-overview-date { flex: none; padding: 6px 9px; border: 1px solid ${STYLE.borderL1}; border-radius: 7px; color: ${STYLE.labelSecondary}; font-size: 11px; ${NUM.fontFamily ? `font-family:${NUM.fontFamily};` : ""} font-variant-numeric: tabular-nums; }
				.dts-metric-grid { display: grid; grid-template-columns: minmax(0, 1.5fr) repeat(3, minmax(92px, 1fr)); gap: 10px; margin-top: 20px; }
				.dts-primary-metric { min-width: 0; padding: 14px 18px 14px 0; border-right: 1px solid ${STYLE.borderL1}; }
				.dts-primary-metric .dts-value { margin-top: 4px; font-size: 26px; font-weight: 700; letter-spacing: -.035em; line-height: 1.1; }
				.dts-metric { min-width: 0; padding: 10px 0 10px 14px; border-left: 1px solid ${STYLE.borderL1}; }
				.dts-metric-label { color: ${STYLE.labelTertiary}; font-size: 10.5px; letter-spacing: .04em; }
				.dts-metric-value { margin-top: 5px; color: ${STYLE.labelPrimary}; font-size: 16px; font-weight: 500; line-height: 1.15; }
				.dts-subline { display: flex; flex-wrap: wrap; gap: 8px 18px; margin-top: 17px; color: ${STYLE.labelSecondary}; font-size: 11.5px; }
				.dts-subline span { white-space: nowrap; }
				.dts-subline strong { color: ${STYLE.labelPrimary}; font-weight: 600; }
				.dts-reconcile { display: flex; align-items: center; gap: 10px; margin-top: 12px; padding: 11px 13px; border-left: 3px solid ${STYLE.accent}; border-radius: 0 9px 9px 0; background: ${STYLE.surfaceL1}; color: ${STYLE.labelSecondary}; font-size: 11.5px; line-height: 1.5; }
				.dts-reconcile strong { color: ${STYLE.labelPrimary}; font-weight: 650; }
				.dts-refresh { width: 28px; height: 28px; border: 1px solid ${STYLE.borderL1}; border-radius: 8px; background: none; color: ${STYLE.labelSecondary}; font-size: 15px; line-height: 1; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; flex: none; }
				.dts-refresh:hover { background: ${STYLE.fillHover}; color: ${STYLE.labelPrimary}; }
				.dts-ago { color: ${STYLE.labelTertiary}; font-size: 10.5px; white-space: nowrap; }
				.dts-hit { display: flex; align-items: center; gap: 10px; margin-top: 15px; color: ${STYLE.labelTertiary}; font-size: 10.5px; }
				.dts-hit-track { flex: 1; max-width: 280px; height: 4px; border-radius: 2px; background: ${STYLE.surfaceL2}; overflow: hidden; }
				.dts-hit-fill { height: 100%; border-radius: 2px; background: ${STYLE.accent}; opacity: .85; transition: width 300ms ease; }
				.dts-section-heading { display: flex; align-items: center; gap: 10px; margin: 30px 0 11px; color: ${STYLE.labelPrimary}; font-size: 13px; font-weight: 700; letter-spacing: -.005em; }
				.dts-section-heading::after { content: ""; height: 1px; flex: 1; background: ${STYLE.borderL1}; }
				.dts-section-heading small { color: ${STYLE.labelTertiary}; font-size: 10.5px; font-weight: 500; }
				.dts-section-heading-toggle { cursor: pointer; user-select: none; }
				.dts-section-heading-toggle:hover { color: ${STYLE.accent}; }
				.dts-month-chev { display: inline-block; width: 12px; color: ${STYLE.labelTertiary}; transition: transform 180ms ease; font-size: 11px; }
				.dts-month-chev.open { transform: rotate(90deg); color: ${STYLE.accent}; }
				.dts-table-scroll { overflow-x: auto; margin: 0 -8px; padding: 0 8px 4px; scrollbar-color: ${STYLE.borderL2} transparent; }
				.dts-table-scroll table { min-width: 760px; }
				.dts-table-scroll tbody tr { transition: background 180ms ease; }
				.dts-table-scroll tbody tr:hover { background: ${STYLE.fillHover} !important; }
				.dts-group-label { display: flex; align-items: center; gap: 8px; margin: 17px 0 7px; color: ${STYLE.labelSecondary}; font-size: 11.5px; font-weight: 650; }
				.dts-group-label::before { content: ""; width: 5px; height: 5px; border-radius: 50%; background: ${STYLE.accent}; }
				.dts-provider-chips { display: flex; flex-wrap: wrap; gap: 6px 10px; margin: 4px 0 14px; padding: 10px 12px; border-top: 1px solid ${STYLE.borderL1}; border-bottom: 1px solid ${STYLE.borderL1}; }
				.dts-provider-chip { display: inline-flex; align-items: center; gap: 7px; padding: 4px 9px; border-radius: 6px; background: ${STYLE.surfaceL1}; color: ${STYLE.labelSecondary}; font-size: 11px; line-height: 1; }
				.dts-provider-chip strong { color: ${STYLE.labelPrimary}; font-weight: 600; }
				.dts-provider-chip .dts-pc-bar { width: 36px; height: 3px; border-radius: 2px; background: ${STYLE.surfaceL2}; overflow: hidden; flex: none; }
				.dts-provider-chip .dts-pc-bar i { display: block; height: 100%; background: ${STYLE.accent}; opacity: .75; border-radius: 2px; }
				.dts-provider-chip .dts-pc-pct { color: ${STYLE.labelTertiary}; }
				.dts-chart-wrap { padding: 12px 14px 9px; border: 1px solid ${STYLE.borderL1}; border-radius: 12px; background: ${STYLE.surfaceL1}; }
				.dts-chart { display: grid; grid-template-columns: repeat(7, minmax(42px, 1fr)); align-items: end; gap: 10px; min-height: 92px; border-bottom: 1px solid ${STYLE.borderL1}; }
				.dts-chart-day { display: flex; min-width: 0; flex-direction: column; align-items: center; justify-content: end; gap: 5px; }
				.dts-chart-bars { display: flex; align-items: end; gap: 3px; height: ${BAR_H}px; }
				.dts-chart-bar { width: 8px; border-radius: 2px 2px 0 0; transition: height 240ms ease, opacity 180ms ease; }
				.dts-chart-bars-empty { align-items: end; justify-content: center; }
				.dts-chart-dot { display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: ${STYLE.labelTertiary}; opacity: .25; transition: opacity 180ms ease; }
				.dts-chart-day:hover .dts-chart-dot { opacity: .55; }
				.dts-chart-day:hover .dts-chart-bar { opacity: 1 !important; }
				.dts-chart-label { padding-bottom: 7px; color: ${STYLE.labelTertiary}; font-size: 10px; ${NUM.fontFamily ? `font-family:${NUM.fontFamily};` : ""} font-variant-numeric: tabular-nums; }
				.dts-legend { display: flex; gap: 16px; margin-bottom: 7px; color: ${STYLE.labelTertiary}; font-size: 10px; }
				.dts-legend span { display: inline-flex; align-items: center; gap: 5px; }
				.dts-legend i { width: 6px; height: 6px; border-radius: 2px; background: ${STYLE.accent}; }
				.dts-legend .muted { background: ${STYLE.labelTertiary}; opacity: .65; }
				.dts-empty { padding: 24px 18px; border: 1px dashed ${STYLE.borderL2}; border-radius: 12px; color: ${STYLE.labelSecondary}; font-size: 13px; text-align: center; }
				.dts-loading { padding: 26px 20px 28px; border: 1px solid ${STYLE.borderL1}; border-radius: 14px; background: ${STYLE.surfaceL1}; }
				.dts-loading-kicker { color: ${STYLE.labelTertiary}; font-size: 10px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; }
				.dts-loading-bar { margin-top: 10px; height: 4px; width: 64%; max-width: 280px; border-radius: 2px; background: ${STYLE.surfaceL2}; overflow: hidden; position: relative; }
				.dts-loading-bar i { display: block; width: 36%; height: 100%; border-radius: 2px; background: ${STYLE.accent}; opacity: .55; animation: dts-loading-slide 1.1s ease-in-out infinite; }
				@keyframes dts-loading-slide { 0% { transform: translateX(-100%); } 100% { transform: translateX(320%); } }
				.dts-error { padding: 12px 14px; border-left: 3px solid #d97706; border-radius: 0 9px 9px 0; background: rgba(217, 119, 6, .08); color: ${STYLE.labelSecondary}; font-size: 13px; }
				@media (max-width: 720px) {
					.dts-settings { max-width: 100%; }
					.dts-overview { padding: 16px; border-radius: 13px; }
					.dts-overview-head { align-items: flex-start; }
					.dts-overview-title { font-size: 18px; }
					.dts-metric-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; margin-top: 16px; }
					.dts-primary-metric { grid-column: 1 / -1; padding: 0 0 12px; border-right: 0; border-bottom: 1px solid ${STYLE.borderL1}; }
					.dts-metric { padding: 9px 0 5px 11px; }
					.dts-reconcile { align-items: flex-start; }
					.dts-chart-wrap { overflow-x: auto; }
					.dts-chart { min-width: 390px; }
					/* 720：彻底让表格跟随容器，避免被内联 min-width 撑出滚动条 */
					.dts-tbl-model table, .dts-tbl-session table, .dts-table-scroll table { min-width: 0 !important; }
					/* 720：占比条在小屏视觉权重低（细占比条在模型明细里已有），再隐藏占比列保证 5 列完整 */
					.dts-tbl-model th:nth-child(9), .dts-tbl-model td:nth-child(9),
					.dts-tbl-session th:nth-child(8), .dts-tbl-session td:nth-child(8) { display: none; }
					.dts-tbl-model td, .dts-tbl-model th, .dts-tbl-session td, .dts-tbl-session th { padding-left: 3px; padding-right: 3px; font-size: 11px; }
					/* 数字列 11px 等宽 + tabular 保证对齐 */
					.dts-tbl-model td, .dts-tbl-session td { font-variant-numeric: tabular-nums; }
				}
				@media (max-width: 480px) {
					.dts-metric-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
					.dts-subline { gap: 6px 14px; }
				}
				@media (max-width: 1100px) {
					/* 窄屏隐藏低优先级列（未缓存/推理），让宽表免滚动 */
					.dts-tbl-model th:nth-child(4), .dts-tbl-model td:nth-child(4),
					.dts-tbl-model th:nth-child(7), .dts-tbl-model td:nth-child(7),
					.dts-tbl-session th:nth-child(3), .dts-tbl-session td:nth-child(3),
					.dts-tbl-session th:nth-child(6), .dts-tbl-session td:nth-child(6) { display: none; }
					.dts-tbl-model table, .dts-tbl-session table { min-width: 0 !important; }
					.dts-tbl-model td, .dts-tbl-model th, .dts-tbl-session td, .dts-tbl-session th { padding-left: 8px; padding-right: 8px; }
				}
				@media (max-width: 760px) {
					/* 更窄：再隐藏输出列，保证核心列完整可见 */
					.dts-tbl-model th:nth-child(6), .dts-tbl-model td:nth-child(6),
					.dts-tbl-session th:nth-child(5), .dts-tbl-session td:nth-child(5) { display: none; }
					/* 760：模型名/提供商允许截断（!important 压过内联 maxWidth），避免推动表格变宽 */
					.dts-tbl-model td.dts-cell-ellipsis, .dts-tbl-session td.dts-cell-ellipsis { max-width: 96px !important; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
					.dts-tbl-model td.dts-cell-ellipsis-w, .dts-tbl-session td.dts-cell-ellipsis-w { max-width: 132px !important; }
				}
				@media (prefers-reduced-motion: reduce) { .dts-table-scroll tbody tr, .dts-chart-bar { transition: none; } }
			`;
            const heading = (title, note) => react.createElement("div", { className: "dts-section-heading" }, [title, note ? react.createElement("small", { key: "note" }, note) : null]);
            /** 30 天折叠面板（按需展开）。注记 30 天合计；展开后显示紧凑逐日表。 */
            const stMonthSection = (open, setOpen, data, loadFn, loading) => {
                const monthTotal = data && data.days ? data.days.reduce((a, d) => a + billedInput(d.total), 0) : 0;
                const noteText = data && data.days && data.days.length > 0
                    ? `近 30 天合计 ${fmtCompact(monthTotal)}`
                    : "近 30 天合计 —";
                const toggle = () => {
                    const next = !open;
                    setOpen(next);
                    if (next && !data)
                        loadFn();
                };
                const head = react.createElement("div", { className: "dts-section-heading dts-section-heading-toggle", onClick: toggle, role: "button", tabIndex: 0, onKeyDown: (e) => { if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        toggle();
                    } }, "aria-expanded": open }, [
                    react.createElement("span", { key: "chev", className: `dts-month-chev${open ? " open" : ""}`, "aria-hidden": true }, "▸"),
                    "最近 30 天",
                    react.createElement("small", { key: "note" }, noteText)
                ]);
                if (!open)
                    return head;
                const body = !data && loading
                    ? react.createElement("div", { key: "m-load", className: "dts-loading", style: { padding: "18px 16px" } }, react.createElement("div", { className: "dts-loading-bar" }, react.createElement("i")))
                    : data && data.days && data.days.length > 0
                        ? react.createElement("div", { key: "m-scroll", className: "dts-table-scroll" }, react.createElement("table", { style: { ...tableStyle, minWidth: 460 } }, [
                            react.createElement("thead", { key: "head" }, react.createElement("tr", null, ["日期", "计费输入", "缓存读", "输出", "请求"].map((h, i) => react.createElement("th", { key: h, style: i === 0 ? thLeft : thStyle }, h)))),
                            react.createElement("tbody", { key: "body" }, data.days.map((row) => react.createElement("tr", { key: row.day, ...rowHover }, [
                                react.createElement("td", { key: "d", style: { ...tdStyle, ...NUM } }, row.day),
                                react.createElement("td", { key: "i", style: tdNum }, fmt(billedInput(row.total))),
                                react.createElement("td", { key: "cr", style: tdNum }, fmt(row.total.cacheReadTokens)),
                                react.createElement("td", { key: "o", style: tdNum }, fmt(row.total.outputTokens)),
                                react.createElement("td", { key: "n", style: tdNum }, String(row.total.requests))
                            ])))
                        ]))
                        : react.createElement("p", { key: "m-empty", style: { color: STYLE.labelSecondary, fontSize: 12.5, marginTop: 8 } }, "暂无 30 天数据。");
                return react.createElement(react.Fragment, { key: "month" }, [head, body]);
            };
            const sessionTable = (list) => list.length === 0
                ? null
                : react.createElement("div", { className: "dts-table-scroll dts-tbl-session" }, react.createElement("table", { style: tableStyle }, [
                    react.createElement("thead", { key: "head" }, react.createElement("tr", null, ["会话", "计费输入", "未缓存", "缓存读", "输出", "推理", "请求", "占比"].map((h, i) => react.createElement("th", { key: h, style: i === 0 ? thLeft : thStyle }, h)))),
                    react.createElement("tbody", { key: "body" }, list.map((s) => {
                        const billed = sessBilled(s);
                        const parent8 = s.parent ? String(s.parent).slice(0, 8) : "";
                        return react.createElement("tr", { key: s.id, ...rowHover }, [
                            react.createElement("td", { key: "id", className: "dts-cell-ellipsis", style: { ...tdStyle, ...NUM, maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis" }, title: s.id }, [
                                String(s.id).slice(0, 8),
                                s.subagent
                                    ? react.createElement("span", { key: "parent", style: { color: STYLE.labelTertiary, fontSize: 11 } }, ` → ${parent8 || "?"}`)
                                    : null
                            ]),
                            react.createElement("td", { key: "b", style: tdNum }, fmt(billed)),
                            react.createElement("td", { key: "i", style: tdNum }, fmt(s.inputTokens)),
                            react.createElement("td", { key: "cr", style: tdNum }, fmt(s.cacheReadTokens)),
                            react.createElement("td", { key: "o", style: tdNum }, fmt(s.outputTokens)),
                            react.createElement("td", { key: "r", style: tdNum }, s.reasoningTokens > 0 ? fmt(s.reasoningTokens) : "—"),
                            react.createElement("td", { key: "n", style: tdNum }, String(s.requests)),
                            react.createElement("td", { key: "share", style: tdNum }, react.createElement("div", { style: { display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 6 } }, [shareBar(pct(billed, billedTotal)), react.createElement("span", { key: "pct", style: { color: STYLE.labelSecondary } }, `${pct(billed, billedTotal).toFixed(0)}%`)]))
                        ]);
                    }))
                ]));
            const modelTable = react.createElement("div", { className: "dts-table-scroll dts-tbl-model" }, react.createElement("table", { style: tableStyle }, [
                react.createElement("thead", { key: "head" }, react.createElement("tr", null, ["提供商", "模型", "计费输入", "未缓存", "缓存读", "输出", "推理", "请求", "占比"].map((h, i) => react.createElement("th", { key: h, style: i < 2 ? thLeft : thStyle }, h)))),
                react.createElement("tbody", { key: "body" }, Object.entries(providers || {}).flatMap(([provider, pv]) => Object.entries(pv.models).map(([model, ms]) => {
                    const billed = billedInput(ms);
                    return react.createElement("tr", { key: `${provider}:${model}`, ...rowHover }, [
                        react.createElement("td", { key: "p", className: "dts-cell-ellipsis", style: { ...tdStyle, color: STYLE.labelSecondary, maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis" }, title: provider }, provider),
                        react.createElement("td", { key: "m", className: "dts-cell-ellipsis-w", style: { ...tdStyle, fontWeight: 650, maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis" }, title: model }, model),
                        react.createElement("td", { key: "b", style: tdNum }, fmt(billed)),
                        react.createElement("td", { key: "i", style: tdNum }, fmt(ms.inputTokens)),
                        react.createElement("td", { key: "cr", style: tdNum }, fmt(ms.cacheReadTokens)),
                        react.createElement("td", { key: "o", style: tdNum }, fmt(ms.outputTokens)),
                        react.createElement("td", { key: "r", style: tdNum }, ms.reasoningTokens > 0 ? fmt(ms.reasoningTokens) : "—"),
                        react.createElement("td", { key: "n", style: tdNum }, String(ms.requests)),
                        react.createElement("td", { key: "s", style: tdNum }, react.createElement("div", { style: { display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 6 } }, [shareBar(pct(billed, billedTotal)), react.createElement("span", { key: "t", style: { color: STYLE.labelSecondary } }, `${pct(billed, billedTotal).toFixed(0)}%`)]))
                    ]);
                })))
            ]));
            const historyTable = history && history.days && history.days.length > 0
                ? react.createElement("div", { className: "dts-table-scroll", style: { marginTop: 10 } }, react.createElement("table", { style: { ...tableStyle, minWidth: 560 } }, [
                    react.createElement("thead", { key: "head" }, react.createElement("tr", null, ["日期", "计费输入", "缓存读", "输出", "请求"].map((h, i) => react.createElement("th", { key: h, style: i === 0 ? thLeft : thStyle }, h)))),
                    react.createElement("tbody", { key: "body" }, history.days.map((row) => react.createElement("tr", { key: row.day, ...rowHover }, [
                        react.createElement("td", { key: "d", style: { ...tdStyle, ...NUM } }, row.day),
                        react.createElement("td", { key: "i", style: tdNum }, fmt(billedInput(row.total))),
                        react.createElement("td", { key: "cr", style: tdNum }, fmt(row.total.cacheReadTokens)),
                        react.createElement("td", { key: "o", style: tdNum }, fmt(row.total.outputTokens)),
                        react.createElement("td", { key: "n", style: tdNum }, String(row.total.requests))
                    ])))
                ]))
                : react.createElement("p", { style: { color: STYLE.labelSecondary, fontSize: 13, marginTop: 8 } }, "暂无历史数据。");
            return react.createElement("section", { className: "dts-settings", "aria-labelledby": "dts-settings-title" }, [
                react.createElement("style", { key: "style" }, css),
                react.createElement("div", { key: "head", className: "dts-overview-head", style: { marginBottom: 14 } }, [
                    react.createElement("div", { key: "copy" }, [
                        react.createElement("div", { key: "kicker", className: "dts-kicker" }, "Token telemetry"),
                        react.createElement("h3", { key: "title", id: "dts-settings-title", className: "dts-overview-title", style: { margin: "5px 0 0" } }, "今日用量")
                    ]),
                    react.createElement("div", { key: "actions", style: { display: "flex", alignItems: "center", gap: 8, flex: "none" } }, [
                        react.createElement("div", { key: "date", className: "dts-overview-date" }, today),
                        react.createElement("button", { key: "refresh", type: "button", onClick: reload, className: "dts-refresh", title: "刷新统计", "aria-label": "刷新统计" }, "↻"),
                        lastUpdated
                            ? react.createElement("div", { key: "ago", className: "dts-ago" }, `更新于 ${new Date(lastUpdated).toTimeString().slice(0, 8)}`)
                            : null
                    ])
                ]),
                error
                    ? react.createElement("div", { key: "error", className: "dts-error" }, `统计接口不可用：${error}（请确认 dsh-token-stats 服务端插件已加载）`)
                    : !summary
                        ? react.createElement("div", { key: "loading", className: "dts-loading", "aria-live": "polite" }, [
                            react.createElement("div", { key: "k", className: "dts-loading-kicker" }, "正在拉取今日用量"),
                            react.createElement("div", { key: "b", className: "dts-loading-bar" }, react.createElement("i", { key: "f" }))
                        ])
                        : total && total.requests > 0
                            ? [
                                react.createElement("div", { key: "overview", className: "dts-overview" }, [
                                    react.createElement("div", { key: "metrics", className: "dts-metric-grid" }, [
                                        react.createElement("div", { key: "primary", className: "dts-primary-metric" }, [
                                            react.createElement("div", { key: "label", className: "dts-kicker", style: { color: STYLE.labelTertiary, letterSpacing: ".06em" } }, "Billed input"),
                                            react.createElement("div", { key: "value", className: "dts-value", style: { ...NUM, fontSize: 26, fontWeight: 700 } }, fmtCompact(billedTotal)),
                                            react.createElement("div", { key: "desc", style: { marginTop: 6, color: STYLE.labelSecondary, fontSize: 11.5 } }, "未缓存输入 + 缓存读写")
                                        ]),
                                        statGroup("请求", String(total.requests)),
                                        statGroup("输出", fmtCompact(total.outputTokens)),
                                        statGroup("缓存读", fmtCompact(total.cacheReadTokens))
                                    ]),
                                    react.createElement("div", { key: "subline", className: "dts-subline" }, [
                                        react.createElement("span", { key: "hit" }, ["缓存命中率 ", react.createElement("strong", { key: "v" }, `${hitRate.toFixed(1)}%`)]),
                                        react.createElement("span", { key: "avg-in" }, ["平均输入 ", react.createElement("strong", { key: "v" }, `${fmtCompact(avgIn)} / 请求`)]),
                                        react.createElement("span", { key: "avg-out" }, ["平均输出 ", react.createElement("strong", { key: "v" }, `${fmtCompact(avgOut)} / 请求`)]),
                                        total.reasoningTokens > 0 ? react.createElement("span", { key: "reasoning" }, ["推理 ", react.createElement("strong", { key: "v" }, fmtCompact(total.reasoningTokens))]) : null
                                    ]),
                                    react.createElement("div", { key: "hitbar", className: "dts-hit" }, [
                                        react.createElement("span", { key: "l" }, "缓存命中率"),
                                        react.createElement("div", { key: "t", className: "dts-hit-track" }, react.createElement("div", { key: "f", className: "dts-hit-fill", style: { width: `${Math.min(100, hitRate)}%` } })),
                                        react.createElement("span", { key: "v", style: NUM }, `${hitRate.toFixed(1)}%`)
                                    ])
                                ]),
                                sessList.length > 0
                                    ? react.createElement("div", { key: "reconcile", className: "dts-reconcile" }, [
                                        react.createElement("span", { key: "icon", style: { color: STYLE.accent, fontSize: 15 } }, "↳"),
                                        react.createElement("span", { key: "copy" }, [
                                            "对账：",
                                            react.createElement("strong", { key: "top" }, `顶层会话 ${fmtCompact(topBilled)}`),
                                            " ＋ ",
                                            react.createElement("strong", { key: "sub" }, `子代理会话 ${fmtCompact(subBilled)}（${subSess.length} 个）`),
                                            " ＝ ",
                                            react.createElement("strong", { key: "total" }, `总计 ${fmtCompact(billedTotal)}`),
                                            "　GUI 会话列表只显示顶层会话，插件统计全部会话（含子代理）"
                                        ])
                                    ])
                                    : null,
                                heading("模型明细", `${Object.values(providers || {}).reduce((n, pv) => n + Object.keys(pv.models).length, 0)} 个模型`),
                                providerRows.length > 0
                                    ? react.createElement("div", { key: "prov-chips", className: "dts-provider-chips", "aria-label": "提供商汇总" }, providerRows.map((p) => {
                                        const ratio = billedTotal > 0 ? Math.max(0, Math.min(100, (p.billed / billedTotal) * 100)) : 0;
                                        return react.createElement("span", { key: p.name, className: "dts-provider-chip", title: `${p.name}\n计费输入 ${fmt(p.billed)}\n请求 ${fmt(p.requests)}` }, [
                                            react.createElement("strong", { key: "n" }, p.name),
                                            react.createElement("span", { key: "v", style: NUM }, fmtCompact(p.billed)),
                                            react.createElement("span", { key: "bar", className: "dts-pc-bar" }, react.createElement("i", { style: { width: `${ratio}%` } })),
                                            react.createElement("span", { key: "pct", className: "dts-pc-pct", style: NUM }, `${ratio.toFixed(0)}%`)
                                        ]);
                                    }))
                                    : null,
                                modelTable,
                                sessList.length > 0
                                    ? [
                                        heading("会话明细", `${sessList.length} 个会话`),
                                        topSess.length > 0 ? react.createElement(react.Fragment, { key: "top" }, react.createElement("div", { className: "dts-group-label" }, `顶层会话（${topSess.length}）`), sessionTable(topSess)) : null,
                                        subSess.length > 0 ? react.createElement(react.Fragment, { key: "sub" }, react.createElement("div", { className: "dts-group-label" }, `子代理会话（${subSess.length}）`), sessionTable(subSess)) : null
                                    ]
                                    : null,
                                heading("最近 7 天", chartDays.length > 0 ? `按自然日 · 近 7 天合计 ${fmtCompact(chartDays.reduce((a, d) => a + d.input, 0))}` : "按自然日"),
                                react.createElement("div", { key: "chart-wrap", className: "dts-chart-wrap" }, [
                                    react.createElement("div", { key: "legend", className: "dts-legend" }, [
                                        react.createElement("span", { key: "in" }, [react.createElement("i", { key: "dot" }), "计费输入"]),
                                        react.createElement("span", { key: "out" }, [react.createElement("i", { key: "dot", className: "muted" }), "输出"])
                                    ]),
                                    react.createElement("div", { key: "chart", className: "dts-chart" }, chartDays.map((d, i) => {
                                        const isEmpty = d.input === 0 && d.output === 0;
                                        const bars = isEmpty
                                            ? react.createElement("div", { key: "bars", className: "dts-chart-bars dts-chart-bars-empty", title: `${d.day}\n无活动` }, [
                                                react.createElement("span", { key: "dot", className: "dts-chart-dot", "aria-hidden": true })
                                            ])
                                            : react.createElement("div", { key: "bars", className: "dts-chart-bars" }, [
                                                react.createElement("div", { key: "in", className: "dts-chart-bar", style: { height: Math.max(2, Math.round((d.input / chartMax) * BAR_H)), background: STYLE.accent, opacity: i === chartDays.length - 1 ? 1 : .88 }, title: `${d.day}\n计费输入 ${fmt(d.input)}` }),
                                                react.createElement("div", { key: "out", className: "dts-chart-bar", style: { height: Math.max(2, Math.round((d.output / chartMax) * BAR_H)), background: STYLE.labelTertiary, opacity: .55 }, title: `${d.day}\n输出 ${fmt(d.output)}` })
                                            ]);
                                        return react.createElement("div", { key: d.day, className: "dts-chart-day", title: isEmpty ? `${d.day}\n无活动` : `${d.day}\n计费输入 ${fmt(d.input)}\n输出 ${fmt(d.output)}` }, [
                                            bars,
                                            react.createElement("div", { key: "label", className: "dts-chart-label", style: i === chartDays.length - 1 ? { fontWeight: 700, color: STYLE.labelPrimary } : undefined }, d.day.slice(5))
                                        ]);
                                    }))
                                ]),
                                historyTable,
                                stMonthSection(stMonthOpen, stSetMonthOpen, month30, loadMonth, loadingMonth)
                            ]
                            : react.createElement("div", { key: "empty", className: "dts-empty" }, "今天还没有记录到模型调用。")
            ]);
        }
        // ── 插件注册 ─────────────────────────────────────────────────────────
        const inject = ["slots"];
        function apply(ctx) {
            ctx.effect(() => ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register({
                name: "sidebar.footer.action",
                id: "token-stats",
                order: 200,
                label: "显示/隐藏用量宠物"
            }, PetToggleWidget)), "token-stats: sidebar pet toggle");
            ctx.effect(() => ctx.slots.inject("shell.overlay", () => ctx.slots.register({
                name: "shell.overlay",
                id: "token-stats-pet",
                order: 1000,
                label: "用量宠物"
            }, TokenStatsPet)), "token-stats: floating pet");
            ctx.effect(() => ctx.slots.inject("settings.section", () => ctx.slots.register({
                name: "settings.section",
                id: "token-stats",
                order: 90,
                label: "用量统计"
            }, TokenStatsSectionPolished)), "token-stats: settings section");
        }
        exports.apply = apply;
        exports.inject = inject;
        return module.exports;
    }
});
