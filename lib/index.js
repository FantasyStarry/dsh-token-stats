/**
 * dsh-token-stats — 服务端插件。
 *
 * 按自然日聚合 LLM token 用量（按 provider/model 拆分），数据来源是会话事件
 * `assistant/message`（携带该次请求的 `usage` 与 `message.source.{provider,model}`，
 * 见 dsh-agent-loop 的 append 调用）。每次成功模型调用计一次，重试/失败回合不计。
 *
 * 统计口径：
 *  - inputTokens（未缓存输入）、outputTokens、cacheReadTokens（缓存读）、
 *    cacheWriteTokens（缓存写）、reasoningTokens（推理）
 *  - 计费输入 ≈ inputTokens + cacheReadTokens + cacheWriteTokens
 *
 * 数据正确性（v0.1.1 修复）：
 *  DSH 的会话日志（session.jsonl.zstd）是"多帧 zstd 容器"：每批事件追加一个独立
 *  压缩帧。旧版用 zstdDecompressSync 解整个文件只会得到第一帧（通常是 session 头），
 *  启动回填实际读到 0 条 usage —— 插件加载之前发生的调用全部漏计。
 *  本版按帧完整解码，并在每次加载时把"今天"的统计从日志整体重建（清零后重算）：
 *    - 插件无论何时加载/重启/热重载，今天的数据都以日志为准，不漏计、不重复；
 *    - 重建只覆盖当前自然日，历史天保留；
 *    - 实时订阅在重建之后注册，新事件只被实时路径计一次（firehose 不重放历史）。
 *
 * 提供：
 *  - 持久化：原子写入 $DSH_HOME/storages/token-stats.json（可用 config.storagePath 覆盖）
 *  - HTTP：GET /token-stats/summary?day=YYYY-MM-DD、GET /token-stats/history?days=N、
 *    GET /token-stats/sessions?day=YYYY-MM-DD —— 按会话明细（含子代理标记）、
 *    GET /token-stats/balance —— 官方余额（GET /user/balance，Bearer DEEPSEEK_API_KEY，
 *    60s 缓存；未配置密钥时返回 ok:false + error 字段，客户端优雅降级）
 *  - 命令：/usage —— 今日用量 + 估算费用 + 官方余额
 *  - 费用：按模型参考价表（config.prices 可覆盖，支持前缀匹配）估算费用，
 *    内置 DeepSeek 官方空闲时段价（高峰 ×2，估算为"至少"值）；未计价模型
 *    在汇总中 cost:null / unpriced 计数，UI 显示"—"
 *
 * 按会话口径（v0.3.0 新增）：每份会话日志的头事件携带 parentSession / origin /
 * delegationDepth（见 dsh-session-persistence-jsonl 的 toHeaderLine）。会话的
 * 子代理判定：origin === "subagent" 或 delegationDepth > 0 或存在 parentSession。
 * 实时路径从 session.header 取同一组字段。GUI 会话列表只显示顶层会话，本插件
 * 统计全部会话（含子代理）——设置页与 /usage 提供"顶层 + 子代理"对账信息。
 *
 * 配置（v0.4.0 起）：注册 settings 区块（installSettingsSection），设置页
 * "插件配置"出现 token-stats 表单（storagePath / keepDays），GUI 修改实时生效
 * （storagePath 切换会先把旧状态落盘，再在新路径重建今天）。
 *
 * 依赖：node 内置模块 + DSH 自带包（@deepseek-ai/schemastery、@deepseek-ai/dsh-settings，
 * 与 dsh 应用同实例解析）。
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { zstdDecompressSync } from "node:zlib";
// 可选依赖（DSH 自带包）：驱动设置页"插件配置"表单。解析不到（如独立测试环境）
// 时优雅降级：插件其余功能不受影响，仅无表单。运行时与 dsh 应用同 Node 进程，
// 经 npm 全局安装树可解析到与 dsh 应用同实例的模块。
let z = null;
let installSettingsSection = null;
let settingsNamespace = null;
try {
    const settingsMod = await import("@deepseek-ai/dsh-settings");
    installSettingsSection = settingsMod.installSettingsSection;
    settingsNamespace = settingsMod.settingsNamespace;
    z = (await import("@deepseek-ai/schemastery")).default;
}
catch {
    // 环境无 @deepseek-ai 包：跳过配置表单注册
}
/**
 * 插件配置 schema（同时驱动设置页"插件配置"表单，见 installSettingsSection）。
 * storagePath 留空表示使用默认位置；keepDays 控制历史保留天数。
 */
