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
 *  - HTTP：GET /token-stats/summary?day=YYYY-MM-DD、GET /token-stats/history?days=N
 *  - 命令：/usage —— 今日用量文本
 *
 * 零外部依赖：只使用 node 内置模块与 cordis 上下文 API（ctx.on/ctx.inject/ctx.on("dispose")）。
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { zstdDecompressSync } from "node:zlib";

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
  const state = { days: {} };
  if (!existsSync(path)) return state;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8"));
    if (raw && typeof raw === "object" && raw.days && typeof raw.days === "object") {
      state.days = raw.days;
    }
  } catch {
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
    if (day < cutoff) delete state.days[day];
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
    if (buffer.length - offset < 4) return frames;
    if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) throw new Error(`invalid zstd frame magic at byte ${offset}`);
    offset += 4;
    if (offset === buffer.length) return frames;
    const descriptor = buffer.readUInt8(offset);
    offset += 1;
    if ((descriptor & 24) !== 0) throw new Error(`reserved zstd frame-header bit at byte ${offset - 1}`);
    const contentSizeFlag = descriptor >>> 6;
    const singleSegment = (descriptor & 32) !== 0;
    const checksum = (descriptor & 4) !== 0;
    const dictionaryFlag = descriptor & 3;
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag;
    const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag;
    const remainingHeaderBytes = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes;
    if (buffer.length - offset < remainingHeaderBytes) return frames;
    offset += remainingHeaderBytes;
    for (;;) {
      if (buffer.length - offset < 3) return frames;
      const blockHeader = buffer.readUIntLE(offset, 3);
      offset += 3;
      const lastBlock = (blockHeader & 1) !== 0;
      const blockType = (blockHeader >>> 1) & 3;
      const blockSize = blockHeader >>> 3;
      if (blockType === 3) throw new Error(`reserved zstd block type at byte ${offset - 3}`);
      const payloadBytes = blockType === 1 ? 1 : blockSize;
      if (buffer.length - offset < payloadBytes) return frames;
      offset += payloadBytes;
      if (lastBlock) break;
    }
    if (checksum) {
      if (buffer.length - offset < 4) return frames;
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
  if (!file.endsWith(".zstd")) return raw.toString("utf8");
  let text = "";
  for (const { start, end } of scanZstdFrames(raw)) {
    try {
      text += zstdDecompressSync(raw.subarray(start, end)).toString("utf8");
    } catch {
      // 单帧损坏：跳过
    }
  }
  return text;
}

/**
 * 收集今天（event.time >= start）所有会话日志中的 usage 事件。
 * 只读取 mtime 在今天零点之后的文件作为快速路径；事件本身再按 time 过滤。
 */
function collectTodayUsage(start) {
  const sessionsRoot = join(dshHome(), "sessions");
  if (!existsSync(sessionsRoot)) return [];
  const files = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name === "session.jsonl.zstd" || entry.name === "session.jsonl") {
        files.push(full);
      }
    }
  };
  walk(sessionsRoot);
  const events = [];
  for (const file of files) {
    try {
      if (statSync(file).mtimeMs < start) continue;
      const text = decodeSessionLog(file);
      for (const line of text.split("\n")) {
        if (!line) continue;
        let event;
        try {
          event = JSON.parse(line);
        } catch {
          continue;
        }
        if (!event || event.type !== "assistant/message" || !event.data || !event.data.usage) continue;
        const time = typeof event.time === "number" ? event.time : Date.now();
        if (time < start) continue;
        const source = event.data.message && event.data.message.source;
        events.push({
          provider: (source && source.provider) || "unknown",
          model: (source && source.model) || "unknown",
          usage: event.data.usage,
          time
        });
      }
    } catch {
      // 单个文件损坏/不可读：跳过
    }
  }
  return events;
}

