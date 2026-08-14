// 独立测试 dsh-token-stats 服务端插件逻辑（不依赖 cordis）
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zstdCompressSync } from "node:zlib";
import plugin from "./lib/index.js";

let pass = 0;
let fail = 0;
const check = (name, ok, extra = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  (" + extra + ")" : ""}`);
  ok ? pass++ : fail++;
};

const makeCtx = () => {
  const routes = [];
  const commands = [];
  const handlers = {};
  return {
    routes,
    commands,
    ctx: {
      on: (name, fn) => {
        (handlers[name] ??= []).push(fn);
      },
      inject: (services, cb) => {
        cb({
          webServer: {
            register: (route) => {
              routes.push(route);
              return () => {};
            }
          },
          commands: {
            register: (def) => {
              commands.push(def);
              return () => {};
            }
          }
        });
      },
      logger: { info: (...a) => console.log("[ctx:info]", ...a), warn: (...a) => console.log("[ctx:warn]", ...a) }
    },
    handlers,
    emit: (ev) => handlers["session/event"].forEach((fn) => fn({ id: "s" }, ev))
  };
};

const usageEv = (provider, model, usage, time) => ({
  type: "assistant/message",
  time,
  data: { usage, message: { source: { provider, model } } }
});

const today = Date.now();
const yesterday = today - 86400000;
const localDayKey = (ts) => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const TODAY_KEY = localDayKey(today);

// ── 测试 A：实时订阅 + HTTP + /usage（干净环境，无会话日志） ───────────────
{
  const tmp = mkdtempSync(join(tmpdir(), "token-stats-testA-"));
  mkdirSync(join(tmp, "sessions"));
  process.env.DSH_HOME = tmp;
  const storagePath = join(tmp, "storages", "token-stats.json");

  const { ctx, routes, commands, emit } = makeCtx();
  plugin.apply(ctx, { storagePath });

  // 重建：sessions 为空 → 今天 0 次（无任何 bucket，甚至不落盘）
  check("A1 空日志重建为 0 请求",
    !existsSync(storagePath) || !(JSON.parse(readFileSync(storagePath, "utf8")).days[TODAY_KEY]));

  emit(usageEv("opencode-go", "deepseek-v4-flash", { inputTokens: 100, outputTokens: 50, cacheReadTokens: 10, reasoningTokens: 5 }, today));
  emit(usageEv("opencode-go", "deepseek-v4-flash", { inputTokens: 200, outputTokens: 80 }, today));
  emit(usageEv("deepseek-official", "deepseek-v4-pro", { inputTokens: 30, outputTokens: 10 }, today));
  emit(usageEv("opencode-go", "deepseek-v4-flash", { inputTokens: 999, outputTokens: 111 }, yesterday));
  emit({ type: "assistant/chunk", data: { chunk: { type: "usage", usage: { inputTokens: 1 } } } });
  emit({ type: "turn/end", data: { turn: 1, reason: { kind: "completed" } } });

  await new Promise((r) => setTimeout(r, 2600)); // 防抖落盘

  const persisted = JSON.parse(readFileSync(storagePath, "utf8"));
  const days = Object.keys(persisted.days).sort();
  const todayTotal = Object.values(persisted.days[days[1]]).flatMap((p) => Object.values(p)).reduce(
    (a, s) => ({ requests: a.requests + s.requests, input: a.input + s.inputTokens, output: a.output + s.outputTokens }),
    { requests: 0, input: 0, output: 0 }
  );
  check("A2 实时计数（今天 3 次 / 昨天 1 次，非 usage 事件忽略）",
    todayTotal.requests === 3 && todayTotal.input === 330 && todayTotal.output === 140 && days.length === 2,
    JSON.stringify(todayTotal));

  const call = async (url) => {
    const route = routes[0];
    const req = { url };
    let status = 0, body = "";
    const res = { writeHead: (s) => { status = s; }, end: (b) => { body = b; } };
    await route.handler(req, res);
    return { status, body: JSON.parse(body) };
  };
  const s = await call("/token-stats/summary");
  check("A3 summary HTTP", s.status === 200 && s.body.total.requests === 3, `requests=${s.body.total.requests}`);
  const h = await call("/token-stats/history?days=3");
  check("A4 history HTTP", h.status === 200 && h.body.days.length === 3 && h.body.days[0].total.requests === 3);
  const nf = await call("/token-stats/other");
  check("A5 404 HTTP", nf.status === 404);
  const cmd = commands[0].handler();
  check("A6 /usage 命令", commands[0].name === "usage" && cmd.kind === "success" && cmd.text.includes("共 3 次请求"));

  rmSync(tmp, { recursive: true, force: true });
}

