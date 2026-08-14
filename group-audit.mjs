// 按"顶层会话 / 子代理会话"分组统计今天的 usage，验证用户 61.6M 的口径
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { zstdDecompressSync } from "node:zlib";

const home = process.env.DSH_HOME || join(homedir(), ".dsh");
const sessionsRoot = join(home, "sessions");
const ZSTD_MAGIC = 4247762216;

function scanZstdFrames(buffer) {
  const frames = [];
  let offset = 0;
  while (offset < buffer.length) {
    const start = offset;
    if (buffer.length - offset < 4) return frames;
    if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) return frames;
    offset += 4;
    const descriptor = buffer.readUInt8(offset);
    offset += 1;
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
      if (blockType === 3) return frames;
      const payloadBytes = blockType === 1 ? 1 : blockSize;
      if (buffer.length - offset < payloadBytes) return frames;
      offset += payloadBytes;
      if (lastBlock) break;
    }
    if (checksum) { offset += 4; }
    frames.push({ start, end: offset });
  }
  return frames;
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

const todayStart = (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); })();
const groups = {}; // sessionId -> { id, parent, isTop, events, billed, output, requests, file }
const rows = [];

for (const file of files) {
  const raw = readFileSync(file);
  const text = file.endsWith(".zstd")
    ? scanZstdFrames(raw).map(({ start, end }) => {
        try { return zstdDecompressSync(raw.subarray(start, end)).toString("utf8"); } catch { return ""; }
      }).join("")
    : raw.toString("utf8");
  let sessionId = file.includes("session-") ? (file.match(/session-([0-9a-f-]{36})/)?.[1] || "") : "";
  let parent = "";
  const sum = { requests: 0, billed: 0, input: 0, output: 0, cacheRead: 0 };
  for (const line of text.split("\n")) {
    if (!line) continue;
    let ev;
    try { ev = JSON.parse(line); } catch { continue; }
    if (ev.type === "session") {
      sessionId = ev.id || sessionId;
      parent = ev.parentSession || "";
      continue;
    }
    if (!ev || ev.type !== "assistant/message" || !ev.data || !ev.data.usage) continue;
    const t = typeof ev.time === "number" ? ev.time : 0;
    if (t < todayStart) continue;
    const u = ev.data.usage;
    sum.requests += 1;
    sum.input += u.inputTokens ?? 0;
    sum.output += u.outputTokens ?? 0;
    sum.cacheRead += u.cacheReadTokens ?? 0;
    sum.billed += (u.inputTokens ?? 0) + (u.cacheReadTokens ?? 0) + (u.cacheWriteTokens ?? 0);
  }
  groups[sessionId] = { id: sessionId, parent, isTop: !parent, ...sum, file: file.split("sessions\\").pop() };
}

const tops = Object.values(groups).filter((g) => g.isTop);
const subs = Object.values(groups).filter((g) => !g.isTop);
const sum = (arr, k) => arr.reduce((a, g) => a + g[k], 0);
const fmt = (n) => Number(n).toLocaleString("zh-CN");

console.log("=== 顶层会话（GUI 会话列表可见） ===");
for (const g of tops) console.log(`  ${g.id.slice(0, 8)}  parent=${g.parent || "-"}  req=${g.requests}  计费输入=${fmt(g.billed)}  输出=${fmt(g.output)}  [${g.file.split("\\")[0]}]`);
console.log(`顶层合计: 请求=${sum(tops, "requests")}  计费输入=${fmt(sum(tops, "billed"))}  输出=${fmt(sum(tops, "output"))}`);

console.log("\n=== 子代理会话（GUI 会话列表不可见） ===");
for (const g of subs) console.log(`  ${g.id.slice(0, 8)}  parent=${(g.parent || "").slice(0, 8)}  req=${g.requests}  计费输入=${fmt(g.billed)}  输出=${fmt(g.output)}`);
console.log(`子代理合计: 请求=${sum(subs, "requests")}  计费输入=${fmt(sum(subs, "billed"))}  输出=${fmt(sum(subs, "output"))}`);

console.log("\n=== 全部 ===");
console.log(`全部合计: 请求=${sum([...tops, ...subs], "requests")}  计费输入=${fmt(sum([...tops, ...subs], "billed"))}  输出=${fmt(sum([...tops, ...subs], "output"))}`);
console.log(`顶层 + 子代理 = ${fmt(sum(tops, "billed") + sum(subs, "billed"))}`);
