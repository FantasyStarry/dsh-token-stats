// 用真实 DSH 会话日志验证修复后的重建逻辑（storage 指向临时文件，不碰真实数据）
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zstdDecompressSync } from "node:zlib";
import plugin from "./lib/index.js";

const ZSTD_MAGIC = 4247762216;

// 独立于插件代码的日志审计（多帧 zstd 完整解码），作为真实值的参照
function auditLogs() {
  const root = "C:\\Users\\Mayn\\.dsh\\sessions";
  const start = (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); })();
  const files = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name === "session.jsonl.zstd" || e.name === "session.jsonl") files.push(full);
    }
  };
  walk(root);
  const totals = { requests: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0 };
  const frames = (buf) => {
    const out = [];
    let off = 0;
    while (off < buf.length) {
      const s = off;
      if (buf.length - off < 4 || buf.readUInt32LE(off) !== ZSTD_MAGIC) return out;
      off += 4;
      if (off === buf.length) return out;
      const desc = buf.readUInt8(off++);
      const cs = desc >>> 6, seg = (desc & 32) !== 0, ck = (desc & 4) !== 0;
      const dict = desc & 3;
      const db = dict === 3 ? 4 : dict;
      const cb = cs === 0 ? (seg ? 1 : 0) : 1 << cs;
      const rem = (seg ? 0 : 1) + db + cb;
      if (buf.length - off < rem) return out;
      off += rem;
      for (;;) {
        if (buf.length - off < 3) return out;
        const bh = buf.readUIntLE(off, 3);
        off += 3;
        const last = (bh & 1) !== 0, bt = (bh >>> 1) & 3, bs = bh >>> 3;
        if (bt === 3) return out;
        const pb = bt === 1 ? 1 : bs;
        if (buf.length - off < pb) return out;
        off += pb;
        if (last) break;
      }
      if (ck) { if (buf.length - off < 4) return out; off += 4; }
      out.push({ s, e: off });
    }
    return out;
  };
  for (const f of files) {
    try {
      if (statSync(f).mtimeMs < start) continue;
      const raw = readFileSync(f);
      let text = "";
      for (const { s, e } of frames(raw)) {
        try { text += zstdDecompressSync(raw.subarray(s, e)).toString("utf8"); } catch { }
      }
      for (const line of text.split("\n")) {
        if (!line) continue;
        let ev;
        try { ev = JSON.parse(line); } catch { continue; }
        if (!ev || ev.type !== "assistant/message" || !ev.data || !ev.data.usage) continue;
        const t = typeof ev.time === "number" ? ev.time : 0;
        if (t < start) continue;
        const u = ev.data.usage;
        totals.requests += 1;
        totals.inputTokens += u.inputTokens ?? 0;
        totals.outputTokens += u.outputTokens ?? 0;
        totals.cacheReadTokens += u.cacheReadTokens ?? 0;
        totals.cacheWriteTokens += u.cacheWriteTokens ?? 0;
        totals.reasoningTokens += u.reasoningTokens ?? 0;
      }
    } catch { }
  }
  return totals;
}

const tmp = mkdtempSync(join(tmpdir(), "token-stats-verify-"));
process.env.DSH_HOME = "C:\\Users\\Mayn\\.dsh";
const storagePath = join(tmp, "token-stats.json");

const handlers = {};
const ctx = {
  on: (name, fn) => { (handlers[name] ??= []).push(fn); },
  inject: (services, cb) => {
    if (services.includes("settings")) return; // 无 settings 服务：配置表单不注册
    cb({
      webServer: { register: () => () => {} },
      commands: { register: () => () => {} }
    });
  },
  logger: { info: (...a) => console.log(...a), warn: (...a) => console.log(...a) }
};

plugin.apply(ctx, { storagePath });

const state = JSON.parse(readFileSync(storagePath, "utf8"));
console.log("=== 修复后重建的真实今日统计 ===");
console.log(JSON.stringify(state, null, 2));

const t = state.days[Object.keys(state.days).pop()];
const totals = { requests: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0 };
for (const [prov, models] of Object.entries(t || {}))
  for (const [m, s] of Object.entries(models))
    for (const k of Object.keys(totals)) totals[k] += s[k];

console.log("\n=== 与日志真实值对比 ===");
console.log("插件重建:", JSON.stringify(totals));
const truth = auditLogs();
console.log("日志真实:", JSON.stringify(truth));
console.log(totals.requests === truth.requests ? "✓ 与日志一致" : "✗ 与日志不一致!");

// 模拟再次加载（重启）→ 不重复计数
const handlers2 = {};
const ctx2 = {
  on: (name, fn) => { (handlers2[name] ??= []).push(fn); },
  inject: (services, cb) => {
    if (services.includes("settings")) return; // 无 settings 服务：配置表单不注册
    cb({
      webServer: { register: () => () => {} },
      commands: { register: () => () => {} }
    });
  },
  logger: { info: () => {}, warn: (...a) => console.log(...a) }
};
plugin.apply(ctx2, { storagePath });
const state2 = JSON.parse(readFileSync(storagePath, "utf8"));
const t2 = state2.days[Object.keys(state2.days).pop()];
const totals2 = { requests: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0 };
for (const [prov, models] of Object.entries(t2 || {}))
  for (const [m, s] of Object.entries(models))
    for (const k of Object.keys(totals2)) totals2[k] += s[k];
console.log("二次加载(模拟重启):", JSON.stringify(totals2), totals2.requests === totals.requests ? "✓ 不重复" : "✗ 重复了!");

rmSync(tmp, { recursive: true, force: true });
