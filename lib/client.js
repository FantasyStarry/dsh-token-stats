/**
 * dsh-token-stats — 客户端插件（AMD bundle，由前端 /plugins/dsh-token-stats/client.js 加载）。
 *
 * 挂载点：
 *  - sidebar.footer.action —— 侧边栏底部常驻小部件（今日 token 总计，点击展开按提供商/模型明细）
 *  - settings.section —— 设置页"用量统计"分区（今日明细表 + 最近 7 天历史）
 *
 * 数据：同源 fetch /token-stats/summary 与 /token-stats/history（由服务端插件提供），
 * 每 30s 轮询 + 窗口聚焦/可见时刷新。
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
		const fmt = (n) => Number(n || 0).toLocaleString("zh-CN");

		const todayKey = () => {
			const d = new Date();
			return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
		};

		const fetchJson = async (url) => {
			const res = await fetch(url, { cache: "no-store" });
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			return res.json();
		};

		/** 轮询 + 聚焦刷新的数据钩子。 */
		const useStats = (intervalMs = 30000) => {
			const [summary, setSummary] = react.useState(null);
			const [history, setHistory] = react.useState(null);
			const [error, setError] = react.useState(null);
			const load = react.useCallback(() => {
				fetchJson(`/token-stats/summary?day=${todayKey()}`)
					.then((data) => {
						setSummary(data);
						setError(null);
					})
					.catch((e) => setError(String(e && e.message ? e.message : e)));
				fetchJson("/token-stats/history?days=7")
					.then(setHistory)
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
			return { summary, history, error };
		};

		const billedInput = (stats) => (stats ? stats.inputTokens + stats.cacheReadTokens + stats.cacheWriteTokens : 0);

		// ── 样式（复用宿主 CSS 变量，带回退值） ───────────────────────────────
		const STYLE = {
			labelPrimary: "var(--dsw-alias-label-primary, #1f2329)",
			labelSecondary: "var(--dsw-alias-label-secondary, #646a73)",
			border: "var(--dsw-alias-border-l2, rgba(128,128,128,.25))",
			fillHover: "var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.12))",
			accent: "var(--dsw-alias-accent, #3370ff)"
		};

		// ── 侧边栏小部件 ─────────────────────────────────────────────────────
		function TokenStatsWidget(props) {
			const { summary, error } = useStats(30000);
			const [open, setOpen] = react.useState(false);
			const total = summary ? summary.total : null;
			const providers = summary ? summary.providers : null;

			return react.createElement(
				"div",
				{
					style: {
						display: "flex",
						flexDirection: "column",
						fontSize: 12,
						lineHeight: 1.5,
						color: STYLE.labelSecondary,
						padding: "2px 0"
					}
				},
				react.createElement(
					"button",
					{
						type: "button",
						onClick: () => setOpen(!open),
						title: "今日 LLM token 用量（点击展开明细）",
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
					},
					[
						react.createElement("span", { key: "dot", style: { width: 8, height: 8, borderRadius: "50%", background: STYLE.accent, flex: "none" } }),
						react.createElement(
							"span",
							{ key: "text" },
							error
								? "用量统计不可用"
								: total
									? `今日 ${fmt(billedInput(total))} / ${fmt(total.outputTokens)} tok`
									: "今日 0 tok"
						)
					]
				),
				open && total
					? react.createElement(
							"div",
							{ key: "detail", style: { padding: "4px 8px 6px 22px", whiteSpace: "pre-wrap" } },
							[
								react.createElement("div", { key: "req", style: { color: STYLE.labelSecondary } }, `请求 ${total.requests} 次 · 推理 ${fmt(total.reasoningTokens)}`),
								...Object.entries(providers || {}).map(([provider, pv]) =>
									react.createElement(
										"div",
										{ key: provider, style: { color: STYLE.labelSecondary } },
										Object.entries(pv.models)
											.map(
												([model, ms]) =>
													`${provider}/${model}: ${fmt(billedInput(ms))}/${fmt(ms.outputTokens)} (×${ms.requests})`
											)
											.join("\n")
									)
								)
							]
						)
					: null
			);
		}

		// ── 设置页分区 ───────────────────────────────────────────────────────
		function TokenStatsSection(props) {
			const { summary, history, error } = useStats(30000);
			const total = summary ? summary.total : null;
			const providers = summary ? summary.providers : null;
			const today = summary ? summary.day : todayKey();

			const tableStyle = {
				width: "100%",
				borderCollapse: "collapse",
				fontSize: 13,
				marginTop: 8,
				color: STYLE.labelPrimary
			};
			const thStyle = {
				textAlign: "left",
				padding: "6px 10px",
				borderBottom: `1px solid ${STYLE.border}`,
				fontWeight: 600,
				color: STYLE.labelSecondary,
				whiteSpace: "nowrap"
			};
			const tdStyle = {
				padding: "6px 10px",
				borderBottom: `1px solid ${STYLE.border}`,
				whiteSpace: "nowrap"
			};

			return react.createElement(
				"div",
				{ style: { padding: "4px 0 16px" } },
				react.createElement(
					"h3",
					{ style: { margin: "0 0 4px", fontSize: 14, color: STYLE.labelPrimary } },
					`今日 token 用量（${today}）`
				),
				error
					? react.createElement("p", { style: { color: STYLE.labelSecondary, fontSize: 13 } }, `统计接口不可用：${error}（请确认 dsh-token-stats 服务端插件已加载）`)
					: total
						? react.createElement(
								"div",
								null,
								react.createElement(
									"p",
									{ style: { margin: 0, fontSize: 13, color: STYLE.labelSecondary } },
									`总计：输入 ${fmt(billedInput(total))}（缓存读 ${fmt(total.cacheReadTokens)}）· 输出 ${fmt(total.outputTokens)} · 推理 ${fmt(total.reasoningTokens)} · 请求 ${total.requests} 次`
								),
								react.createElement(
									"table",
									{ style: tableStyle },
									react.createElement(
										"thead",
										null,
										react.createElement(
											"tr",
											null,
											["提供商", "模型", "输入", "缓存读", "输出", "推理", "请求"].map((h) =>
												react.createElement("th", { key: h, style: thStyle }, h)
											)
										)
									),
									react.createElement(
										"tbody",
										null,
										Object.entries(providers || {}).flatMap(([provider, pv]) =>
											Object.entries(pv.models).map(([model, ms]) =>
												react.createElement(
													"tr",
													{ key: `${provider}:${model}` },
													[
														react.createElement("td", { key: "p", style: tdStyle }, provider),
														react.createElement("td", { key: "m", style: tdStyle }, model),
														react.createElement("td", { key: "i", style: tdStyle }, fmt(ms.inputTokens)),
														react.createElement("td", { key: "cr", style: tdStyle }, fmt(ms.cacheReadTokens)),
														react.createElement("td", { key: "o", style: tdStyle }, fmt(ms.outputTokens)),
														react.createElement("td", { key: "r", style: tdStyle }, fmt(ms.reasoningTokens)),
														react.createElement("td", { key: "n", style: tdStyle }, String(ms.requests))
													]
												)
											)
										)
									)
								)
							)
						: react.createElement("p", { style: { color: STYLE.labelSecondary, fontSize: 13 } }, "今天还没有记录到模型调用。"),
				react.createElement(
					"h3",
					{ style: { margin: "20px 0 4px", fontSize: 14, color: STYLE.labelPrimary } },
					"最近 7 天"
				),
				history && history.days && history.days.length > 0
					? react.createElement(
							"table",
							{ style: tableStyle },
							react.createElement(
								"thead",
								null,
								react.createElement(
									"tr",
									null,
									["日期", "输入", "缓存读", "输出", "推理", "请求"].map((h) =>
										react.createElement("th", { key: h, style: thStyle }, h)
									)
								)
							),
							react.createElement(
								"tbody",
								null,
								history.days.map((row) =>
									react.createElement(
										"tr",
										{ key: row.day },
										[
											react.createElement("td", { key: "d", style: tdStyle }, row.day),
											react.createElement("td", { key: "i", style: tdStyle }, fmt(row.total.inputTokens)),
											react.createElement("td", { key: "cr", style: tdStyle }, fmt(row.total.cacheReadTokens)),
											react.createElement("td", { key: "o", style: tdStyle }, fmt(row.total.outputTokens)),
											react.createElement("td", { key: "r", style: tdStyle }, fmt(row.total.reasoningTokens)),
											react.createElement("td", { key: "n", style: tdStyle }, String(row.total.requests))
										]
									)
								)
							)
						)
					: react.createElement("p", { style: { color: STYLE.labelSecondary, fontSize: 13 } }, "暂无历史数据。")
			);
		}

		// ── 插件注册 ─────────────────────────────────────────────────────────
		const inject = ["slots"];

		function apply(ctx) {
			ctx.effect(
				() =>
					ctx.slots.inject("sidebar.footer.action", () =>
						ctx.slots.register(
							{
								name: "sidebar.footer.action",
								id: "token-stats",
								order: 200,
								label: "今日 token 用量"
							},
							TokenStatsWidget
						)
					),
				"token-stats: sidebar widget"
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