const Config = z ? z.object({
    storagePath: z.string().default("").description("统计文件路径；留空使用默认 $DSH_HOME/storages/token-stats.json"),
    keepDays: z.number().step(1).min(1).max(3650).default(366).description("历史保留天数"),
    prices: z.dict(z.object({
        input: z.number().step(0.01).min(0).required(false).description("未缓存输入单价（元/百万 token）"),
        cacheRead: z.number().step(0.01).min(0).required(false).description("缓存命中单价（元/百万 token）"),
        cacheWrite: z.number().step(0.01).min(0).required(false).description("缓存写单价；缺省 = 未缓存输入"),
        output: z.number().step(0.01).min(0).required(false).description("输出单价（元/百万 token）"),
        reasoning: z.number().step(0.01).min(0).required(false).description("推理单价；缺省 = 输出")
    })).default({}).description("按模型单价表（元/百万 token）；键支持前缀匹配，覆盖内置 DeepSeek 参考价（空闲时段价，高峰 ×2）")
}) : null;
/** 本插件 settings 命名空间。 */
const STATS_SETTINGS_NAMESPACE = settingsNamespace ? settingsNamespace("token-stats") : null;
/** zstd 帧魔数（小端 0xFD2FB528）。 */
const ZSTD_MAGIC = 4247762216;
/** DSH 用户目录（与启动环境一致）。 */
function dshHome() {
    return process.env.DSH_HOME && process.env.DSH_HOME.length > 0 ? process.env.DSH_HOME : join(homedir(), ".dsh");
}
/** 默认统计文件位置。 */
function defaultStoragePath() {
    return join(dshHome(), "storages", "token-stats.json");
}
/** 本地自然日键：YYYY-MM-DD（按服务器本地时区）。 */
function dateKeyOf(ts) {
    const d = new Date(ts);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
}
/** 本地自然日的零点（毫秒时间戳）。 */
function startOfToday() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime();
}
/** 单模型统计桶。 */
function blankStats() {
    return {
        requests: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        reasoningTokens: 0
    };
}
/** 把一份 usage 累加进目标桶。 */
function addStats(target, usage) {
    target.requests += usage.requests ?? 1;
    target.inputTokens += usage.inputTokens ?? 0;
    target.outputTokens += usage.outputTokens ?? 0;
    target.cacheReadTokens += usage.cacheReadTokens ?? 0;
    target.cacheWriteTokens += usage.cacheWriteTokens ?? 0;
    target.reasoningTokens += usage.reasoningTokens ?? 0;
}
/** 保证某日某提供商某模型存在，返回其统计桶。 */
function ensureModel(state, day, provider, model) {
    const dayData = (state.days[day] ??= {});
    const providerData = (dayData[provider] ??= {});
    return (providerData[model] ??= blankStats());
}
/** 读取并校验状态文件；损坏/缺失时回退到空状态。 */
function loadState(path) {
    const state = { days: {}, sessions: {} };
    if (!existsSync(path))
        return state;
    try {
        const raw = JSON.parse(readFileSync(path, "utf8"));
        if (raw && typeof raw === "object" && raw.days && typeof raw.days === "object") {
            state.days = raw.days;
        }
        if (raw && typeof raw === "object" && raw.sessions && typeof raw.sessions === "object") {
            state.sessions = raw.sessions;
        }
    }
    catch {
        // 文件损坏：丢弃并重写，不阻塞启动
    }
    return state;
}
/** 原子持久化（tmp + rename）。 */
function persistState(path, state) {
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, JSON.stringify(state));
    renameSync(tmp, path);
}
/** 汇总某一天的视图。 */
function summaryFor(state, day) {
    const total = blankStats();
    const providers = {};
    const dayData = state.days[day];
    if (dayData) {
        for (const [provider, models] of Object.entries(dayData)) {
            const pv = { total: blankStats(), models: {} };
            for (const [model, stats] of Object.entries(models)) {
                const copy = { ...stats };
                pv.models[model] = copy;
                addStats(pv.total, copy);
                addStats(total, copy);
            }
            providers[provider] = pv;
        }
    }
    return { day, total, providers };
}
/** 最近 N 天（含今天）的每日总计，最新在前。 */
function historyFor(state, days) {
    const result = [];
    const now = Date.now();
    for (let i = 0; i < days; i++) {
        const day = dateKeyOf(now - i * 86400000);
        result.push({ day, total: summaryFor(state, day).total });
    }
    return { days: result };
}
/** 裁剪过旧数据，防止文件无限增长。 */
function prune(state, keepDays) {
    const cutoff = dateKeyOf(Date.now() - keepDays * 86400000);
    for (const day of Object.keys(state.days)) {
        if (day < cutoff)
            delete state.days[day];
    }
    if (state.sessions) {
        for (const day of Object.keys(state.sessions)) {
            if (day < cutoff)
                delete state.sessions[day];
        }
    }
}
// ── 会话日志读取（多帧 zstd 容器） ──────────────────────────────────────────
/**
 * 扫描 zstd 容器中所有完整的帧区间（不真正解压块）。参照 DSH 持久化层
 * dsh-session-persistence-jsonl 的 scanZstdFrames：会话日志按批追加独立帧，
 * 末尾可能残留一个未写完的帧（进程崩溃/正在写入），返回的帧列表只含完整帧。
 * @param buffer - 文件完整字节。
 * @returns {{start:number,end:number}[]} 完整帧区间（不含撕裂尾部）。
 */
