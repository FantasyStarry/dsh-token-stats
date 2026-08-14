// 审计脚本 v2：完整解码多帧 zstd 会话日志（移植 DSH 的 scanZstdFrames 帧扫描），
// 统计每个会话的真实 usage，与插件持久化对比。
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { zstdDecompressSync } from "node:zlib";

const home = process.env.DSH_HOME || join(homedir(), ".dsh");
const sessionsRoot = join(home, "sessions");
const storagePath = join(home, "storages", "token-stats.json");
const ZSTD_MAGIC = 4247762216;

function scanZstdFrames(buffer) {
  const frames = [];
  let offset = 0;
  while (offset < buffer.length) {
    const start = offset;
    if (buffer.length - offset < 4) return { frames };
    if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) throw new Error(`invalid frame magic at byte ${offset}`);
    offset += 4;
    if (offset === buffer.length) return { frames };
    const descriptor = buffer.readUInt8(offset);
    offset += 1;
    if ((descriptor & 24) !== 0) throw new Error(`reserved frame-header bit at byte ${offset - 1}`);
    const contentSizeFlag = descriptor >>> 6;
    const singleSegment = (descriptor & 32) !== 0;
    const checksum = (descriptor & 4) !== 0;
    const dictionaryFlag = descriptor & 3;
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag;
    const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag;
    const remainingHeaderBytes = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes;
    if (buffer.length - offset < remainingHeaderBytes) return { frames };
    offset += remainingHeaderBytes;
    for (;;) {
      if (buffer.length - offset < 3) return { frames };
      const blockHeader = buffer.readUIntLE(offset, 3);
      offset += 3;
      const lastBlock = (blockHeader & 1) !== 0;
      const blockType = (blockHeader >>> 1) & 3;
      const blockSize = blockHeader >>> 3;
      if (blockType === 3) throw new Error(`reserved block type at byte ${offset - 3}`);
      const payloadBytes = blockType === 1 ? 1 : blockSize;
      if (buffer.length - offset < payloadBytes) return { frames };
      offset += payloadBytes;
      if (lastBlock) break;
    }
    if (checksum) {
      if (buffer.length - offset < 4) return { frames };
      offset += 4;
    }
    frames.push({ start, end: offset });
  }
  return { frames };
}

function decodeAll(file) {
  const raw = readFileSync(file);
  if (!file.endsWith(".zstd")) return raw.toString("utf8");
  const { frames } = scanZstdFrames(raw);
  let out = "";
  for (const { start, end } of frames) {
    try {
      out += zstdDecompressSync(raw.subarray(start, end)).toString("utf8");
    } catch (e) {
      out += `\n<frame-decode-error ${start}-${end}: ${e.message}>\n`;
    }
  }
  return out;
}

const files = [];
const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name === "session.jsonl.zstd" || entry.name === "session.jsonl") files.push(full);
  }
};
walk(sessionsRoot);
files.sort();

let grand = { requests: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0 };
const rows = [];

for (const file of files) {
  const text = decodeAll(file);
  const sum = { requests: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0 };
  let minT = Infinity, maxT = -Infinity, noUsage = 0, withUsage = 0;
  const providers = new Set();
  for (const line of text.split("\n")) {
    if (!line || line.startsWith("<")) continue;
    let ev;
    try { ev = JSON.parse(line); } catch { continue; }
    if (!ev || ev.type !== "assistant/message") continue;
    const t = typeof ev.time === "number" ? ev.time : 0;
    if (t) { if (t < minT) minT = t; if (t > maxT) maxT = t; }
    if (!ev.data || !ev.data.usage) { noUsage++; continue; }
    withUsage++;
    const u = ev.data.usage;
    sum.requests += u.requests ?? 1;
    sum.inputTokens += u.inputTokens ?? 0;
    sum.outputTokens += u.outputTokens ?? 0;
    sum.cacheReadTokens += u.cacheReadTokens ?? 0;
    sum.cacheWriteTokens += u.cacheWriteTokens ?? 0;
    sum.reasoningTokens += u.reasoningTokens ?? 0;
    const src = ev.data.message && ev.data.message.source;
    if (src) providers.add(`${src.provider}/${src.model}`);
  }
  const fmtT = (t) => (t === Infinity ? "-" : new Date(t).toLocaleString("zh-CN", { hour12: false }));
  rows.push({
    file: file.replace(home, "~"),
    withUsage,
    noUsage,
    range: `${fmtT(minT)} ~ ${fmtT(maxT)}`,
    ...sum,
    providers: [...providers].join(",")
  });
  for (const k of Object.keys(grand)) grand[k] += sum[k];
}

console.log("=== 每个会话日志的 usage 统计（完整解码） ===");
for (const r of rows) {
  console.log(
    `${r.file}\n  usage事件=${r.withUsage} 无usage事件=${r.noUsage} 时间范围=${r.range}\n` +
    `  requests=${r.requests} input=${r.inputTokens} output=${r.outputTokens} cacheRead=${r.cacheReadTokens} cacheWrite=${r.cacheWriteTokens} reasoning=${r.reasoningTokens}  (计费输入=${r.inputTokens + r.cacheReadTokens + r.cacheWriteTokens})\n` +
    `  providers=${r.providers || "(无)"}`
  );
}
console.log("\n=== 全部日志合计 ===");
console.log(JSON.stringify(grand, null, 2));

console.log("\n=== 插件持久化 ===");
try {
  const state = JSON.parse(readFileSync(storagePath, "utf8"));
  console.log(JSON.stringify(state, null, 2));
  const t = state.days["2026-08-14"];
  let p = { requests: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0 };
  for (const [prov, models] of Object.entries(t || {})) {
    for (const [m, s] of Object.entries(models)) {
      for (const k of Object.keys(p)) p[k] += s[k];
    }
  }
  console.log("插件合计:", JSON.stringify(p));
  console.log("差异(日志-插件):", JSON.stringify(Object.fromEntries(Object.keys(grand).map((k) => [k, grand[k] - p[k]]))));
} catch (e) {
  console.log("读取失败:", String(e));
}
