// 用真实 DSH 会话日志验证修复后的重建逻辑（storage 指向临时文件，不碰真实数据）
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import plugin from "./lib/index.js";

const tmp = mkdtempSync(join(tmpdir(), "token-stats-verify-"));
process.env.DSH_HOME = "C:\\Users\\Mayn\\.dsh";
const storagePath = join(tmp, "token-stats.json");

const handlers = {};
const ctx = {
  on: (name, fn) => { (handlers[name] ??= []).push(fn); },
  inject: (services, cb) => cb({
    webServer: { register: () => () => {} },
    commands: { register: () => () => {} }
  }),
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
console.log("日志真实:", JSON.stringify({ requests: 405, inputTokens: 685057, outputTokens: 257052, cacheReadTokens: 49061632, cacheWriteTokens: 0, reasoningTokens: 0 }));

// 模拟再次加载（重启）→ 不重复计数
const handlers2 = {};
const ctx2 = {
  on: (name, fn) => { (handlers2[name] ??= []).push(fn); },
  inject: (services, cb) => cb({
    webServer: { register: () => () => {} },
    commands: { register: () => () => {} }
  }),
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