function scanZstdFrames(buffer) {
    const frames = [];
    let offset = 0;
    while (offset < buffer.length) {
        const start = offset;
        if (buffer.length - offset < 4)
            return frames;
        if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC)
            throw new Error(`invalid zstd frame magic at byte ${offset}`);
        offset += 4;
        if (offset === buffer.length)
            return frames;
        const descriptor = buffer.readUInt8(offset);
        offset += 1;
        if ((descriptor & 24) !== 0)
            throw new Error(`reserved zstd frame-header bit at byte ${offset - 1}`);
        const contentSizeFlag = descriptor >>> 6;
        const singleSegment = (descriptor & 32) !== 0;
        const checksum = (descriptor & 4) !== 0;
        const dictionaryFlag = descriptor & 3;
        const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag;
        const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag;
        const remainingHeaderBytes = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes;
        if (buffer.length - offset < remainingHeaderBytes)
            return frames;
        offset += remainingHeaderBytes;
        for (;;) {
            if (buffer.length - offset < 3)
                return frames;
            const blockHeader = buffer.readUIntLE(offset, 3);
            offset += 3;
            const lastBlock = (blockHeader & 1) !== 0;
            const blockType = (blockHeader >>> 1) & 3;
            const blockSize = blockHeader >>> 3;
            if (blockType === 3)
                throw new Error(`reserved zstd block type at byte ${offset - 3}`);
            const payloadBytes = blockType === 1 ? 1 : blockSize;
            if (buffer.length - offset < payloadBytes)
                return frames;
            offset += payloadBytes;
            if (lastBlock)
                break;
        }
        if (checksum) {
            if (buffer.length - offset < 4)
                return frames;
            offset += 4;
        }
        frames.push({ start, end: offset });
    }
    return frames;
}
/**
 * 完整解码一个会话日志文件：zstd 容器按帧逐个解压拼接；普通 .jsonl 直接读。
 * 单个帧损坏时跳过该帧，不影响其他帧。
 */
function decodeSessionLog(file) {
    const raw = readFileSync(file);
    if (!file.endsWith(".zstd"))
        return raw.toString("utf8");
    let text = "";
    for (const { start, end } of scanZstdFrames(raw)) {
        try {
            text += zstdDecompressSync(raw.subarray(start, end)).toString("utf8");
        }
        catch {
            // 单帧损坏：跳过
        }
    }
    return text;
}
/**
 * 收集今天（event.time >= start）所有会话日志中的 usage 事件。
 * 只读取 mtime 在今天零点之后的文件作为快速路径；事件本身再按 time 过滤。
 * 每个文件的首行是 session 头事件（id / parentSession / origin / delegationDepth），
 * 用于标记事件所属会话及其子代理身份。
 */
function collectTodayUsage(start) {
    const sessionsRoot = join(dshHome(), "sessions");
    if (!existsSync(sessionsRoot))
        return [];
    const files = [];
    const walk = (dir) => {
        let entries;
        try {
            entries = readdirSync(dir, { withFileTypes: true });
        }
        catch {
            return;
        }
        for (const entry of entries) {
            const full = join(dir, entry.name);
            if (entry.isDirectory()) {
                walk(full);
            }
            else if (entry.name === "session.jsonl.zstd" || entry.name === "session.jsonl") {
                files.push(full);
            }
        }
    };
    walk(sessionsRoot);
    const events = [];
    for (const file of files) {
        try {
            if (statSync(file).mtimeMs < start)
                continue;
            const text = decodeSessionLog(file);
            // 兜底：文件缺少头事件时，从路径提取会话 id（session-<uuid>）。
            const pathId = file.match(/session-([0-9a-f-]{36})/i)?.[1] || "";
            let sessionMeta = null;
            for (const line of text.split("\n")) {
                if (!line)
                    continue;
                let event;
                try {
                    event = JSON.parse(line);
                }
                catch {
                    continue;
                }
                if (event && event.type === "session" && typeof event.id === "string") {
                    sessionMeta = {
                        id: event.id,
                        parent: event.parentSession,
                        subagent: event.origin === "subagent" ||
                            (Number.isFinite(event.delegationDepth) && event.delegationDepth > 0) ||
                            !!event.parentSession
                    };
                    continue;
                }
                if (!event || event.type !== "assistant/message" || !event.data || !event.data.usage)
                    continue;
                const time = typeof event.time === "number" ? event.time : Date.now();
                if (time < start)
                    continue;
                const source = event.data.message && event.data.message.source;
                events.push({
                    provider: (source && source.provider) || "unknown",
                    model: (source && source.model) || "unknown",
                    usage: event.data.usage,
                    time,
                    meta: sessionMeta || (pathId ? { id: pathId, parent: undefined, subagent: false } : null)
                });
            }
        }
        catch {
            // 单个文件损坏/不可读：跳过
        }
    }
    return events;
}
// ── 费用估算（按模型参考价，纯函数，便于独立测试） ────────────────────────
/**
 * 内置参考价（元/百万 token，DeepSeek 官方空闲时段价；高峰时段为 2 倍，
 * 故估算为"至少"值）。来源：https://api-docs.deepseek.com/zh-cn/quick_start/pricing
 *  - deepseek-v4-flash / -vision-exp：命中 0.05 · 未命中 1.5 · 输出 4.5
 *  - deepseek-v4-pro：命中 0.15 · 未命中 4.5 · 输出 13.5
 *  - deepseek-chat / deepseek-reasoner（旧版参考价）：2/0.5/8 与 4/1/16
 * 键统一小写存储；用户可在 config.prices 按模型覆盖（键支持前缀匹配）。
 */