// ── 测试 B：多帧 zstd 日志重建 + 重启不重复 + 实时续计 ─────────────────────
{
  const tmp = mkdtempSync(join(tmpdir(), "token-stats-testB-"));
  const sess = join(tmp, "sessions", "work-a", "session-aaa");
  mkdirSync(sess, { recursive: true });
  const storagePath = join(tmp, "storages", "token-stats.json");
  process.env.DSH_HOME = tmp;

  // 多帧 zstd：帧1 = session 头（旧版回填的坑：只能解出这一帧）；帧2 = 今天的 usage 事件
  const frame1 = zstdCompressSync(Buffer.from(`${JSON.stringify({ type: "session", id: "aaa", createdAt: today })}\n`));
  const frame2 = zstdCompressSync(Buffer.from(
    [
      JSON.stringify(usageEv("opencode-go", "deepseek-v4-flash", { inputTokens: 1000, outputTokens: 500, cacheReadTokens: 8000 }, today)),
      JSON.stringify(usageEv("opencode-go", "deepseek-v4-flash", { inputTokens: 2000, outputTokens: 900, cacheReadTokens: 16000 }, today)),
      ""
    ].join("\n")
  ));
  writeFileSync(join(sess, "session.jsonl.zstd"), Buffer.concat([frame1, frame2]));

  // 普通 jsonl：1 条今天的 + 1 条昨天的（应被排除）
  const plain = join(tmp, "sessions", "work-b", "session-bbb");
  mkdirSync(plain, { recursive: true });
  writeFileSync(join(plain, "session.jsonl"),
    JSON.stringify(usageEv("opencode-go", "deepseek-v4-flash", { inputTokens: 500, outputTokens: 200 }, today)) + "\n" +
    JSON.stringify(usageEv("opencode-go", "deepseek-v4-flash", { inputTokens: 99999, outputTokens: 88888 }, yesterday)) + "\n");

  // 第一次加载：重建今天 = 3 次（2 zstd + 1 jsonl），昨天的排除
  const c1 = makeCtx();
  plugin.apply(c1.ctx, { storagePath });
  const st1 = JSON.parse(readFileSync(storagePath, "utf8"));
  const d1 = Object.values(st1.days[TODAY_KEY] ?? st1.days[Object.keys(st1.days).pop()]).flatMap((p) => Object.values(p))[0];
  check("B1 多帧日志完整解码重建（3 次请求，昨天排除）",
    d1.requests === 3 && d1.inputTokens === 3500 && d1.outputTokens === 1600 && d1.cacheReadTokens === 24000,
    JSON.stringify(d1));

  // 实时续计 1 次
  c1.emit(usageEv("opencode-go", "deepseek-v4-flash", { inputTokens: 10, outputTokens: 5 }, today));
  await new Promise((r) => setTimeout(r, 2600));
  const st2 = JSON.parse(readFileSync(storagePath, "utf8"));
  const d2 = Object.values(st2.days[Object.keys(st2.days).pop()]).flatMap((p) => Object.values(p))[0];
  check("B2 重建后实时续计（4 次请求）", d2.requests === 4, JSON.stringify(d2));

  // 模拟重启：再次加载（同一 storage + 同一日志）→ 重建 = 3，不重复计数
  const c3 = makeCtx();
  plugin.apply(c3.ctx, { storagePath });
  const st3 = JSON.parse(readFileSync(storagePath, "utf8"));
  const d3 = Object.values(st3.days[Object.keys(st3.days).pop()]).flatMap((p) => Object.values(p))[0];
  check("B3 重启后重建不重复计数（3 次请求）", d3.requests === 3, JSON.stringify(d3));

  rmSync(tmp, { recursive: true, force: true });
}

console.log(`\n=== 结果：${pass} 通过 / ${fail} 失败 ===`);
process.exit(fail > 0 ? 1 : 0);
