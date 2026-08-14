/**
 * dsh-token-stats — 服务端插件。
 *
 * 按自然日聚合 LLM token 用量（按 provider/model 拆分），数据来源是会话事件
 * `assistant/message`（携带该次请求的 `usage` 与 `message.source.{provider,model}`，
 * 见 dsh-agent-loop 的 append 调用）。每次成功模型调用计一次，重试/失败回合不计。
 *
 * 提供：
 *  - 持久化：原子写入 $DSH_HOME/storages/token-stats.json（可用 config.storagePath 覆盖）
 *  - HTTP：GET /token-stats/summary?day=YYYY-MM-DD、GET /token-stats/history?days=N
 *  - 命令：/usage —— 今日用量文本
 *  - 启动回填：扫描 $DSH_HOME/sessions 下今天有写入的会话日志（zstd/jsonl），
 *    统计事件时间属于今天的 assistant/message，与实时订阅不重复计数。
 *
 * 零外部依赖：只使用 node 内置模块与 cordis 上下文 API（ctx.on/ctx.inject/ctx.on("dispose")）。
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { zstdDecompressSync } from "node:zlib";

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

    // ── 实时订阅：每个会话的每一条事件（firehose） ─────────────────────────
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

    // ── 启动回填：今天有写入的会话日志（只统计事件时间属于今天的） ──────────
    const backfill = () => {
      const sessionsRoot = join(dshHome(), "sessions");
      if (!existsSync(sessionsRoot)) return;
      const todayStart = startOfToday();
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
      for (const file of files) {
        try {
          if (statSync(file).mtimeMs < todayStart) continue;
          const raw = readFileSync(file);
          const text = file.endsWith(".zstd") ? zstdDecompressSync(raw).toString("utf8") : raw.toString("utf8");
          for (const line of text.split("\n")) {
            if (!line) continue;
            let event;
            try {
              event = JSON.parse(line);
            } catch {
              continue;
            }
            if (!event || event.type !== "assistant/message" || !event.data || !event.data.usage) continue;
            if (typeof event.time !== "number" || event.time < todayStart) continue;
            const source = event.data.message && event.data.message.source;
            record(
              (source && source.provider) || "unknown",
              (source && source.model) || "unknown",
              event.data.usage,
              event.time
            );
          }
        } catch {
          // 单个文件损坏/不可读：跳过
        }
      }
      flush();
    };
    backfill();

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