const BUILTIN_PRICES = {
    "deepseek-v4-flash": { input: 1.5, cacheRead: 0.05, output: 4.5 },
    "deepseek-v4-flash-vision-exp": { input: 1.5, cacheRead: 0.05, output: 4.5 },
    "deepseek-v4-pro": { input: 4.5, cacheRead: 0.15, output: 13.5 },
    "deepseek-chat": { input: 2, cacheRead: 0.5, output: 8 },
    "deepseek-reasoner": { input: 4, cacheRead: 1, output: 16 }
};
/** 归一化单价表：内置参考价 + 用户覆盖（键统一小写）。 */
function normalizePrices(user) {
    const table = {};
    for (const [key, value] of Object.entries(BUILTIN_PRICES)) {
        table[key] = { ...value };
    }
    if (user && typeof user === "object") {
        for (const [key, value] of Object.entries(user)) {
            if (!value || typeof value !== "object")
                continue;
            const lower = key.toLowerCase();
            table[lower] = { ...(table[lower] || {}), ...value };
        }
    }
    return table;
}
/**
 * 查询模型单价：精确（小写）优先，其次最长前缀匹配（带边界分隔符），
 * 如 deepseek-v4-flash-0731 / DeepSeek-V4-Flash-0731 → deepseek-v4-flash。
 * 未匹配返回 null（客户端显示"—"）。
 */