export default {
  name: "dsh-token-stats",

  /**
   * @param ctx - cordis 上下文（根 realm，可访问 session/webServer/commands 等 host 服务）。
   * @param config - { storagePath?: string, keepDays?: number }
   */
  apply(ctx, config = {}) {
    const storagePath = config.storagePath || defaultStoragePath();
    const keepDays = Number.isInteger(config.keepDays) && config.keepDays > 0 ? config.keepDays : 366;
    const state = loadState(storagePath);
    let dirty = false;
    let flushTimer = null;
    let lastFlushAt = 0;

    const flush = () => {
      if (!dirty) return;
      dirty = false;
      try {
        prune(state, keepDays);
        persistState(storagePath, state);
      } catch (error) {
        ctx.logger?.warn?.(`token-stats: 持久化失败: ${String(error)}`);
      }
    };

    /** 防抖落盘：有变更后约 2s 内写一次，期间新变更顺延。 */
    const scheduleFlush = () => {
      if (flushTimer !== null) return;
      const now = Date.now();
      const elapsed = lastFlushAt === 0 ? Infinity : now - lastFlushAt;
      const delay = elapsed > 5000 ? 200 : 2000;
      flushTimer = setTimeout(() => {
        flushTimer = null;
        lastFlushAt = Date.now();
        flush();
      }, delay);
    };

    /** 累加一条真实用量（一次成功模型调用）。 */
    const record = (provider, model, usage, ts) => {
      const bucket = ensureModel(state, dateKeyOf(ts), provider, model);
      bucket.requests += 1;
      bucket.inputTokens += usage.inputTokens ?? 0;
      bucket.outputTokens += usage.outputTokens ?? 0;
      bucket.cacheReadTokens += usage.cacheReadTokens ?? 0;
      bucket.cacheWriteTokens += usage.cacheWriteTokens ?? 0;
      bucket.reasoningTokens += usage.reasoningTokens ?? 0;
      dirty = true;
      scheduleFlush();
    };

    // ── 启动重建：今天从会话日志整体重算（多帧 zstd 完整解码） ────────────
    // 在注册实时订阅之前执行：重建读到的都是插件启动前已落盘的日志事件，
    // 订阅之后的新事件走实时路径，两者不会重叠，因此天然不重复计数。
    // 即使插件热重载/重启多次，今天的数据也始终与日志一致。
    try {
      const todayStart = startOfToday();
      const events = collectTodayUsage(todayStart);
      delete state.days[dateKeyOf(Date.now())];
      for (const e of events) {
        record(e.provider, e.model, e.usage, e.time);
      }
      flush();
      ctx.logger?.info?.(`token-stats: 已从会话日志重建今日统计（${events.length} 次请求）`);
    } catch (error) {
      // 重建失败：保留现有统计，不阻塞插件加载
      ctx.logger?.warn?.(`token-stats: 今日统计重建失败，保留现有数据: ${String(error)}`);
    }

    // ── 实时订阅：每个会话的每一条事件（firehose，不重放历史） ─────────────
    ctx.on("session/event", (session, event) => {
      if (!event || event.type !== "assistant/message") return;
      const data = event.data;
      if (!data || !data.usage || typeof data.usage !== "object") return;
      const source = data.message && data.message.source;
      record(
        (source && source.provider) || "unknown",
        (source && source.model) || "unknown",
        data.usage,
        event.time || Date.now()
      );
    });

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

    const handleHttp = (req, res) => {
      let url;
      try {
        url = new URL(req.url || "/", "http://localhost");
      } catch {
        writeJson(res, 400, { error: "bad request" });
        return;
      }
      const path = url.pathname;
      if (path === "/token-stats/summary") {
        const day = url.searchParams.get("day") || dateKeyOf(Date.now());
        writeJson(res, 200, summaryFor(state, day));
      } else if (path === "/token-stats/history") {
        const parsed = Number(url.searchParams.get("days"));
        const days = Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, 30) : 7;
        writeJson(res, 200, historyFor(state, days));
      } else {
        writeJson(res, 404, {
          error: "not found",
          endpoints: ["/token-stats/summary?day=YYYY-MM-DD", "/token-stats/history?days=N"]
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

    // ── /usage 命令（对话内直接查询） ───────────────────────────────────────
    const formatTokens = (n) => Number(n || 0).toLocaleString("zh-CN");

    const commandText = () => {
      const day = dateKeyOf(Date.now());
      const summary = summaryFor(state, day);
      const t = summary.total;
      const billedInput = t.inputTokens + t.cacheReadTokens + t.cacheWriteTokens;
      const lines = [
        `今日（${day}）token 用量：`,
        `总计：输入 ${formatTokens(billedInput)}（其中缓存读 ${formatTokens(t.cacheReadTokens)}）· 输出 ${formatTokens(t.outputTokens)} · 推理 ${formatTokens(t.reasoningTokens)} · 共 ${t.requests} 次请求`
      ];
      for (const [provider, pv] of Object.entries(summary.providers)) {
        for (const [model, ms] of Object.entries(pv.models)) {
          const billed = ms.inputTokens + ms.cacheReadTokens + ms.cacheWriteTokens;
          lines.push(
            `- ${provider} / ${model}：输入 ${formatTokens(billed)} · 输出 ${formatTokens(ms.outputTokens)} · 推理 ${formatTokens(ms.reasoningTokens)} · ${ms.requests} 次请求`
          );
        }
      }
      if (Object.keys(summary.providers).length === 0) lines.push("（今天还没有记录到模型调用）");
      return lines.join("\n");
    };

    ctx.inject(["commands"], (cmd) => {
      const dispose = cmd.commands.register({
        name: "usage",
        description: "查看今日 LLM token 用量（按提供商/模型）",
        handler: () => ({ kind: "success", text: commandText() })
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
