/**
 * dsh-token-stats — 客户端插件（AMD bundle，由前端 /plugins/dsh-token-stats/client.js 加载）。
 *
 * 挂载点：
 *  - sidebar.footer.action —— 侧边栏底部常驻小部件（今日 token 总计，k/m/b 缩写，
 *    点击展开按提供商/模型明细）
 *  - settings.section —— 设置页"用量统计"分区：
 *      KPI 卡片（请求/计费输入/输出/缓存读）+ 缓存命中率与均值
 *      + 今日明细表（含占比条）+ 最近 7 天迷你柱状图与历史表
 *
 * 数据：同源 fetch /token-stats/summary 与 /token-stats/history（由服务端插件提供），
 * 每 30s 轮询 + 窗口聚焦/可见时刷新。
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
			if (Math.abs(v) >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
			if (Math.abs(v) >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
			if (Math.abs(v) >= 1e3) return `${(v / 1e3).toFixed(1)}k`;
			return Number.isInteger(v) ? String(v) : String(Math.round(v * 10) / 10);
		};

		const pct = (part, whole) => (whole > 0 ? (part / whole) * 100 : 0);

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

		// ── 侧边栏小部件（缩写） ────────────────────────────────────────────
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
							{ key: "text", style: NUM },
							error
								? "用量统计不可用"
								: total
									? `今日 ${fmtCompact(billedInput(total))} / ${fmtCompact(total.outputTokens)} tok`
									: "今日 0 tok"
						)
					]
				),
				open && total
					? react.createElement(
							"div",
							{ key: "detail", style: { padding: "2px 8px 6px 22px", whiteSpace: "pre-wrap" } },
							[
								react.createElement(
									"div",
									{ key: "req", style: { color: STYLE.labelSecondary } },
									`请求 ${total.requests} 次${total.reasoningTokens > 0 ? ` · 推理 ${fmtCompact(total.reasoningTokens)}` : ""}`
								),
								...Object.entries(providers || {}).map(([provider, pv]) =>
									react.createElement(
										"div",
										{ key: provider, style: { color: STYLE.labelSecondary } },
										Object.entries(pv.models)
											.map(
												([model, ms]) =>
													`${provider}/${model}: ${fmtCompact(billedInput(ms))}/${fmtCompact(ms.outputTokens)} (×${ms.requests})`
											)
											.join("\n")
									)
								)
							]
						)
					: null
			);
		}

		// ── 设置页通用小块 ──────────────────────────────────────────────────
		/** KPI 卡片：小标签 + 大数字 + 可选副行。 */
		const kpiCard = (label, value, sub) =>
			react.createElement(
				"div",
				{
					key: label,
					style: {
						flex: "1 1 0",
						minWidth: 0,
						background: STYLE.surfaceL1,
						border: `1px solid ${STYLE.borderL1}`,
						borderRadius: 8,
						padding: "10px 12px"
					}
				},
				[
					react.createElement("div", { key: "l", style: { fontSize: 11, color: STYLE.labelSecondary, marginBottom: 4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } }, label),
					react.createElement("div", { key: "v", style: { fontSize: 20, fontWeight: 600, color: STYLE.labelPrimary, ...NUM, lineHeight: 1.2 } }, value),
					sub
						? react.createElement("div", { key: "s", style: { fontSize: 11, color: STYLE.labelTertiary, marginTop: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } }, sub)
						: null
				]
			);

		/** 占比条：轨道 + 填充（0~1）。 */
		const shareBar = (ratio) =>
			react.createElement(
				"div",
				{
					style: {
						width: 72,
						height: 6,
						borderRadius: 3,
						background: STYLE.surfaceL2,
						overflow: "hidden",
						flex: "none"
					}
				},
				react.createElement("div", {
					style: {
						width: `${Math.max(0, Math.min(100, ratio * 100))}%`,
						height: "100%",
						borderRadius: 3,
						background: STYLE.accent,
						opacity: 0.85
					}
				})
			);

		/** 表格行 hover 高亮。 */
		const rowHover = {
			onMouseEnter: (e) => (e.currentTarget.style.background = STYLE.fillHover),
			onMouseLeave: (e) => (e.currentTarget.style.background = "none")
		};

		// ── 设置页分区 ───────────────────────────────────────────────────────
		function TokenStatsSection(props) {
			const { summary, history, error } = useStats(30000);
			const total = summary ? summary.total : null;
			const providers = summary ? summary.providers : null;
			const today = summary ? summary.day : todayKey();

			const tableStyle = {
				width: "100%",
				borderCollapse: "collapse",
				fontSize: 12.5,
				marginTop: 8,
				color: STYLE.labelPrimary
			};
			const thStyle = {
				textAlign: "left",
				padding: "6px 10px",
				borderBottom: `1px solid ${STYLE.borderL2}`,
				fontWeight: 600,
				fontSize: 11,
				color: STYLE.labelSecondary,
				whiteSpace: "nowrap"
			};
			const tdStyle = {
				padding: "6px 10px",
				borderBottom: `1px solid ${STYLE.borderL1}`,
				whiteSpace: "nowrap"
			};

			// 今日聚合指标
			const billedTotal = billedInput(total);
			const hitRate = pct(total ? total.cacheReadTokens : 0, billedTotal);
			const avgIn = total && total.requests > 0 ? billedTotal / total.requests : 0;
			const avgOut = total && total.requests > 0 ? total.outputTokens / total.requests : 0;

			// 7 天柱状图数据（旧 → 新）
			const chartDays = (history && history.days ? [...history.days].reverse() : []).map((d) => ({
				day: d.day,
				input: billedInput(d.total),
				output: d.total.outputTokens
			}));
			const chartMax = Math.max(1, ...chartDays.map((d) => Math.max(d.input, d.output)));
			const BAR_H = 56;

			return react.createElement(
				"div",
				{ style: { padding: "4px 0 16px" } },
				react.createElement(
					"h3",
					{ style: { margin: "0 0 10px", fontSize: 14, color: STYLE.labelPrimary } },
					`今日 token 用量（${today}）`
				),
				error
					? react.createElement("p", { style: { color: STYLE.labelSecondary, fontSize: 13 } }, `统计接口不可用：${error}（请确认 dsh-token-stats 服务端插件已加载）`)
					: total
						? react.createElement(
								"div",
								null,
								// KPI 卡片行
								react.createElement(
									"div",
									{ style: { display: "flex", gap: 8, marginBottom: 6 } },
									[
										kpiCard("请求次数", fmt(total.requests), total.reasoningTokens > 0 ? `推理 ${fmt(total.reasoningTokens)}` : null),
										kpiCard("计费输入", fmtCompact(billedTotal), `未缓存 ${fmtCompact(total.inputTokens)}`),
										kpiCard("输出", fmtCompact(total.outputTokens), null),
										kpiCard("缓存读", fmtCompact(total.cacheReadTokens), `命中率 ${hitRate.toFixed(1)}%`)
									]
								),
								// 均值指标行
								react.createElement(
									"p",
									{
										style: {
											margin: "2px 0 12px",
											fontSize: 12,
											color: STYLE.labelTertiary
										}
									},
									`缓存命中率 ${hitRate.toFixed(1)}% · 平均输入 ${fmtCompact(avgIn)}/请求 · 平均输出 ${fmtCompact(avgOut)}/请求`
								),
								// 今日明细表
								react.createElement(
									"table",
									{ style: tableStyle },
									react.createElement(
										"thead",
										null,
										react.createElement(
											"tr",
											null,
											["提供商", "模型", "计费输入", "未缓存", "缓存读", "输出", "推理", "请求", "占比"].map((h) =>
												react.createElement("th", { key: h, style: thStyle }, h)
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
														react.createElement("td", { key: "p", style: tdStyle, title: provider }, provider),
														react.createElement("td", { key: "m", style: { ...tdStyle, fontWeight: 600 }, title: model }, model),
														react.createElement("td", { key: "b", style: { ...tdStyle, ...NUM } }, fmt(billed)),
														react.createElement("td", { key: "i", style: { ...tdStyle, ...NUM } }, fmt(ms.inputTokens)),
														react.createElement("td", { key: "cr", style: { ...tdStyle, ...NUM } }, fmt(ms.cacheReadTokens)),
														react.createElement("td", { key: "o", style: { ...tdStyle, ...NUM } }, fmt(ms.outputTokens)),
														react.createElement("td", { key: "r", style: { ...tdStyle, ...NUM } }, ms.reasoningTokens > 0 ? fmt(ms.reasoningTokens) : "—"),
														react.createElement("td", { key: "n", style: { ...tdStyle, ...NUM } }, String(ms.requests)),
														react.createElement(
															"td",
															{ key: "s", style: { ...tdStyle, ...NUM } },
															react.createElement(
																"div",
																{ style: { display: "flex", alignItems: "center", gap: 6 } },
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
								// 最近 7 天
								react.createElement(
									"h3",
									{ style: { margin: "20px 0 4px", fontSize: 14, color: STYLE.labelPrimary } },
									"最近 7 天"
								),
								react.createElement(
									"div",
									{
										style: {
											display: "flex",
											alignItems: "flex-end",
											gap: 10,
											padding: "12px 4px 4px",
											overflowX: "auto"
										}
									},
									chartDays.map((d) =>
										react.createElement(
											"div",
											{
												key: d.day,
												title: `${d.day}\n输入 ${fmt(d.input)}\n输出 ${fmt(d.output)}`,
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
																width: 9,
																height: Math.max(2, Math.round((d.input / chartMax) * BAR_H)),
																borderRadius: "2px 2px 0 0",
																background: STYLE.accent,
																opacity: 0.9
															}
														}),
														react.createElement("div", {
															key: "out",
															style: {
																width: 9,
																height: Math.max(2, Math.round((d.output / chartMax) * BAR_H)),
																borderRadius: "2px 2px 0 0",
																background: STYLE.labelTertiary,
																opacity: 0.75
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
											{ style: tableStyle },
											react.createElement(
												"thead",
												null,
												react.createElement(
													"tr",
													null,
													["日期", "计费输入", "缓存读", "输出", "请求"].map((h) =>
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
														{ key: row.day, ...rowHover },
														[
															react.createElement("td", { key: "d", style: { ...tdStyle, ...NUM } }, row.day),
															react.createElement("td", { key: "i", style: { ...tdStyle, ...NUM } }, fmt(billedInput(row.total))),
															react.createElement("td", { key: "cr", style: { ...tdStyle, ...NUM } }, fmt(row.total.cacheReadTokens)),
															react.createElement("td", { key: "o", style: { ...tdStyle, ...NUM } }, fmt(row.total.outputTokens)),
															react.createElement("td", { key: "n", style: { ...tdStyle, ...NUM } }, String(row.total.requests))
														]
													)
												)
											)
										)
									: react.createElement("p", { style: { color: STYLE.labelSecondary, fontSize: 13 } }, "暂无历史数据。")
							)
						: react.createElement("p", { style: { color: STYLE.labelSecondary, fontSize: 13 } }, "今天还没有记录到模型调用。")
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