function resolvePrice(model, table) {
    const m = String(model || "").toLowerCase();
    if (!m)
        return null;
    const exact = table[m];
    if (exact)
        return exact;
    let best = null;
    for (const [key, price] of Object.entries(table)) {
        if (!m.startsWith(key))
            continue;
        const next = m[key.length];
        if (next !== undefined && next !== "-" && next !== "/" && next !== "." && next !== "_")
            continue;
        if (!best || key.length > best.key.length)
            best = { key, price };
    }
    return best ? best.price : null;
}
/** 计算一笔统计的费用（元）。未匹配到价格返回 null。 */
function computeCost(stats, price) {
    if (!price)
        return null;
    const input = Number(price.input ?? 0);
    const cacheRead = Number(price.cacheRead ?? 0);
    const cacheWrite = Number(price.cacheWrite ?? input);
    const output = Number(price.output ?? 0);
    const reasoning = Number(price.reasoning ?? output);
    return (stats.inputTokens * input +
        stats.cacheReadTokens * cacheRead +
        stats.cacheWriteTokens * cacheWrite +
        stats.outputTokens * output +
        stats.reasoningTokens * reasoning) / 1e6;
}
/** 给某日汇总附加费用视图（每模型 cost；提供商/全天合计 + unpriced 计数）。 */
function enrichSummary(summary, table) {
    const providers = {};
    let dayCost = 0;
    let dayUnpriced = 0;
    let anyPriced = false;
    for (const [provider, pv] of Object.entries(summary.providers)) {
        const models = {};
        let provCost = 0;
        let provUnpriced = 0;
        let provPriced = false;
        for (const [model, stats] of Object.entries(pv.models)) {
            const price = resolvePrice(model, table);
            const cost = computeCost(stats, price);
            models[model] = { ...stats, cost };
            if (cost === null) {
                provUnpriced += 1;
            }
            else {
                provCost += cost;
                provPriced = true;
            }
        }
        providers[provider] = {
            total: { ...pv.total, cost: provPriced ? provCost : null, unpriced: provUnpriced },
            models
        };
        if (provPriced) {
            dayCost += provCost;
            anyPriced = true;
        }
        dayUnpriced += provUnpriced;
    }
    return {
        day: summary.day,
        total: { ...summary.total, cost: anyPriced ? dayCost : null, unpriced: dayUnpriced },
        providers
    };
}
// ── /usage 命令文案（纯函数，便于独立测试） ──────────────────────────────
/** 数字缩写（k/m/b）。 */
function fmtCompact(n) {
    const v = Number(n || 0);
    if (Math.abs(v) >= 1e9)
        return `${(v / 1e9).toFixed(1)}B`;
    if (Math.abs(v) >= 1e6)
        return `${(v / 1e6).toFixed(1)}M`;
    if (Math.abs(v) >= 1e3)
        return `${(v / 1e3).toFixed(1)}k`;
    return Number.isInteger(v) ? String(v) : String(Math.round(v * 10) / 10);
}
/** 金额（元）：<1 万保留两位小数，大额 k/M 缩写。 */
function fmtMoney(n) {
    if (!Number.isFinite(n))
        return "—";
    const abs = Math.abs(n);
    if (abs >= 1e6)
        return `${(n / 1e6).toFixed(2)}M`;
    if (abs >= 1e4)
        return `${(n / 1e3).toFixed(1)}k`;
    return n.toFixed(2);
}
/** 近 7 天趋势条：▁▂▃▄▅▆▇█ 按当日计费输入占最大日的比例分档，零用量日记 ·。 */
function trendBars(days) {
    const ordered = [...days].reverse();
    const billedOf = (d) => d.total.inputTokens + d.total.cacheReadTokens + d.total.cacheWriteTokens;
    const max = Math.max(0, ...ordered.map(billedOf));
    const blocks = "▁▂▃▄▅▆▇█";
    const bars = ordered
        .map((d) => {
        const v = billedOf(d);
        if (v <= 0)
            return "·";
        const lv = Math.max(1, Math.min(8, Math.ceil((v / Math.max(1, max)) * 8)));
        return blocks[lv - 1];
    })
        .join("");
    return {
        bars,
        total: ordered.reduce((a, d) => a + billedOf(d), 0),
        today: ordered.length > 0 ? billedOf(ordered[ordered.length - 1]) : 0
    };
}
/** 生成 /usage 命令文本（区间汇总 + 每日趋势 + 子代理对账 + 按模型明细 + 估算费用）。days = 统计最近几天（1 = 仅今天）。 */
function buildUsageText(state, days = 1, prices = normalizePrices()) {
    const span = Math.max(1, Math.min(366, Math.floor(days)));
    const today = dateKeyOf(Date.now());
    const startDay = dateKeyOf(Date.now() - (span - 1) * 86400000);
    const billedOf = (s) => s.inputTokens + s.cacheReadTokens + s.cacheWriteTokens;
    const total = blankStats();
    const providers = {};
    const dayKeys = [];
    let costTotal = 0;
    let unpriced = 0;
    let anyPriced = false;
    for (let i = 0; i < span; i++) {
        const key = dateKeyOf(Date.now() - i * 86400000);
        dayKeys.push(key);
        const dayData = state.days[key];
        if (!dayData)
            continue;
        for (const [p, models] of Object.entries(dayData)) {
            for (const [m, ms] of Object.entries(models)) {
                addStats(total, ms);
                const bucket = ((providers[p] ??= {})[m] ??= blankStats());
                addStats(bucket, ms);
                const cost = computeCost(ms, resolvePrice(m, prices));
                if (cost === null) {
                    unpriced += 1;
                }
                else {
                    costTotal += cost;
                    anyPriced = true;
                }
            }
        }
    }
    const billedInput = billedOf(total);
    const extra = total.reasoningTokens > 0 ? ` · 推理 ${fmtCompact(total.reasoningTokens)}` : "";
    const lines = [
        span === 1 ? `今日（${today}）token 用量：` : `近 ${span} 天（${startDay} ~ ${today}）token 用量：`,
        `总计：输入 ${fmtCompact(billedInput)}（缓存读 ${fmtCompact(total.cacheReadTokens)}）· 输出 ${fmtCompact(total.outputTokens)}${extra} · 共 ${total.requests} 次请求`
    ];
    if (total.requests > 0) {
        if (anyPriced) {
            const note = unpriced > 0 ? `（${unpriced} 个模型未计价）` : "";
            lines.push(`估算费用：¥${fmtMoney(costTotal)}${note}`);
        }
        else {
            lines.push(`估算费用：—（全部模型未计价，可在 插件配置 的 prices 中设置参考价）`);
        }
    }
    if (span === 1) {
        const t7 = trendBars(historyFor(state, 7).days);
        lines.push(`近 7 天趋势 ${t7.bars} 合计 ${fmtCompact(t7.total)}（今日 ${fmtCompact(t7.today)}）`);
    }
    else {
        const trend = trendBars(historyFor(state, span).days);
        lines.push(`每日趋势 ${trend.bars} 合计 ${fmtCompact(trend.total)}`);
    }
    let subCount = 0;
    let subReqs = 0;
    let subBilled = 0;
    for (const key of dayKeys) {
        const daySessions = state.sessions[key] || {};
        for (const s of Object.values(daySessions)) {
            if (!s.subagent)
                continue;
            subCount += 1;
            subReqs += s.requests;
            subBilled += billedOf(s);
        }
    }
    if (subCount > 0) {
        lines.push(`其中子代理会话 ${fmtCompact(subBilled)}（${subReqs} 次请求 · ${subCount} 个会话；GUI 会话列表不显示子代理）`);
    }
    const providerRows = Object.entries(providers)
        .map(([p, models]) => {
        const agg = blankStats();
        for (const ms of Object.values(models))
            addStats(agg, ms);
        return { p, models, billed: billedOf(agg) };
    })
        .sort((a, b) => b.billed - a.billed);
    for (const { p, models } of providerRows) {
        for (const [m, ms] of Object.entries(models).sort((a, b) => billedOf(b[1]) - billedOf(a[1]))) {
            const billed = billedOf(ms);
            const mExtra = ms.reasoningTokens > 0 ? ` · 推理 ${fmtCompact(ms.reasoningTokens)}` : "";
            lines.push(`- ${p} / ${m}：输入 ${fmtCompact(billed)} · 输出 ${fmtCompact(ms.outputTokens)}${mExtra} · ${ms.requests} 次请求`);
        }
    }
    if (total.requests === 0) {
        lines.push(span === 1 ? "（今天还没有记录到模型调用）" : `（${startDay} 以来还没有记录到模型调用）`);
    }
    return lines.join("\n");
}
export default {
    name: "dsh-token-stats",
    /**
     * @param ctx - cordis 上下文（根 realm，可访问 session/webServer/commands 等 host 服务）。
     * @param config - { storagePath?: string, keepDays?: number }
     */
    apply(ctx, config = {}) {
        let current = () => config;
        let storagePath = config.storagePath || defaultStoragePath();
        let keepDays = typeof config.keepDays === "number" && Number.isInteger(config.keepDays) && config.keepDays > 0
            ? config.keepDays
            : 366;
        let state = loadState(storagePath);
        /** 归一化单价表（内置参考价 + 用户覆盖），随配置实时更新。 */
        let priceTable = normalizePrices(config.prices);
        let dirty = false;
        let flushTimer = null;
        let lastFlushAt = 0;
        /** 上次实时活动的时刻（仅实时订阅更新，重建不触发），0 = 尚无活动。 */
        let lastActivityAt = 0;
        /** 官方余额响应缓存（60s），避免客户端轮询打到 DeepSeek。 */
        let balanceCache = null;
        /** 最近完成的模型调用（内存环形缓冲，约 60s / 20 条）。 */
        const recentCompletions = [];
        const flush = () => {
            if (!dirty)
                return;
            dirty = false;
            try {
                prune(state, keepDays);
                persistState(storagePath, state);
            }
            catch (error) {
                ctx.logger?.warn?.(`token-stats: 持久化失败: ${String(error)}`);
            }
        };
        /** 防抖落盘：有变更后约 2s 内写一次，期间新变更顺延。 */
        const scheduleFlush = () => {
            if (flushTimer !== null)
                return;
            const now = Date.now();
            const elapsed = lastFlushAt === 0 ? Infinity : now - lastFlushAt;
            const delay = elapsed > 5000 ? 200 : 2000;
            flushTimer = setTimeout(() => {
                flushTimer = null;
                lastFlushAt = Date.now();
                flush();
            }, delay);
        };
        /**
         * 累加一条真实用量（一次成功模型调用）。
         * @param meta - 会话信息 { id, parent, subagent }；缺失时只累计 provider/model 桶。
         */
        const record = (provider, model, usage, ts, meta) => {
            const day = dateKeyOf(ts);
            const bucket = ensureModel(state, day, provider, model);
            bucket.requests += 1;
            bucket.inputTokens += usage.inputTokens ?? 0;
            bucket.outputTokens += usage.outputTokens ?? 0;
            bucket.cacheReadTokens += usage.cacheReadTokens ?? 0;
            bucket.cacheWriteTokens += usage.cacheWriteTokens ?? 0;
            bucket.reasoningTokens += usage.reasoningTokens ?? 0;
            if (meta && meta.id) {
                const daySessions = (state.sessions[day] ??= {});
                const s = (daySessions[meta.id] ??= {
                    requests: 0,
                    inputTokens: 0,
                    outputTokens: 0,
                    cacheReadTokens: 0,
                    cacheWriteTokens: 0,
                    reasoningTokens: 0,
                    lastAt: ts
                });
                if (meta.parent)
                    s.parent = meta.parent;
                if (typeof meta.subagent === "boolean")
                    s.subagent = meta.subagent;
                s.requests += 1;
                s.inputTokens += usage.inputTokens ?? 0;
                s.outputTokens += usage.outputTokens ?? 0;
                s.cacheReadTokens += usage.cacheReadTokens ?? 0;
                s.cacheWriteTokens += usage.cacheWriteTokens ?? 0;
                s.reasoningTokens += usage.reasoningTokens ?? 0;
                s.lastAt = Math.max(s.lastAt, ts);
            }
            dirty = true;
            scheduleFlush();
        };
        // ── 重建今天：从会话日志整体重算（多帧 zstd 完整解码） ──────────────────
        // 在注册实时订阅之前执行：重建读到的都是插件启动前已落盘的日志事件，
        // 订阅之后的新事件走实时路径，两者不会重叠，因此天然不重复计数。
        // 即使插件热重载/重启多次，今天的数据也始终与日志一致。
        const rebuildToday = () => {
            const todayStart = startOfToday();
            const events = collectTodayUsage(todayStart);
            delete state.days[dateKeyOf(Date.now())];
            delete state.sessions[dateKeyOf(Date.now())];
            for (const e of events) {
                record(e.provider, e.model, e.usage, e.time, e.meta);
            }
            flush();
            ctx.logger?.info?.(`token-stats: 已从会话日志重建今日统计（${events.length} 次请求）`);
        };
        try {
            rebuildToday();
        }
        catch (error) {
            // 重建失败：保留现有统计，不阻塞插件加载
            ctx.logger?.warn?.(`token-stats: 今日统计重建失败，保留现有数据: ${String(error)}`);
        }
        // ── 实时订阅：每个会话的每一条事件（firehose，不重放历史） ─────────────
        ctx.on("session/event", (session, event) => {
            if (!event || typeof event.type !== "string")
                return;
            const data = event.data;
            // 任何代理活动都刷新"上次活动时刻"（turn/start、tool/call、chunk 等），
            // 让"工作中"反映真实的进行中状态，而不是只等一次完整调用结束（v0.7.0）。
            if (event.type === "assistant/message" ||
                event.type === "turn/start" ||
                event.type === "turn/end" ||
                event.type === "step/start" ||
                event.type === "step/end" ||
                event.type === "tool/call" ||
                event.type === "tool/result" ||
                event.type === "assistant/chunk") {
                lastActivityAt = Date.now();
            }
            if (event.type !== "assistant/message")
                return;
            if (!data || !data.usage || typeof data.usage !== "object")
                return;
            const source = data.message && data.message.source;
            const header = session && typeof session === "object" ? session.header : undefined;
            const meta = session && session.id
                ? {
                    id: session.id,
                    parent: header && header.parentSession,
                    subagent: !!(header &&
                        (header.origin === "subagent" || (header.delegationDepth ?? 0) > 0 || header.parentSession))
                }
                : null;
            record((source && source.provider) || "unknown", (source && source.model) || "unknown", data.usage, event.time || Date.now(), meta);
            // 实时活动：记录"上次活动时刻"与本次完成信息（供前端做工作/休息/完成提示）
            const now = Date.now();
            recentCompletions.push({
                at: now,
                sessionId: meta && meta.id ? meta.id : "",
                subagent: !!(meta && meta.subagent),
                billedInput: (data.usage.inputTokens ?? 0) + (data.usage.cacheReadTokens ?? 0) + (data.usage.cacheWriteTokens ?? 0),
                outputTokens: data.usage.outputTokens ?? 0
            });
            if (recentCompletions.length > 20)
                recentCompletions.shift();
            const cutoff = now - 60000;
            while (recentCompletions.length > 0 && recentCompletions[0].at < cutoff)
                recentCompletions.shift();
        });
        // ── 设置页"插件配置"表单（storagePath / keepDays，GUI 修改实时生效） ────
        if (installSettingsSection && STATS_SETTINGS_NAMESPACE && Config) {
            installSettingsSection(ctx, STATS_SETTINGS_NAMESPACE, Config, config, {
                setSource: (source) => {
                    current = source;
                },
                onChange: () => {
                    const next = current();
                    const nextPath = next.storagePath && next.storagePath.length > 0 ? next.storagePath : defaultStoragePath();
                    const nextKeep = typeof next.keepDays === "number" && Number.isInteger(next.keepDays) && next.keepDays > 0
                        ? next.keepDays
                        : 366;
                    if (nextPath !== storagePath) {
                        try {
                            // 旧状态先落盘到旧路径，再切换到新路径并从日志重建今天
                            flush();
                        }
                        catch {
                            // 旧路径落盘失败：忽略，继续切换
                        }
                        storagePath = nextPath;
                        state = loadState(nextPath);
                        try {
                            rebuildToday();
                        }
                        catch (error) {
                            ctx.logger?.warn?.(`token-stats: 切换 storagePath 后重建失败: ${String(error)}`);
                        }
                    }
                    if (nextKeep !== keepDays)
                        keepDays = nextKeep;
                    priceTable = normalizePrices(next.prices);
                }
            });
        }
        // ── HTTP API（同源，无鉴权；数据仅为用量统计，无敏感信息） ─────────────
        const writeJson = (res, status, body) => {
            const payload = JSON.stringify(body);
            res.writeHead(status, {
                "content-type": "application/json; charset=utf-8",
                "cache-control": "no-store",
                "content-length": Buffer.byteLength(payload)
            });
            res.end(payload);
        };
        const handleHttp = async (req, res) => {
            let url;
            try {
                url = new URL(req.url || "/", "http://localhost");
            }
            catch {
                writeJson(res, 400, { error: "bad request" });
                return;
            }
            const path = url.pathname;
            if (path === "/token-stats/summary") {
                const day = url.searchParams.get("day") || dateKeyOf(Date.now());
                writeJson(res, 200, {
                    ...enrichSummary(summaryFor(state, day), priceTable),
                    activity: { lastAt: lastActivityAt, completions: recentCompletions }
                });
            }
            else if (path === "/token-stats/history") {
                const parsed = Number(url.searchParams.get("days"));
                // 上限 366：活跃热力图按周×星期渲染近 12 个月（v0.9.2）
                const days = Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, 366) : 7;
                const hist = historyFor(state, days);
                writeJson(res, 200, {
                    days: hist.days.map((d) => {
                        const enriched = enrichSummary(summaryFor(state, d.day), priceTable);
                        return { day: d.day, total: enriched.total };
                    })
                });
            }
            else if (path === "/token-stats/balance") {
                // 官方余额（GET /user/balance，Bearer DEEPSEEK_API_KEY；60s 缓存）
                if (balanceCache && Date.now() - balanceCache.at < 60000) {
                    writeJson(res, balanceCache.status, balanceCache.body);
                    return;
                }
                const creds = ctx.get ? ctx.get("credentials") : undefined;
                if (!creds || typeof creds.resolve !== "function") {
                    balanceCache = { at: Date.now(), status: 503, body: { ok: false, error: "no-credentials", message: "credentials 服务不可用" } };
                    writeJson(res, 503, balanceCache.body);
                    return;
                }
                try {
                    const hit = await creds.resolve("DEEPSEEK_API_KEY");
                    if (!hit || !hit.value) {
                        balanceCache = { at: Date.now(), status: 200, body: { ok: false, error: "no-api-key", message: "未配置 DEEPSEEK_API_KEY（设置 → 模型）" } };
                        writeJson(res, 200, balanceCache.body);
                        return;
                    }
                    const response = await fetch("https://api.deepseek.com/user/balance", {
                        headers: { Authorization: `Bearer ${hit.value}`, Accept: "application/json" },
                        signal: AbortSignal.timeout(10000)
                    });
                    const text = await response.text();
                    if (!response.ok) {
                        balanceCache = { at: Date.now(), status: response.status, body: { ok: false, error: "provider", message: `DeepSeek 接口返回 HTTP ${response.status}` } };
                        writeJson(res, response.status, balanceCache.body);
                        return;
                    }
                    let data = null;
                    try {
                        data = JSON.parse(text);
                    }
                    catch {
                        // 非 JSON 响应：按失败处理
                    }
                    if (!data || typeof data !== "object") {
                        balanceCache = { at: Date.now(), status: 502, body: { ok: false, error: "bad-response", message: "余额接口返回异常" } };
                        writeJson(res, 502, balanceCache.body);
                        return;
                    }
                    const infos = Array.isArray(data.balance_infos) ? data.balance_infos : [];
                    const total = infos.reduce((a, i) => a + (Number(i && i.total_balance) || 0), 0);
                    const body = {
                        ok: true,
                        isAvailable: !!data.is_available,
                        currency: infos.length > 0 ? String(infos[0].currency || "CNY") : "CNY",
                        total,
                        infos: infos.map((i) => ({
                            currency: i && i.currency,
                            total: i && i.total_balance,
                            granted: i && i.granted_balance,
                            toppedUp: i && i.topped_up_balance
                        })),
                        fetchedAt: Date.now()
                    };
                    balanceCache = { at: Date.now(), status: 200, body };
                    writeJson(res, 200, body);
                }
                catch (error) {
                    balanceCache = {
                        at: Date.now(),
                        status: 502,
                        body: { ok: false, error: "fetch-failed", message: error instanceof Error ? error.message : String(error) }
                    };
                    writeJson(res, 502, balanceCache.body);
                }
            }
            else if (path === "/token-stats/sessions") {
                const day = url.searchParams.get("day") || dateKeyOf(Date.now());
                const daySessions = state.sessions[day] || {};
                const sessions = Object.entries(daySessions)
                    .map(([id, s]) => ({
                    id,
                    parent: s.parent || null,
                    subagent: !!s.subagent,
                    requests: s.requests,
                    inputTokens: s.inputTokens,
                    outputTokens: s.outputTokens,
                    cacheReadTokens: s.cacheReadTokens,
                    cacheWriteTokens: s.cacheWriteTokens,
                    reasoningTokens: s.reasoningTokens,
                    lastAt: s.lastAt
                }))
                    .sort((a, b) => b.lastAt - a.lastAt);
                writeJson(res, 200, { day, sessions });
            }
            else {
                writeJson(res, 404, {
                    error: "not found",
                    endpoints: [
                        "/token-stats/summary?day=YYYY-MM-DD",
                        "/token-stats/history?days=N",
                        "/token-stats/sessions?day=YYYY-MM-DD",
                        "/token-stats/balance"
                    ]
                });
            }
        };
        ctx.inject(["webServer"], (web) => {
            const dispose = web.webServer.register({
                kind: "prefix",
                path: "/token-stats",
                handler: handleHttp
            });
            ctx.on("dispose", dispose);
        });
        ctx.inject(["commands"], (cmd) => {
            const dispose = cmd.commands.register({
                name: "usage",
                description: "查看 LLM token 用量与估算费用（/usage 今天 · /usage 7 近 7 天，按提供商/模型）",
                input: { hint: "[天数，缺省 1=今天，最大 366]" },
                handler: async (invocation) => {
                    const raw = invocation && typeof invocation.rawInput === "string" ? invocation.rawInput.trim() : "";
                    const parsed = Number(raw);
                    const days = raw === "" || !Number.isFinite(parsed) ? 1 : Math.max(1, Math.min(366, Math.floor(parsed)));
                    const text = buildUsageText(state, days, priceTable);
                    // 附官方余额（可选：仅当 credentials 可解析出 DEEPSEEK_API_KEY；失败静默）
                    let textWithBalance = text;
                    try {
                        const creds = ctx.get ? ctx.get("credentials") : undefined;
                        if (creds && typeof creds.resolve === "function") {
                            const hit = await creds.resolve("DEEPSEEK_API_KEY");
                            if (hit && hit.value) {
                                const response = await fetch("https://api.deepseek.com/user/balance", {
                                    headers: { Authorization: `Bearer ${hit.value}`, Accept: "application/json" },
                                    signal: AbortSignal.timeout(10000)
                                });
                                if (response.ok) {
                                    const data = await response.json();
                                    const infos = Array.isArray(data && data.balance_infos) ? data.balance_infos : [];
                                    if (infos.length > 0) {
                                        const total = infos.reduce((a, i) => a + (Number(i && i.total_balance) || 0), 0);
                                        textWithBalance += `\n官方余额：¥${fmtMoney(total)}（${String(infos[0].currency || "CNY")} · GET /user/balance）`;
                                    }
                                }
                            }
                        }
                    }
                    catch {
                        // 余额查询失败不影响 /usage 主输出
                    }
                    return { kind: "success", text: textWithBalance };
                }
            });
            ctx.on("dispose", dispose);
        });
        // ── 退出前强制落盘 ──────────────────────────────────────────────────────
        ctx.on("dispose", () => {
            if (flushTimer !== null) {
                clearTimeout(flushTimer);
                flushTimer = null;
            }
            dirty = true;
            flush();
        });
    }
};
