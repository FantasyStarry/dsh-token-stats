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
 *    （v0.9.1：身体径向渐变、晕眩螺旋眼自旋替代 X 眼、面板标题小史莱姆、空态史莱姆）
 *  - settings.section —— 设置页"用量统计"分区（克制数据面板 v0.3.1）：
 *      无卡片盒子：一个主数字（计费输入）+ 三个次级数字，靠留白分隔
 *      + 一行次要指标（命中率/均值）+ 一行对账（顶层 ＋ 子代理 ＝ 总计）
 *      + 模型明细表（发丝分隔线、数字右对齐等宽、细占比条）
 *      + 会话明细表（顶层 / 子代理分组，子代理标注父会话）
 *      + 最近 7 天迷你柱状图（带图例）与逐日表
 *      + （v0.9.1）近 7 天趋势 sparkline + 较昨日增幅、命中率展示去重、刷新旋转、
 *        空态史莱姆、"今天"标签、次级指标分隔线修正
 *      + （v0.9.2）GitHub 风格「活跃热力图」：周×星期网格，按计费输入 5 档
 *        （非零日四分位数），今天描边、月份/星期标尺，懒加载近 12 个月；
 *      + （v0.9.3）热力图悬浮卡片（日期星期/档位点/计费输入/输出/请求）；
 *        宠物弹窗内嵌迷你热力图（近 30 周，模块级缓存每次页面加载只拉一次）；
 *      + （v0.9.4）设置页日期导航：‹ › 切换浏览近 365 天内任意一天（历史天标题
 *        「当日用量」+「回到今天」，刷新按所选天重载）；模型明细一键导出 CSV（BOM）；
 *      + （v0.9.7）热力图格子点击 → 跳到该天「当日用量」视图（平滑滚动定位）；
 *        会话 ID 可点击复制完整值（✓ 反馈 1.5s）；
 *      + （v0.9.8）会话表子代理「子」徽标；概览卡「今日速率」（按已过时长折算）；
 *        热力图月份标签悬停显示该月合计；
 *      + （v0.9.10）热力图格子键盘可访问：Tab 聚焦 + Enter/Space 跳转 +
 *        聚焦显示悬浮卡片（role=button + aria-label）
 *      + （v0.10.0）费用与官方余额：概览次行「估算费用 ¥…」+「官方余额 ¥…」
 *        （GET /user/balance，DEEPSEEK_API_KEY，60s 服务端缓存），模型明细/历史
 *        表加「费用」列（无价格显示 —），热力图 tooltip 与 CSV 同步带费用，
 *        /usage 输出估算费用与官方余额；价格 = 内置 DeepSeek 参考价（空闲时段，
 *        高峰 ×2）+ 插件配置 prices 覆盖（键支持前缀匹配）
 *
 * 数据：同源 fetch /token-stats/summary、/token-stats/history 与
 * /token-stats/sessions、/token-stats/balance（由服务端插件提供），每 30s
 * 轮询 + 窗口聚焦/可见时刷新。
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
        /** 金额（元）：<1 万保留两位小数，大额 k/M 缩写；null/非有限 → —。 */
        const fmtMoney = (n) => {
            const v = Number(n ?? 0);
            if (!Number.isFinite(v))
                return "—";
            const abs = Math.abs(v);
            if (abs >= 1e6)
                return `${(v / 1e6).toFixed(2)}M`;
            if (abs >= 1e4)
                return `${(v / 1e3).toFixed(1)}k`;
            return v.toFixed(2);
        };
        const pct = (part, whole) => (whole > 0 ? (part / whole) * 100 : 0);
        const todayKey = () => {
            const d = new Date();
            return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        };
        /** 本地日期键 → Date（当天 00:00）。 */
        const parseDay = (key) => {
            const parts = key.split("-").map(Number);
            return new Date(parts[0] || 1970, (parts[1] || 1) - 1, parts[2] || 1);
        };
        /** Date → 本地日期键 YYYY-MM-DD。 */
        const keyOfDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        /** 所在周的周一（00:00）。 */
        const mondayOnOrBefore = (d) => {
            const c = new Date(d.getFullYear(), d.getMonth(), d.getDate());
            c.setDate(c.getDate() - ((c.getDay() + 6) % 7));
            return c;
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
            const [balance, setBalance] = react.useState(null);
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
                fetchJson("/token-stats/balance")
                    .then(setBalance)
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
            return { summary, history, sessions, balance, error, lastUpdated, reload: load };
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
        /**
         * GitHub 风格活跃热力图数据：列 = 周（周一起），行 = 周一..周日；
         * 档位按计费输入的非零日四分位数划分，单日爆量不会压扁其余档位。
         */
        const buildHeatGrid = (data) => {
            const todayK = todayKey();
            const rows = data && data.days && data.days.length > 0
                ? data.days
                : [
                    {
                        day: todayK,
                        total: { requests: 0, inputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0, reasoningTokens: 0 }
                    }
                ];
            const byDay = new Map(rows.map((r) => [r.day, r.total]));
            const nonzero = rows.map((r) => billedInput(r.total)).filter((v) => v > 0).sort((a, b) => a - b);
            const th = [0, 0, 0];
            if (nonzero.length >= 8) {
                const q = (p) => nonzero[Math.min(nonzero.length - 1, Math.floor(p * nonzero.length))];
                th[0] = q(0.25);
                th[1] = q(0.5);
                th[2] = q(0.75);
            }
            else if (nonzero.length > 0) {
                const mx = nonzero[nonzero.length - 1];
                th[0] = mx * 0.25;
                th[1] = mx * 0.5;
                th[2] = mx * 0.75;
            }
            const levelOf = (v) => (v <= 0 ? 0 : v <= th[0] ? 1 : v <= th[1] ? 2 : v <= th[2] ? 3 : 4);
            const cols = [];
            const cur = mondayOnOrBefore(parseDay(rows[rows.length - 1].day));
            const end = parseDay(rows[0].day <= todayK ? rows[0].day : todayK).getTime();
            let prevMonth = -1;
            let lastLabelCol = -9;
            while (cur.getTime() <= end) {
                const cells = [];
                const colMonth = cur.getMonth();
                for (let r = 0; r < 7 && cur.getTime() <= end; r++) {
                    const key = keyOfDate(cur);
                    const total = byDay.get(key);
                    const billed = total ? billedInput(total) : 0;
                    cells.push({
                        key,
                        billed,
                        output: total ? total.outputTokens : 0,
                        requests: total ? total.requests : 0,
                        cost: total && typeof total.cost === "number" ? total.cost : null,
                        level: levelOf(billed),
                        today: key === todayK
                    });
                    cur.setDate(cur.getDate() + 1);
                }
                let label = "";
                if (cols.length > 0 && colMonth !== prevMonth && cols.length - lastLabelCol >= 3) {
                    label = `${colMonth + 1}月`;
                    lastLabelCol = cols.length;
                }
                prevMonth = colMonth;
                cols.push({ label, cells });
            }
            return {
                cols,
                activeDays: rows.filter((r) => billedInput(r.total) > 0).length,
                totalBilled: rows.reduce((a, r) => a + billedInput(r.total), 0),
                spanDays: rows.length
            };
        };
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
        /** 星期中文名（Date.getDay 下标）。 */
        const WEEK_CN = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
        // ── 弹窗迷你热力图：模块级缓存（每次页面加载只拉一次 210 天 ≈ 30 周） ─────
        let miniHeatData = null;
        let miniHeatLoading = false;
        const miniHeatListeners = new Set();
        const miniHeatLoad = () => {
            if (miniHeatData || miniHeatLoading)
                return;
            miniHeatLoading = true;
            fetchJson("/token-stats/history?days=210")
                .then((d) => {
                miniHeatData = d;
                miniHeatLoading = false;
                for (const cb of miniHeatListeners)
                    cb();
            })
                .catch(() => {
                miniHeatLoading = false;
                for (const cb of miniHeatListeners)
                    cb();
            });
        };
        const miniHeatSubscribe = (cb) => {
            miniHeatListeners.add(cb);
            return () => {
                miniHeatListeners.delete(cb);
            };
        };
        const miniHeatSnapshot = () => (miniHeatData ? 1 : 0);
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
/* 晕眩：螺旋眼自旋（v0.9.1 替代 X 眼） */
.pt-eye-spin { animation: pt-eye-spin 2.8s linear infinite; transform-box: fill-box; transform-origin: 50% 50%; }
@keyframes pt-eye-spin { to { transform: rotate(360deg); } }
`;
        /** 史莱姆 SVG（纯 CSS/SVG 绘制，无图片资源；mood 决定表情，bounceKey 触发跳跃）。 */
        function SlimeSvg(props) {
            const { size, mood, bounceKey, perk, pokeKey } = props;
            // 身体径向渐变 id（useId 保证同页多实例不冲突）
            const gid = "tslg" + react.useId().replace(/[^a-zA-Z0-9]/g, "");
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
                    // 螺旋眼（自旋）：比 X 眼更像"晕"，不再像"挂了"（v0.9.1）
                    const spiral = (key, cx) => react.createElement("path", {
                        key,
                        d: `M${cx} 33.5 a1.1 1.1 0 0 1 2.2 0 a2.2 2.2 0 0 1 -4.4 0 a3.3 3.3 0 0 1 6.6 0 a4.4 4.4 0 0 1 -8.8 0`,
                        fill: "none",
                        stroke: eye,
                        strokeWidth: 1.5,
                        strokeLinecap: "round",
                        className: "pt-eye-spin"
                    });
                    const eyes = [spiral("e1", 23.5), spiral("e2", 40.5)];
                    return [
                        react.createElement("g", { key: "eyes" }, eyes),
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
                react.createElement("defs", { key: "defs" }, react.createElement("radialGradient", { key: "grad", id: gid, cx: "32%", cy: "24%", r: "88%" }, [
                    react.createElement("stop", { key: "s1", offset: "0%", style: { stopColor: `color-mix(in srgb, ${STYLE.accent} 72%, #ffffff)` } }),
                    react.createElement("stop", { key: "s2", offset: "55%", style: { stopColor: STYLE.accent } }),
                    react.createElement("stop", { key: "s3", offset: "100%", style: { stopColor: `color-mix(in srgb, ${STYLE.accent} 82%, #14285a)` } })
                ])),
                react.createElement("g", { key: "sprout", className: perk ? "ts-pet-sprout-fast" : "ts-pet-sprout" }, [
                    react.createElement("path", { key: "stem", d: "M32 9 C 32 5, 33.5 3, 36 1.5", fill: "none", stroke: STYLE.labelTertiary, strokeWidth: 2, strokeLinecap: "round" }),
                    react.createElement("ellipse", { key: "leaf", cx: 38.5, cy: 1.5, rx: 4.6, ry: 2.8, fill: STYLE.accent, opacity: 0.75, transform: "rotate(-14 38.5 1.5)" })
                ]),
                react.createElement("g", { key: "float", className: "pt-float" }, react.createElement("g", { key: "wobble", className: mood === "dizzy" ? "pt-dizzy-wobble" : undefined }, react.createElement("g", { key: "body", className: "ts-pet-breathe" }, [
                    react.createElement("path", {
                        key: "blob",
                        d: "M32 7.5 C 45 7.5, 56 20, 56 36 C 56 48, 49 56.5, 40 56.5 L 24 56.5 C 15 56.5, 8 48, 8 36 C 8 20, 19 7.5, 32 7.5 Z",
                        fill: `url(#${gid})`,
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
            // 迷你热力图：面板打开时触发一次拉取（模块级缓存，之后秒开）
            const miniHeatReady = react.useSyncExternalStore(miniHeatSubscribe, miniHeatSnapshot);
            react.useEffect(() => {
                if (open)
                    miniHeatLoad();
            }, [open]);
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
            const miniGrid = miniHeatReady === 1 && miniHeatData ? buildHeatGrid(miniHeatData) : null;
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
                            react.createElement("span", { key: "t", style: { display: "flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 700, color: STYLE.labelPrimary } }, [
                                react.createElement("span", { key: "m", style: { display: "flex", flex: "none" } }, react.createElement(SlimeSvg, { size: 18, mood: poke ? "happy" : mood })),
                                "今日用量"
                            ]),
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
                                    react.createElement("div", { key: "meta", style: { marginTop: 8, fontSize: 11.5, color: STYLE.labelTertiary } }, `${total.reasoningTokens > 0 ? `推理 ${fmtCompact(total.reasoningTokens)} · ` : ""}${typeof total.cost === "number" ? `估算费用 ¥${fmtMoney(total.cost)} · ` : ""}平均输入 ${fmtCompact(billedTotal / Math.max(1, total.requests))}/请求`),
                                    react.createElement("div", { key: "hit", style: { marginTop: 10 } }, [
                                        react.createElement("div", { key: "l", style: { display: "flex", justifyContent: "space-between", fontSize: 10.5, color: STYLE.labelTertiary, marginBottom: 4 } }, ["缓存命中率", `${hitRate.toFixed(0)}%`]),
                                        react.createElement("div", { key: "t", style: { height: 4, borderRadius: 2, background: STYLE.surfaceL2, overflow: "hidden" } }, react.createElement("div", { key: "f", style: { width: `${Math.min(100, hitRate)}%`, height: "100%", borderRadius: 2, background: STYLE.accent, opacity: 0.8 } }))
                                    ]),
                                    miniGrid
                                        ? react.createElement("div", { key: "mheat", style: { marginTop: 12 } }, [
                                            react.createElement("div", { key: "t", style: { display: "flex", justifyContent: "space-between", fontSize: 10.5, color: STYLE.labelTertiary, marginBottom: 5 } }, [
                                                react.createElement("span", { key: "a" }, `活跃热力 · 近 ${Math.max(1, Math.round(miniGrid.spanDays / 7))} 周`),
                                                react.createElement("span", { key: "b", style: NUM }, `活跃 ${miniGrid.activeDays} 天`)
                                            ]),
                                            react.createElement("div", { key: "g", className: "dts-mini-heat", style: { display: "flex", gap: 2, overflowX: "auto", paddingBottom: 2 } }, miniGrid.cols.map((c, i) => react.createElement("div", { key: i, style: { display: "flex", flexDirection: "column", gap: 2, flex: "none" } }, c.cells.map((cell) => react.createElement("div", {
                                                key: cell.key,
                                                title: `${cell.key}\n计费输入 ${fmt(cell.billed)}${typeof cell.cost === "number" ? `\n估算费用 ¥${fmtMoney(cell.cost)}` : ""}`,
                                                style: {
                                                    width: 6,
                                                    height: 6,
                                                    borderRadius: 1.5,
                                                    flex: "none",
                                                    background: cell.level === 0 ? STYLE.surfaceL2 : cell.level === 4 ? STYLE.accent : `color-mix(in srgb, ${STYLE.accent} ${cell.level * 25}%, transparent)`,
                                                    boxShadow: cell.today ? `inset 0 0 0 1px ${STYLE.labelPrimary}` : undefined
                                                }
                                            })))))
                                        ])
                                        : null,
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
                                            react.createElement("div", { key: "bars", style: { display: "flex", alignItems: "flex-end", gap: 6, height: CHART_H + 16 } }, chartDays.map((d, i) => react.createElement("div", {
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
                                                react.createElement("div", { key: "l", style: { fontSize: 9, color: STYLE.labelTertiary, ...NUM } }, i === chartDays.length - 1 ? "今天" : d.day.slice(5))
                                            ])))
                                        ])
                                        : null,
                                    react.createElement("div", { key: "cap", style: { marginTop: 12, fontSize: 11, color: STYLE.labelTertiary } }, `近 7 天合计 ${fmtCompact(chartDays.reduce((a, d) => a + d.input, 0))} · 完整明细见 设置 → 用量统计`)
                                ])
                                : react.createElement("div", { key: "empty", style: { display: "flex", flexDirection: "column", alignItems: "center", gap: 6, color: STYLE.labelSecondary, fontSize: 12.5, marginTop: 10 } }, react.createElement(SlimeSvg, { size: 40, mood: "sleepy" }), "今天还没有记录到模型调用。")
                    ])
                    : null
            ]);
        }
        // ── 更清晰的设置页数据面板 ────────────────────────────────────────────
        /**
         * 历史钩子（fetch /token-stats/history?days=N，30 天表 / 活跃热力图共用）。
         * 复用 useStats 已有的 fetchJson / setInterval 风格，但与主钩子解耦：
         * 仅当用户展开对应面板时才发起请求，避免一上来拉多次接口。
         */
        const stUseHistory = (days) => {
            const [month, setMonth] = react.useState(null);
            const [loading, setLoading] = react.useState(false);
            const load = react.useCallback(() => {
                setLoading(true);
                fetchJson(`/token-stats/history?days=${days}`)
                    .then((d) => {
                    setMonth(d);
                    setLoading(false);
                })
                    .catch(() => setLoading(false));
            }, []);
            return { month, load, loading };
        };
        function TokenStatsSectionPolished(props) {
            const { summary, history, sessions, balance, error, lastUpdated, reload } = useStats(30000);
            const { month: month30, load: loadMonth, loading: loadingMonth } = stUseHistory(30);
            /** 活跃热力图（近 12 个月，懒加载；服务端上限放宽前最多返回 30 天）。 */
            const heat = stUseHistory(366);
            /** 热力图折叠开关（默认展开）。 */
            const [stHeatOpen, stSetHeatOpen] = react.useState(true);
            react.useEffect(() => {
                if (stHeatOpen)
                    heat.load();
            }, []);
            /** 热力图默认滚动到最右（今天），窄容器下无需手动找。 */
            const heatWrapRef = react.useRef(null);
            react.useEffect(() => {
                if (stHeatOpen && heat.month && heatWrapRef.current) {
                    heatWrapRef.current.scrollLeft = heatWrapRef.current.scrollWidth;
                }
            }, [stHeatOpen, heat.month]);
            /** 热力图悬浮卡片（富 tooltip，替代原生 title）。 */
            const [heatTip, setHeatTip] = react.useState(null);
            /** 会话 ID 点击复制（1.5s ✓ 反馈）。 */
            const [copiedId, setCopiedId] = react.useState(null);
            const copyTimer = react.useRef(null);
            react.useEffect(() => {
                return () => {
                    if (copyTimer.current)
                        clearTimeout(copyTimer.current);
                };
            }, []);
            const copySessionId = (id) => {
                const done = () => {
                    setCopiedId(id);
                    if (copyTimer.current)
                        clearTimeout(copyTimer.current);
                    copyTimer.current = setTimeout(() => setCopiedId(null), 1500);
                };
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard.writeText(id).then(done, done);
                }
                else {
                    done();
                }
            };
            /** 日期导航："" = 今天（实时轮询），否则按需拉取历史天。 */
            const [viewDay, setViewDay] = react.useState("");
            const [past, setPast] = react.useState(null);
            const [pastTick, setPastTick] = react.useState(0);
            react.useEffect(() => {
                if (!viewDay) {
                    setPast(null);
                    return;
                }
                let alive = true;
                Promise.all([
                    fetchJson(`/token-stats/summary?day=${viewDay}`).catch(() => null),
                    fetchJson(`/token-stats/sessions?day=${viewDay}`).catch(() => null)
                ]).then((pair) => {
                    if (!alive)
                        return;
                    setPast({
                        summary: pair[0],
                        sessions: pair[1],
                        error: pair[0] ? null : "加载失败"
                    });
                });
                return () => {
                    alive = false;
                };
            }, [viewDay, pastTick]);
            const isToday = viewDay === "";
            const effDay = isToday ? todayKey() : viewDay;
            const activeSummary = isToday ? summary : past && past.summary;
            const activeSessions = isToday ? sessions : past && past.sessions;
            const activeError = isToday ? error : past ? past.error : null;
            const minDay = keyOfDate(new Date(Date.now() - 365 * 86400000));
            const shiftDay = (delta) => {
                const base = viewDay || todayKey();
                const next = keyOfDate(new Date(parseDay(base).getTime() + delta * 86400000));
                if (next > todayKey() || next < minDay)
                    return;
                setViewDay(next === todayKey() ? "" : next);
            };
            const total = activeSummary ? activeSummary.total : null;
            const providers = activeSummary ? activeSummary.providers : null;
            const billedTotal = billedInput(total);
            const hitRate = pct(total ? total.cacheReadTokens : 0, billedTotal);
            const avgIn = total && total.requests > 0 ? billedTotal / total.requests : 0;
            const avgOut = total && total.requests > 0 ? total.outputTokens / total.requests : 0;
            /** 估算费用（元）；null = 该天全部模型未计价。 */
            const estCost = total && typeof total.cost === "number" ? total.cost : null;
            /** 未计价模型个数（0 = 全部计价）。 */
            const unpriced = total && typeof total.unpriced === "number" ? total.unpriced : 0;
            /** 官方余额（ok=true 时展示）。 */
            const balTotal = balance && balance.ok && typeof balance.total === "number" ? balance.total : null;
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
            const sessList = activeSessions && Array.isArray(activeSessions.sessions) ? activeSessions.sessions : [];
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
            /** 近 7 天趋势 sparkline（概览卡内：accent 折线 + 渐变面积）+ 较昨日增幅。 */
            const sparkMax = Math.max(1, ...chartDays.map((d) => d.input));
            const sparkN = chartDays.length;
            const sparkPts = chartDays.map((d, i) => {
                const x = sparkN > 1 ? (i / (sparkN - 1)) * 100 : 50;
                const y = 34 - (d.input / sparkMax) * 28;
                return `${x.toFixed(2)},${y.toFixed(2)}`;
            });
            const sparkLine = sparkPts.length > 1 ? `M${sparkPts.join(" L")}` : "";
            const sparkArea = sparkLine ? `${sparkLine} L100,36 L0,36 Z` : "";
            const sparkGid = "tsspark" + react.useId().replace(/[^a-zA-Z0-9]/g, "");
            const todayIn = sparkN > 0 ? chartDays[sparkN - 1].input : 0;
            const yestIn = sparkN > 1 ? chartDays[sparkN - 2].input : -1;
            const deltaEl = (() => {
                if (yestIn < 0)
                    return null;
                if (yestIn === 0 && todayIn > 0)
                    return react.createElement("span", { className: "dts-delta" }, "较昨日 新增");
                if (yestIn === 0)
                    return react.createElement("span", { className: "dts-delta" }, "较昨日 持平");
                const dp = ((todayIn - yestIn) / yestIn) * 100;
                const up = dp >= 0;
                const txt = Math.abs(dp) >= 9.95 ? `${Math.round(Math.abs(dp))}%` : `${Math.abs(dp).toFixed(1)}%`;
                return react.createElement("span", { className: "dts-delta", style: { color: up ? "#d76057" : "#2ebd59", ...NUM } }, `较昨日 ${up ? "↑" : "↓"} ${txt}`);
            })();
            /** 30 天折叠开关（默认收起）。 */
            const [stMonthOpen, stSetMonthOpen] = react.useState(false);
            /** 手动刷新旋转态：请求返回（lastUpdated 变化）或 4s 超时后复位。 */
            const [refreshing, setRefreshing] = react.useState(false);
            const refreshTimer = react.useRef(null);
            react.useEffect(() => {
                if (lastUpdated > 0)
                    setRefreshing(false);
            }, [lastUpdated]);
            react.useEffect(() => () => {
                if (refreshTimer.current)
                    clearTimeout(refreshTimer.current);
            }, []);
            const onRefresh = () => {
                setRefreshing(true);
                reload();
                if (!isToday)
                    setPastTick((t2) => t2 + 1);
                if (refreshTimer.current)
                    clearTimeout(refreshTimer.current);
                refreshTimer.current = setTimeout(() => setRefreshing(false), 4000);
            };
            /** 导出当前所选天的明细 CSV（模型 + 会话两段，带 BOM，Excel 直接打开不乱码）。 */
            const exportCsv = () => {
                if (!providers)
                    return;
                const esc = (v) => `"${String(v).replace(/"/g, '""')}"`;
                const lines = ["提供商,模型,计费输入,未缓存输入,缓存读,缓存写,输出,推理,请求,估算费用(元)"];
                for (const [p, pv] of Object.entries(providers)) {
                    for (const [m, ms] of Object.entries(pv.models)) {
                        lines.push([esc(p), esc(m), billedInput(ms), ms.inputTokens, ms.cacheReadTokens, ms.cacheWriteTokens, ms.outputTokens, ms.reasoningTokens, ms.requests, typeof ms.cost === "number" ? ms.cost.toFixed(4) : ""].join(","));
                    }
                }
                if (activeSessions && Array.isArray(activeSessions.sessions) && activeSessions.sessions.length > 0) {
                    lines.push("");
                    lines.push("会话明细");
                    lines.push("会话ID,子代理,父会话,计费输入,未缓存输入,缓存读,缓存写,输出,推理,请求,最后活动");
                    for (const s of activeSessions.sessions) {
                        lines.push([
                            esc(s.id),
                            s.subagent ? "是" : "否",
                            esc(s.parent || ""),
                            billedInput(s),
                            s.inputTokens,
                            s.cacheReadTokens,
                            s.cacheWriteTokens,
                            s.outputTokens,
                            s.reasoningTokens,
                            s.requests,
                            new Date(s.lastAt).toISOString()
                        ].join(","));
                    }
                }
                const blob = new Blob(["\uFEFF" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `token-stats-${effDay}.csv`;
                document.body.appendChild(a);
                a.click();
                a.remove();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
            };
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
				.dts-primary-metric { min-width: 0; padding: 14px 18px 14px 0; }
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
				.dts-trend { display: flex; align-items: center; gap: 12px; margin-top: 14px; }
				.dts-trend-label { flex: none; color: ${STYLE.labelTertiary}; font-size: 10.5px; letter-spacing: .04em; white-space: nowrap; }
				.dts-spark { flex: 1; min-width: 0; height: 36px; display: block; }
				.dts-delta { flex: none; color: ${STYLE.labelTertiary}; font-size: 11px; white-space: nowrap; }
				.dts-refresh.spin { animation: dts-spin .8s linear infinite; opacity: .55; pointer-events: none; }
				@keyframes dts-spin { to { transform: rotate(360deg); } }
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
				.dts-empty { display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 26px 18px; border: 1px dashed ${STYLE.borderL2}; border-radius: 12px; color: ${STYLE.labelSecondary}; font-size: 13px; text-align: center; }
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
					.dts-primary-metric + .dts-metric { border-left: 0; padding-left: 2px; }
					.dts-trend { gap: 10px; }
					.dts-heat-hint { display: none; }
					.dts-heat-foot { justify-content: flex-end; }
					.dts-reconcile { align-items: flex-start; }
					.dts-chart-wrap { overflow-x: auto; }
					.dts-chart { min-width: 390px; }
					/* 720：彻底让表格跟随容器，避免被内联 min-width 撑出滚动条 */
					.dts-tbl-model table, .dts-tbl-session table, .dts-table-scroll table { min-width: 0 !important; }
					/* 720：占比条在小屏视觉权重低（细占比条在模型明细里已有），再隐藏占比列保证 6 列完整（含费用） */
					.dts-tbl-model th:nth-child(10), .dts-tbl-model td:nth-child(10),
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
				.dts-heat-box { padding: 14px 16px 10px; border: 1px solid ${STYLE.borderL1}; border-radius: 12px; background: ${STYLE.surfaceL1}; }
				.dts-heat-wrap { overflow-x: auto; padding-bottom: 4px; scrollbar-color: ${STYLE.borderL2} transparent; }
				.dts-heat-row { display: flex; gap: 6px; }
				.dts-heat-wd { width: 18px; flex: none; display: flex; flex-direction: column; gap: 3px; }
				.dts-heat-wd-item { height: 9px; line-height: 9px; font-size: 9px; color: ${STYLE.labelTertiary}; }
				.dts-heat-months { display: flex; gap: 3px; margin-bottom: 4px; }
				.dts-heat-month { width: 9px; flex: none; font-size: 9px; line-height: 12px; color: ${STYLE.labelTertiary}; white-space: nowrap; }
				.dts-heat { display: flex; gap: 3px; }
				.dts-heat-col { display: flex; flex-direction: column; gap: 3px; }
				.dts-heat-cell { display: block; width: 9px; height: 9px; border-radius: 2.5px; flex: none; cursor: pointer; transition: transform 120ms ease; }
				.dts-heat-cell:hover { transform: scale(1.25); }
				.dts-heat-cell.l0 { background: ${STYLE.surfaceL2}; }
				.dts-heat-cell.l1 { background: color-mix(in srgb, ${STYLE.accent} 25%, transparent); }
				.dts-heat-cell.l2 { background: color-mix(in srgb, ${STYLE.accent} 50%, transparent); }
				.dts-heat-cell.l3 { background: color-mix(in srgb, ${STYLE.accent} 75%, transparent); }
				.dts-heat-cell.l4 { background: ${STYLE.accent}; }
				.dts-heat-cell.today { box-shadow: inset 0 0 0 1.5px ${STYLE.labelPrimary}; }
				.dts-heat-foot { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 10px; }
				.dts-heat-hint { color: ${STYLE.labelTertiary}; font-size: 10.5px; }
				.dts-heat-legend { display: inline-flex; align-items: center; gap: 4px; color: ${STYLE.labelTertiary}; font-size: 10.5px; flex: none; }
				.dts-daynav { display: flex; align-items: center; gap: 4px; flex: none; }
				.dts-daynav-btn { width: 22px; height: 28px; border: 1px solid ${STYLE.borderL1}; border-radius: 8px; background: none; color: ${STYLE.labelSecondary}; font-size: 14px; line-height: 1; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; padding: 0; }
				.dts-daynav-btn:hover:not(:disabled) { background: ${STYLE.fillHover}; color: ${STYLE.labelPrimary}; }
				.dts-daynav-btn:disabled { opacity: .35; cursor: default; }
				.dts-daynav-back { border: none; background: none; color: ${STYLE.accent}; font-size: 11px; cursor: pointer; padding: 4px 6px; border-radius: 6px; font-family: inherit; white-space: nowrap; }
				.dts-daynav-back:hover { background: ${STYLE.fillHover}; }
				.dts-cell-copy { cursor: pointer; }
				.dts-cell-copy:hover { background: ${STYLE.fillHover}; }
				.dts-heat-cell:focus-visible { outline: 2px solid ${STYLE.accent}; outline-offset: 1px; }
				@media (prefers-reduced-motion: reduce) { .dts-table-scroll tbody tr, .dts-chart-bar { transition: none; } .dts-refresh.spin { animation: none; } .dts-heat-cell { transition: none; } }
			`;
            const heading = (title, note) => react.createElement("div", { className: "dts-section-heading" }, [title, note ? react.createElement("small", { key: "note" }, note) : null]);
            /** 次级指标格：小标签 + 数值（复用 .dts-metric 分隔线样式，替代 statGroup）。 */
            const dtsMetric = (key, label, value) => react.createElement("div", { key, className: "dts-metric" }, [
                react.createElement("div", { key: "l", className: "dts-metric-label" }, label),
                react.createElement("div", { key: "v", className: "dts-metric-value", style: NUM }, value)
            ]);
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
                            react.createElement("thead", { key: "head" }, react.createElement("tr", null, ["日期", "计费输入", "费用", "缓存读", "输出", "请求"].map((h, i) => react.createElement("th", { key: h, style: i === 0 ? thLeft : thStyle }, h)))),
                            react.createElement("tbody", { key: "body" }, data.days.map((row) => react.createElement("tr", { key: row.day, ...rowHover }, [
                                react.createElement("td", { key: "d", style: { ...tdStyle, ...NUM } }, row.day),
                                react.createElement("td", { key: "i", style: tdNum }, fmt(billedInput(row.total))),
                                react.createElement("td", { key: "c", style: { ...tdNum, color: typeof row.total.cost === "number" ? STYLE.labelPrimary : STYLE.labelTertiary } }, typeof row.total.cost === "number" ? `¥${fmtMoney(row.total.cost)}` : "—"),
                                react.createElement("td", { key: "cr", style: tdNum }, fmt(row.total.cacheReadTokens)),
                                react.createElement("td", { key: "o", style: tdNum }, fmt(row.total.outputTokens)),
                                react.createElement("td", { key: "n", style: tdNum }, String(row.total.requests))
                            ])))
                        ]))
                        : react.createElement("p", { key: "m-empty", style: { color: STYLE.labelSecondary, fontSize: 12.5, marginTop: 8 } }, "暂无 30 天数据。");
                return react.createElement(react.Fragment, { key: "month" }, [head, body]);
            };
            /** GitHub 风格活跃热力图（默认展开，懒加载近 12 个月）。 */
            const stHeatSection = () => {
                const grid = buildHeatGrid(heat.month);
                const monthTotals = new Map();
                for (const c of grid.cols) {
                    for (const cell of c.cells) {
                        const mk = cell.key.slice(0, 7);
                        monthTotals.set(mk, (monthTotals.get(mk) || 0) + cell.billed);
                    }
                }
                const spanText = grid.spanDays >= 360 ? "近 12 个月" : `近 ${grid.spanDays} 天`;
                const note = `${spanText} · 活跃 ${grid.activeDays} 天 · 合计 ${fmtCompact(grid.totalBilled)}`;
                const heatByKey = new Map(grid.cols.flatMap((c) => c.cells.map((cell) => [cell.key, cell])));
                const pickCell = (cell) => {
                    setViewDay(cell.key === todayKey() ? "" : cell.key);
                    const ov = document.querySelector(".dts-overview");
                    if (ov)
                        ov.scrollIntoView({ behavior: "smooth", block: "center" });
                };
                const toggle = () => {
                    const next = !stHeatOpen;
                    stSetHeatOpen(next);
                    if (next && !heat.month)
                        heat.load();
                };
                const head = react.createElement("div", { className: "dts-section-heading dts-section-heading-toggle", onClick: toggle, role: "button", tabIndex: 0, onKeyDown: (e) => { if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        toggle();
                    } }, "aria-expanded": stHeatOpen }, [
                    react.createElement("span", { key: "chev", className: `dts-month-chev${stHeatOpen ? " open" : ""}`, "aria-hidden": true }, "▸"),
                    "活跃热力图",
                    react.createElement("small", { key: "note" }, heat.month ? note : "近 12 个月 · 按每日计费输入分档"),
                ]);
                if (!stHeatOpen)
                    return head;
                const body = !heat.month
                    ? react.createElement("div", { key: "h-load", className: "dts-loading", style: { padding: "18px 16px" } }, react.createElement("div", { className: "dts-loading-bar" }, react.createElement("i")))
                    : react.createElement("div", { key: "h-box", className: "dts-heat-box" }, [
                        react.createElement("div", { key: "scroll", ref: heatWrapRef, className: "dts-heat-wrap" }, [
                            react.createElement("div", { key: "mrow", className: "dts-heat-row" }, [
                                react.createElement("div", { key: "sp", className: "dts-heat-wd", "aria-hidden": true }),
                                react.createElement("div", { key: "months", className: "dts-heat-months" }, grid.cols.map((c, i) => react.createElement("span", {
                                    key: i,
                                    className: "dts-heat-month",
                                    title: c.label ? `${c.label} 合计 ${fmtCompact(monthTotals.get(c.cells[0] ? c.cells[0].key.slice(0, 7) : "") || 0)}` : undefined
                                }, c.label)))
                            ]),
                            react.createElement("div", { key: "grow", className: "dts-heat-row" }, [
                                react.createElement("div", { key: "wd", className: "dts-heat-wd", "aria-hidden": true }, ["一", "", "三", "", "五", "", ""].map((w, i) => react.createElement("span", { key: i, className: "dts-heat-wd-item" }, w))),
                                react.createElement("div", {
                                    key: "grid",
                                    className: "dts-heat",
                                    onMouseOver: (e) => {
                                        const el = e.target?.closest(".dts-heat-cell");
                                        if (!el)
                                            return;
                                        const cell = heatByKey.get(el.getAttribute("data-key") || "");
                                        if (!cell)
                                            return;
                                        const r = el.getBoundingClientRect();
                                        setHeatTip({ cell, x: r.left + r.width / 2, y: r.top });
                                    },
                                    onMouseLeave: () => setHeatTip(null)
                                }, grid.cols.map((c, i) => react.createElement("div", { key: i, className: "dts-heat-col" }, c.cells.map((cell) => react.createElement("div", {
                                    key: cell.key,
                                    "data-key": cell.key,
                                    className: `dts-heat-cell l${cell.level}${cell.today ? " today" : ""}`,
                                    role: "button",
                                    tabIndex: 0,
                                    "aria-label": `${cell.key} 计费输入 ${fmtCompact(cell.billed)}，点击查看该天明细`,
                                    onClick: () => pickCell(cell),
                                    onFocus: (e) => {
                                        const r = e.currentTarget.getBoundingClientRect();
                                        setHeatTip({ cell, x: r.left + r.width / 2, y: r.top });
                                    },
                                    onKeyDown: (e) => {
                                        if (e.key === "Enter" || e.key === " ") {
                                            e.preventDefault();
                                            pickCell(cell);
                                        }
                                    }
                                })))))
                            ])
                        ]),
                        react.createElement("div", { key: "foot", className: "dts-heat-foot" }, [
                            react.createElement("span", { key: "hint", className: "dts-heat-hint" }, "按每日计费输入分 5 档 · 悬停看明细 · 点击查看该天"),
                            react.createElement("span", { key: "legend", className: "dts-heat-legend" }, [
                                react.createElement("span", { key: "l" }, "少"),
                                react.createElement("i", { key: "c0", className: "dts-heat-cell l0" }),
                                react.createElement("i", { key: "c1", className: "dts-heat-cell l1" }),
                                react.createElement("i", { key: "c2", className: "dts-heat-cell l2" }),
                                react.createElement("i", { key: "c3", className: "dts-heat-cell l3" }),
                                react.createElement("i", { key: "c4", className: "dts-heat-cell l4" }),
                                react.createElement("span", { key: "m" }, "多")
                            ])
                        ])
                    ]);
                const tipEl = heatTip
                    ? react.createElement("div", {
                        key: "tip",
                        className: "dts-heat-tip",
                        style: {
                            position: "fixed",
                            left: Math.min(Math.max(8, heatTip.x - 92), (window.innerWidth || 800) - 200),
                            top: Math.max(8, heatTip.y - 96),
                            width: 184,
                            background: "var(--dsw-alias-bg-layer-2, #ffffff)",
                            border: `1px solid ${STYLE.borderL2}`,
                            borderRadius: 10,
                            boxShadow: "0 8px 24px rgba(0,0,0,.16)",
                            padding: "9px 11px",
                            zIndex: 10000,
                            pointerEvents: "none",
                            fontSize: 11.5,
                            color: STYLE.labelPrimary
                        }
                    }, [
                        react.createElement("div", { key: "d", style: { fontSize: 10.5, color: STYLE.labelTertiary } }, `${heatTip.cell.key} ${WEEK_CN[parseDay(heatTip.cell.key).getDay()]}`),
                        react.createElement("div", { key: "v", style: { display: "flex", alignItems: "center", gap: 6, marginTop: 4 } }, [
                            react.createElement("span", { key: "dot", style: { width: 8, height: 8, borderRadius: 4, flex: "none", background: heatTip.cell.level === 0 ? STYLE.surfaceL2 : heatTip.cell.level === 4 ? STYLE.accent : `color-mix(in srgb, ${STYLE.accent} ${heatTip.cell.level * 25}%, transparent)` } }),
                            react.createElement("span", { key: "n", style: { fontSize: 16, fontWeight: 700, ...NUM } }, fmtCompact(heatTip.cell.billed)),
                            react.createElement("span", { key: "u", style: { fontSize: 10.5, color: STYLE.labelTertiary } }, "计费输入")
                        ]),
                        react.createElement("div", { key: "s", style: { marginTop: 3, fontSize: 10.5, color: STYLE.labelSecondary, ...NUM } }, `输出 ${fmtCompact(heatTip.cell.output)} · ${fmt(heatTip.cell.requests)} 次请求${typeof heatTip.cell.cost === "number" ? ` · 估算 ¥${fmtMoney(heatTip.cell.cost)}` : ""}`)
                    ])
                    : null;
                return react.createElement(react.Fragment, { key: "heat" }, [head, body, tipEl]);
            };
            const sessionTable = (list) => list.length === 0
                ? null
                : react.createElement("div", { className: "dts-table-scroll dts-tbl-session" }, react.createElement("table", { style: tableStyle }, [
                    react.createElement("thead", { key: "head" }, react.createElement("tr", null, ["会话", "计费输入", "未缓存", "缓存读", "输出", "推理", "请求", "占比"].map((h, i) => react.createElement("th", { key: h, style: i === 0 ? thLeft : thStyle }, h)))),
                    react.createElement("tbody", { key: "body" }, list.map((s) => {
                        const billed = sessBilled(s);
                        const parent8 = s.parent ? String(s.parent).slice(0, 8) : "";
                        return react.createElement("tr", { key: s.id, ...rowHover }, [
                            react.createElement("td", { key: "id", className: "dts-cell-ellipsis dts-cell-copy", style: { ...tdStyle, ...NUM, maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis" }, title: `${s.id}（点击复制完整 ID）`, onClick: () => copySessionId(s.id) }, [
                                copiedId === s.id ? react.createElement("span", { key: "ok", style: { color: "#2ebd59", marginRight: 4, fontWeight: 700 } }, "✓") : null,
                                String(s.id).slice(0, 8),
                                s.subagent
                                    ? react.createElement("span", { key: "parent", style: { display: "inline-flex", alignItems: "center", gap: 4, marginLeft: 6, whiteSpace: "nowrap" } }, [
                                        react.createElement("span", { key: "b", style: { padding: "1px 5px", borderRadius: 4, fontSize: 10, background: "rgba(255, 110, 130, .16)", color: "#ff6e82", flex: "none" } }, "子"),
                                        react.createElement("span", { key: "p", style: { color: STYLE.labelTertiary, fontSize: 11 } }, `→ ${parent8 || "?"}`)
                                    ])
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
                react.createElement("thead", { key: "head" }, react.createElement("tr", null, ["提供商", "模型", "计费输入", "未缓存", "缓存读", "输出", "推理", "请求", "费用", "占比"].map((h, i) => react.createElement("th", { key: h, style: i < 2 ? thLeft : thStyle }, h)))),
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
                        react.createElement("td", { key: "c", style: { ...tdNum, color: typeof ms.cost === "number" ? STYLE.labelPrimary : STYLE.labelTertiary }, title: typeof ms.cost === "number" ? `估算费用 ¥${ms.cost.toFixed(4)}（按参考价）` : "该模型未配置价格（插件配置 → prices 可设置）" }, typeof ms.cost === "number" ? `¥${fmtMoney(ms.cost)}` : "—"),
                        react.createElement("td", { key: "s", style: tdNum }, react.createElement("div", { style: { display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 6 } }, [shareBar(pct(billed, billedTotal)), react.createElement("span", { key: "t", style: { color: STYLE.labelSecondary } }, `${pct(billed, billedTotal).toFixed(0)}%`)]))
                    ]);
                })))
            ]));
            const historyTable = history && history.days && history.days.length > 0
                ? react.createElement("div", { className: "dts-table-scroll", style: { marginTop: 10 } }, react.createElement("table", { style: { ...tableStyle, minWidth: 560 } }, [
                    react.createElement("thead", { key: "head" }, react.createElement("tr", null, ["日期", "计费输入", "费用", "缓存读", "输出", "请求"].map((h, i) => react.createElement("th", { key: h, style: i === 0 ? thLeft : thStyle }, h)))),
                    react.createElement("tbody", { key: "body" }, history.days.map((row) => react.createElement("tr", { key: row.day, ...rowHover }, [
                        react.createElement("td", { key: "d", style: { ...tdStyle, ...NUM } }, row.day),
                        react.createElement("td", { key: "i", style: tdNum }, fmt(billedInput(row.total))),
                        react.createElement("td", { key: "c", style: { ...tdNum, color: typeof row.total.cost === "number" ? STYLE.labelPrimary : STYLE.labelTertiary } }, typeof row.total.cost === "number" ? `¥${fmtMoney(row.total.cost)}` : "—"),
                        react.createElement("td", { key: "cr", style: tdNum }, fmt(row.total.cacheReadTokens)),
                        react.createElement("td", { key: "o", style: tdNum }, fmt(row.total.outputTokens)),
                        react.createElement("td", { key: "n", style: tdNum }, String(row.total.requests))
                    ])))
                ]))
                : react.createElement("p", { style: { color: STYLE.labelSecondary, fontSize: 13, marginTop: 8 } }, "暂无历史数据。");
            /** 空态（按所选天文案）。 */
            const emptyStateEl = react.createElement("div", { key: "empty", className: "dts-empty" }, react.createElement(SlimeSvg, { size: 46, mood: "sleepy" }), isToday ? "今天还没有记录到模型调用。" : `${effDay} 没有记录到模型调用。`);
            return react.createElement("section", { className: "dts-settings", "aria-labelledby": "dts-settings-title" }, [
                react.createElement("style", { key: "style" }, css),
                react.createElement("div", { key: "head", className: "dts-overview-head", style: { marginBottom: 14 } }, [
                    react.createElement("div", { key: "copy" }, [
                        react.createElement("div", { key: "kicker", className: "dts-kicker" }, "Token telemetry"),
                        react.createElement("h3", { key: "title", id: "dts-settings-title", className: "dts-overview-title", style: { margin: "5px 0 0" } }, isToday ? "今日用量" : "当日用量")
                    ]),
                    react.createElement("div", { key: "actions", style: { display: "flex", alignItems: "center", gap: 8, flex: "none" } }, [
                        react.createElement("div", { key: "daynav", className: "dts-daynav" }, [
                            react.createElement("button", { key: "prev", type: "button", className: "dts-daynav-btn", onClick: () => shiftDay(-1), disabled: (viewDay || todayKey()) <= minDay, title: "前一天", "aria-label": "前一天" }, "‹"),
                            react.createElement("div", { key: "d", className: "dts-overview-date", style: { minWidth: 88, textAlign: "center" } }, effDay),
                            react.createElement("button", { key: "next", type: "button", className: "dts-daynav-btn", onClick: () => shiftDay(1), disabled: isToday, title: isToday ? "已是今天" : "后一天", "aria-label": "后一天" }, "›"),
                            isToday ? null : react.createElement("button", { key: "back", type: "button", className: "dts-daynav-back", onClick: () => setViewDay("") }, "回到今天"),
                        ]),
                        react.createElement("button", { key: "csv", type: "button", onClick: exportCsv, className: "dts-refresh", title: "导出明细 CSV（模型+会话）", "aria-label": "导出明细 CSV" }, "⤓"),
                        react.createElement("button", { key: "refresh", type: "button", onClick: onRefresh, className: `dts-refresh${refreshing ? " spin" : ""}`, title: "刷新统计", "aria-label": "刷新统计" }, "↻"),
                        isToday && lastUpdated
                            ? react.createElement("div", { key: "ago", className: "dts-ago" }, `更新于 ${new Date(lastUpdated).toTimeString().slice(0, 8)}`)
                            : null
                    ])
                ]),
                activeError
                    ? react.createElement("div", { key: "error", className: "dts-error" }, `统计接口不可用：${activeError}（请确认 dsh-token-stats 服务端插件已加载）`)
                    : !activeSummary
                        ? react.createElement("div", { key: "loading", className: "dts-loading", "aria-live": "polite" }, [
                            react.createElement("div", { key: "k", className: "dts-loading-kicker" }, "正在拉取用量数据"),
                            react.createElement("div", { key: "b", className: "dts-loading-bar" }, react.createElement("i", { key: "f" }))
                        ])
                        : [
                            total && total.requests > 0 ? react.createElement(react.Fragment, { key: "day" }, [
                                react.createElement("div", { key: "overview", className: "dts-overview" }, [
                                    react.createElement("div", { key: "metrics", className: "dts-metric-grid" }, [
                                        react.createElement("div", { key: "primary", className: "dts-primary-metric" }, [
                                            react.createElement("div", { key: "label", className: "dts-kicker", style: { color: STYLE.labelTertiary, letterSpacing: ".06em" } }, "计费输入"),
                                            react.createElement("div", { key: "value", className: "dts-value", style: { ...NUM, fontSize: 26, fontWeight: 700 } }, fmtCompact(billedTotal)),
                                            react.createElement("div", { key: "desc", style: { marginTop: 6, color: STYLE.labelSecondary, fontSize: 11.5 } }, "未缓存输入 + 缓存读写")
                                        ]),
                                        dtsMetric("req", "请求", String(total.requests)),
                                        dtsMetric("out", "输出", fmtCompact(total.outputTokens)),
                                        dtsMetric("cr", "缓存读", fmtCompact(total.cacheReadTokens))
                                    ]),
                                    react.createElement("div", { key: "subline", className: "dts-subline" }, [
                                        estCost !== null
                                            ? react.createElement("span", { key: "cost", title: "按模型参考价估算（内置 DeepSeek 空闲时段价，高峰 ×2）；可在 插件配置 → prices 按模型覆盖" }, [
                                                "估算费用 ",
                                                react.createElement("strong", { key: "v", style: { color: STYLE.accent } }, `¥${fmtMoney(estCost)}`),
                                                ...(unpriced > 0 && total ? [`（${unpriced} 个模型未计价）`] : [])
                                            ])
                                            : null,
                                        balTotal !== null
                                            ? react.createElement("span", { key: "bal", title: `DeepSeek 官方 GET /user/balance（服务端 60s 缓存）${balance && balance.isAvailable === false ? "\n账户不可用：余额不足或未充值" : ""}` }, [
                                                "官方余额 ",
                                                react.createElement("strong", { key: "v" }, `¥${fmtMoney(balTotal)}`),
                                                balance && balance.currency ? `（${balance.currency}）` : ""
                                            ])
                                            : null,
                                        react.createElement("span", { key: "avg-in" }, ["平均输入 ", react.createElement("strong", { key: "v" }, `${fmtCompact(avgIn)} / 请求`)]),
                                        react.createElement("span", { key: "avg-out" }, ["平均输出 ", react.createElement("strong", { key: "v" }, `${fmtCompact(avgOut)} / 请求`)]),
                                        isToday && total && total.requests > 0
                                            ? react.createElement("span", { key: "pace" }, [
                                                "今日速率 ",
                                                react.createElement("strong", { key: "v" }, `${fmtCompact(billedTotal / Math.max(0.5, (Date.now() - parseDay(effDay).getTime()) / 3600000))} / 时`)
                                            ])
                                            : null,
                                        total.reasoningTokens > 0 ? react.createElement("span", { key: "reasoning" }, ["推理 ", react.createElement("strong", { key: "v" }, fmtCompact(total.reasoningTokens))]) : null
                                    ]),
                                    chartDays.length > 1
                                        ? react.createElement("div", {
                                            key: "trend",
                                            className: "dts-trend",
                                            title: `近 7 天计费输入\n${chartDays.map((d) => `${d.day.slice(5)} ${fmtCompact(d.input)}`).join(" · ")}`
                                        }, [
                                            react.createElement("span", { key: "l", className: "dts-trend-label" }, "近 7 天"),
                                            react.createElement("svg", { key: "s", className: "dts-spark", viewBox: "0 0 100 36", preserveAspectRatio: "none", "aria-hidden": true }, [
                                                react.createElement("defs", { key: "defs" }, react.createElement("linearGradient", { key: "g", id: sparkGid, x1: 0, y1: 0, x2: 0, y2: 1 }, [
                                                    react.createElement("stop", { key: "s1", offset: "0%", style: { stopColor: STYLE.accent, stopOpacity: 0.26 } }),
                                                    react.createElement("stop", { key: "s2", offset: "100%", style: { stopColor: STYLE.accent, stopOpacity: 0 } })
                                                ])),
                                                sparkArea ? react.createElement("path", { key: "a", d: sparkArea, fill: `url(#${sparkGid})` }) : null,
                                                react.createElement("path", { key: "l", d: sparkLine, fill: "none", stroke: STYLE.accent, strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", vectorEffect: "non-scaling-stroke" })
                                            ]),
                                            deltaEl
                                        ])
                                        : null,
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
                                            ...(subSess.length > 0
                                                ? [
                                                    " ＋ ",
                                                    react.createElement("strong", { key: "sub" }, `子代理会话 ${fmtCompact(subBilled)}（${subSess.length} 个）`)
                                                ]
                                                : []),
                                            " ＝ ",
                                            react.createElement("strong", { key: "total" }, `总计 ${fmtCompact(billedTotal)}`),
                                            subSess.length > 0
                                                ? "　GUI 会话列表只显示顶层会话，插件统计全部会话（含子代理）"
                                                : "　未检测到子代理会话（GUI 会话列表只显示顶层）"
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
                            ]) : emptyStateEl,
                            total && total.requests > 0 ? react.createElement(react.Fragment, { key: "period" }, [
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
                                            react.createElement("div", { key: "label", className: "dts-chart-label", style: i === chartDays.length - 1 ? { fontWeight: 700, color: STYLE.labelPrimary } : undefined }, i === chartDays.length - 1 ? "今天" : d.day.slice(5))
                                        ]);
                                    }))
                                ]),
                                historyTable,
                            ]) : null,
                            stHeatSection(),
                            stMonthSection(stMonthOpen, stSetMonthOpen, month30, loadMonth, loadingMonth)
                        ]
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
