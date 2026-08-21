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
  const settingsScopes = [];
  return {
    routes,
    commands,
    handlers,
    settingsScopes,
    ctx: {
      on: (name, fn) => {
        (handlers[name] ??= []).push(fn);
      },
      inject: (services, cb) => {
        if (services.includes("settings")) {
          // mock settings 服务：记录注册的 scope，测试可手动触发 watch
          const scope = {
            value: {},
            ns: "",
            schema: null,
            watchFn: null,
            get: () => scope.value,
            watch: (fn) => {
              scope.watchFn = fn;
            }
          };
          settingsScopes.push(scope);
          cb({
            settings: {
              register: (ns, schema, opts) => {
                scope.ns = ns;
                scope.schema = schema;
                scope.value = { ...opts.base };
                return scope;
              }
            },
            effect: (fn) => {
              fn();
              return () => {};
            }
          });
          return;
        }
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
      logger: { info: (...a) => console.log("[ctx:info]", ...a), warn: (...a) => console.log("[ctx:warn]", ...a) },
      fiber: { state: "ready" }
    },
    emit: (sessionOrEv, ev) => {
      const session = ev === undefined ? { id: "s" } : sessionOrEv;
      const event = ev === undefined ? sessionOrEv : ev;
      handlers["session/event"].forEach((fn) => fn(session, event));
    }
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
  const cmd = await commands[0].handler();
  check("A6 /usage 命令", commands[0].name === "usage" && cmd.kind === "success" && cmd.text.includes("共 3 次请求"));
  const trendLine = cmd.text.split("\n").find((l) => l.startsWith("近 7 天趋势"));
  const barsMatch = trendLine ? trendLine.match(/近 7 天趋势 (\S+) 合计/) : null;
  check("A6b /usage 近 7 天趋势条（7 格，今日非空）",
    !!barsMatch && barsMatch[1].length === 7 && /^[·▁▂▃▄▅▆▇█]{7}$/.test(barsMatch[1]) && !barsMatch[1].endsWith("·"),
    trendLine || "");
  const cmd7 = await commands[0].handler({ rawInput: "7" });
  check("A6c /usage 7（近 7 天区间汇总）",
    cmd7.text.includes("近 7 天（") && cmd7.text.includes("共 4 次请求") && /每日趋势 [·▁▂▃▄▅▆▇█]{7} 合计/.test(cmd7.text),
    cmd7.text.split("\n")[0] || "");
  const cmdBad = await commands[0].handler({ rawInput: "abc" });
  check("A6d /usage 非法参数回退今天", cmdBad.text.startsWith(`今日（`) && cmdBad.text.includes("共 3 次请求"));
  const aCost = 300 * 1.5 / 1e6 + 10 * 0.05 / 1e6 + 130 * 4.5 / 1e6 + 5 * 4.5 / 1e6 + 30 * 4.5 / 1e6 + 10 * 13.5 / 1e6;
  check("A6e /usage 估算费用（deepseek 参考价，全部已计价）",
    cmd.text.includes(`估算费用：¥${aCost.toFixed(2)}`) && cmd.text.includes("全部模型未计价") === false,
    cmd.text.split("\n").find((l) => l.startsWith("估算费用")) || "");
  const bal = await call("/token-stats/balance");
  check("A6f balance 无 credentials 时优雅降级（503 no-credentials）",
    bal.status === 503 && bal.body.ok === false && bal.body.error === "no-credentials", JSON.stringify(bal.body));
  const ss = await call("/token-stats/sessions");
  check("A7 sessions HTTP（实时会话 s 记为顶层）",
    ss.status === 200 && ss.body.sessions.length === 1 && ss.body.sessions[0].id === "s" && ss.body.sessions[0].subagent === false,
    JSON.stringify(ss.body));

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

// ── 测试 C：子代理会话分类（日志头 + 实时 header）+ sessions 接口 ───────────
{
  const tmp = mkdtempSync(join(tmpdir(), "token-stats-testC-"));
  const storagePath = join(tmp, "storages", "token-stats.json");
  process.env.DSH_HOME = tmp;

  // 顶层会话 top1：头无 parentSession / origin
  const topDir = join(tmp, "sessions", "p", "session-top1");
  mkdirSync(topDir, { recursive: true });
  writeFileSync(join(topDir, "session.jsonl"),
    JSON.stringify({ type: "session", id: "top1", createdAt: today, delegationDepth: 0 }) + "\n" +
    JSON.stringify(usageEv("opencode-go", "deepseek-v4-flash", { inputTokens: 1000, outputTokens: 500 }, today)) + "\n");

  // 子代理会话 sub1：头带 parentSession + origin: subagent + delegationDepth: 1
  const subDir = join(tmp, "sessions", "p", "session-sub1");
  mkdirSync(subDir, { recursive: true });
  writeFileSync(join(subDir, "session.jsonl"),
    JSON.stringify({ type: "session", id: "sub1", createdAt: today, parentSession: "top1", origin: "subagent", delegationDepth: 1 }) + "\n" +
    JSON.stringify(usageEv("opencode-go", "deepseek-v4-flash", { inputTokens: 4000, outputTokens: 2000, cacheReadTokens: 10000 }, today)) + "\n");

  // 子代理判定退路：只有 parentSession（老日志无 origin 字段）
  const sub2Dir = join(tmp, "sessions", "p", "session-sub2");
  mkdirSync(sub2Dir, { recursive: true });
  writeFileSync(join(sub2Dir, "session.jsonl"),
    JSON.stringify({ type: "session", id: "sub2", createdAt: today, parentSession: "top1", delegationDepth: 1 }) + "\n" +
    JSON.stringify(usageEv("opencode-go", "deepseek-v4-flash", { inputTokens: 500, outputTokens: 100 }, today)) + "\n");

  const { ctx, routes, commands, emit } = makeCtx();
  plugin.apply(ctx, { storagePath });

  const call = async (url) => {
    const route = routes[0];
    const req = { url };
    let status = 0, body = "";
    const res = { writeHead: (s) => { status = s; }, end: (b) => { body = b; } };
    await route.handler(req, res);
    return { status, body: JSON.parse(body) };
  };

  const s1 = await call("/token-stats/sessions");
  const byId = Object.fromEntries(s1.body.sessions.map((x) => [x.id, x]));
  check("C1 重建分类：top1 顶层 / sub1、sub2 子代理（含 parent 字段）",
    s1.status === 200 &&
      byId.top1 && byId.top1.subagent === false &&
      byId.sub1 && byId.sub1.subagent === true && byId.sub1.parent === "top1" &&
      byId.sub2 && byId.sub2.subagent === true && byId.sub2.parent === "top1",
    JSON.stringify(s1.body.sessions));

  const totals = s1.body.sessions.reduce((a, x) => ({
    req: a.req + x.requests,
    billed: a.billed + x.inputTokens + x.cacheReadTokens + x.cacheWriteTokens
  }), { req: 0, billed: 0 });
  check("C2 sessions 合计 = 日志真实值（3 会话 / 计费 15500）",
    totals.req === 3 && totals.billed === 15500, JSON.stringify(totals));

  // 实时：session.header 携带子代理信息 → 计入 subagent 组
  emit({ id: "live-sub", header: { parentSession: "top1", origin: "subagent", delegationDepth: 1 } },
    usageEv("opencode-go", "deepseek-v4-flash", { inputTokens: 100, outputTokens: 50 }, today));
  emit({ id: "live-top", header: { delegationDepth: 0 } },
    usageEv("opencode-go", "deepseek-v4-flash", { inputTokens: 200, outputTokens: 80 }, today));
  emit({ id: "no-header" }, usageEv("opencode-go", "deepseek-v4-flash", { inputTokens: 30, outputTokens: 10 }, today));
  await new Promise((r) => setTimeout(r, 2600));

  const s2 = await call("/token-stats/sessions");
  const byId2 = Object.fromEntries(s2.body.sessions.map((x) => [x.id, x]));
  check("C3 实时分类：live-sub 子代理 / live-top、no-header 顶层",
    byId2["live-sub"].subagent === true && byId2["live-sub"].parent === "top1" &&
      byId2["live-top"].subagent === false && byId2["no-header"].subagent === false,
    JSON.stringify(s2.body.sessions));

  // /usage 应包含子代理对账行（sub1/sub2/live-sub 共 3 个子代理会话）
  const usageText = (await commands[0].handler()).text;
  check("C5 /usage 含子代理对账行",
    usageText.includes("其中子代理会话") && usageText.includes("3 个会话"),
    usageText.split("\n")[1] || "");

  const s3 = await call("/token-stats/summary");
  check("C6 汇总含全部会话（6 次请求）", s3.body.total.requests === 6, `requests=${s3.body.total.requests}`);

  rmSync(tmp, { recursive: true, force: true });
}

// ── 测试 D：settings 配置表单注册 + storagePath/keepDays 实时切换 ───────────
{
  const tmp = mkdtempSync(join(tmpdir(), "token-stats-testD-"));
  process.env.DSH_HOME = tmp;
  const pathA = join(tmp, "storages", "a.json");
  const pathB = join(tmp, "storages", "b.json");

  // 一份今天的日志：top1 会话 2 次请求
  const sess = join(tmp, "sessions", "p", "session-top1");
  mkdirSync(sess, { recursive: true });
  writeFileSync(join(sess, "session.jsonl"),
    JSON.stringify({ type: "session", id: "top1", createdAt: today, delegationDepth: 0 }) + "\n" +
    JSON.stringify(usageEv("opencode-go", "deepseek-v4-flash", { inputTokens: 1000, outputTokens: 500 }, today)) + "\n" +
    JSON.stringify(usageEv("opencode-go", "deepseek-v4-flash", { inputTokens: 2000, outputTokens: 800, cacheReadTokens: 3000 }, today)) + "\n");

  const { ctx, routes, commands, settingsScopes, emit } = makeCtx();
  plugin.apply(ctx, { storagePath: pathA });
  await new Promise((r) => setTimeout(r, 200));

  check("D1 注册 settings 区块（命名空间 token-stats）",
    settingsScopes.length === 1 && settingsScopes[0].ns === "token-stats",
    JSON.stringify(settingsScopes.map((s) => s.ns)));

  const call = async (url) => {
    const route = routes[0];
    const req = { url };
    let status = 0, body = "";
    const res = { writeHead: (s) => { status = s; }, end: (b) => { body = b; } };
    await route.handler(req, res);
    return { status, body: JSON.parse(body) };
  };

  // 初始：a.json 已由启动重建写入
  check("D2 初始 a.json 存在且 2 次请求",
    existsSync(pathA) && JSON.parse(readFileSync(pathA, "utf8")).days[TODAY_KEY] &&
      Object.values(JSON.parse(readFileSync(pathA, "utf8")).days[TODAY_KEY]).flatMap((p) => Object.values(p))[0].requests === 2);

  // GUI 修改配置：storagePath → b.json, keepDays → 30（触发 watch）
  const scope = settingsScopes[0];
  scope.value = { storagePath: pathB, keepDays: 30 };
  scope.watchFn();
  await new Promise((r) => setTimeout(r, 2600));

  check("D3 切换后 b.json 生成且含日志重建数据（2 次请求）",
    existsSync(pathB) && (() => {
      const st = JSON.parse(readFileSync(pathB, "utf8"));
      const day = st.days[TODAY_KEY];
      if (!day) return false;
      const m = Object.values(day).flatMap((p) => Object.values(p))[0];
      return m.requests === 2 && m.inputTokens === 3000 && m.cacheReadTokens === 3000;
    })());
  check("D4 旧文件 a.json 保留", existsSync(pathA));

  // 切换后实时事件写入新文件
  emit({ id: "live-top", header: { delegationDepth: 0 } },
    usageEv("opencode-go", "deepseek-v4-flash", { inputTokens: 100, outputTokens: 50 }, today));
  await new Promise((r) => setTimeout(r, 2600));
  const after = JSON.parse(readFileSync(pathB, "utf8"));
  const mAfter = Object.values(after.days[TODAY_KEY]).flatMap((p) => Object.values(p))[0];
  check("D5 切换后实时续计写入 b.json（3 次请求）", mAfter.requests === 3, JSON.stringify(mAfter));

  // keepDays 变更不炸、接口仍可用
  scope.value = { storagePath: pathB, keepDays: 60 };
  scope.watchFn();
  const s = await call("/token-stats/summary");
  check("D6 keepDays 变更后接口正常", s.status === 200 && s.body.total.requests === 3);

  rmSync(tmp, { recursive: true, force: true });
}

// ── 测试 E：费用估算（前缀匹配 / 用户覆盖价 / 未计价降级 / history 费用） ─────
{
  const tmp = mkdtempSync(join(tmpdir(), "token-stats-testE-"));
  const storagePath = join(tmp, "storages", "token-stats.json");
  process.env.DSH_HOME = tmp;

  const { ctx, routes, commands, emit } = makeCtx();
  plugin.apply(ctx, {
    storagePath,
    // 用户覆盖 deepseek-v4-flash：input 3 / output 6；cacheRead 继承内置 0.05，
    // cacheWrite 继承 input=3，reasoning 继承 output=6
    prices: { "deepseek-v4-flash": { input: 3, output: 6 } }
  });
  // 带日期后缀的模型名走前缀匹配（deepseek-v4-flash-0731 / DeepSeek-V4-Flash-0731）
  emit(usageEv("tokenrhythm", "deepseek-v4-flash-0731", { inputTokens: 1_000_000, cacheReadTokens: 1_000_000, outputTokens: 1_000_000, reasoningTokens: 500_000 }, today));
  emit(usageEv("modlens-maofei", "DeepSeek-V4-Flash-0731", { inputTokens: 1_000_000, outputTokens: 100_000 }, today));
  // 无价格模型：gpt-5.6-luna → cost null / unpriced 计数
  emit(usageEv("openai", "gpt-5.6-luna", { inputTokens: 1_000_000, outputTokens: 1_000_000 }, today));
  await new Promise((r) => setTimeout(r, 2600));

  const call = async (url) => {
    const route = routes[0];
    const req = { url };
    let status = 0, body = "";
    const res = { writeHead: (s) => { status = s; }, end: (b) => { body = b; } };
    await route.handler(req, res);
    return { status, body: JSON.parse(body) };
  };

  const s = await call("/token-stats/summary");
  const costFlash = (1_000_000 * 3 + 1_000_000 * 0.05 + 1_000_000 * 6 + 500_000 * 6) / 1e6; // 12.05
  const costFlash2 = (1_000_000 * 3 + 100_000 * 6) / 1e6; // 3.6
  const expected = costFlash + costFlash2; // 15.65
  const flashModels = Object.values(s.body.providers["tokenrhythm"].models);
  check("E1 前缀匹配 + 覆盖价（cost 精确）",
    s.body.total.cost !== null && Math.abs(s.body.total.cost - expected) < 1e-9 &&
      s.body.total.unpriced === 1 &&
      Math.abs(flashModels[0].cost - costFlash) < 1e-9 &&
      Math.abs(Object.values(s.body.providers["modlens-maofei"].models)[0].cost - costFlash2) < 1e-9,
    JSON.stringify({ total: s.body.total.cost, unpriced: s.body.total.unpriced, flashModels }));

  const luna = Object.values(s.body.providers["openai"].models)[0];
  check("E2 无价格模型 cost=null（未计价）", luna.cost === null && s.body.total.unpriced === 1, JSON.stringify(luna));

  const h = await call("/token-stats/history?days=1");
  check("E3 history 每日费用", h.body.days[0].total.cost !== null &&
    Math.abs(h.body.days[0].total.cost - expected) < 1e-9, JSON.stringify(h.body.days[0].total));

  const usage = await commands[0].handler();
  check("E4 /usage 含估算费用与未计价提示",
    usage.text.includes(`估算费用：¥${expected.toFixed(2)}`) && usage.text.includes("1 个模型未计价"),
    usage.text.split("\n").find((l) => l.startsWith("估算费用")) || "");

  rmSync(tmp, { recursive: true, force: true });
}

// ── 测试 F：官方余额路由（mock credentials + mock fetch，端到端） ────────────
{
  const tmp = mkdtempSync(join(tmpdir(), "token-stats-testF-"));
  const storagePath = join(tmp, "storages", "token-stats.json");
  process.env.DSH_HOME = tmp;

  // mock global fetch：/user/balance 返回固定余额
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => ({
    ok: true,
    status: 200,
    async text() {
      return JSON.stringify({
        is_available: true,
        balance_infos: [
          { currency: "CNY", total_balance: "88.50", granted_balance: "0.00", topped_up_balance: "88.50" },
          { currency: "USD", total_balance: "0.00", granted_balance: "0.00", topped_up_balance: "0.00" }
        ]
      });
    },
    async json() {
      return JSON.parse(await this.text());
    }
  });

  try {
    const ctx1 = makeCtx();
    // mock 场景 1：有 credentials（resolve 返回 DEEPSEEK_API_KEY）
    ctx1.ctx.get = (name) => (name === "credentials" ? { resolve: async () => ({ value: "sk-test" }) } : undefined);
    plugin.apply(ctx1.ctx, { storagePath });
    const routes1 = ctx1.routes;
    const call1 = async (url) => {
      const req = { url };
      let status = 0, body = "";
      const res = { writeHead: (s) => { status = s; }, end: (b) => { body = b; } };
      await routes1[0].handler(req, res);
      return { status, body: JSON.parse(body) };
    };
    const b1 = await call1("/token-stats/balance");
    check("F1 官方余额（mock 响应：CNY 合计 88.50）",
      b1.status === 200 && b1.body.ok === true && b1.body.currency === "CNY" && Math.abs(b1.body.total - 88.5) < 1e-9 && b1.body.isAvailable === true,
      JSON.stringify(b1.body));
    const b1b = await call1("/token-stats/balance");
    check("F2 余额 60s 缓存（第二次不重新 fetch）", b1b.status === 200 && b1b.body.fetchedAt === b1.body.fetchedAt);

    // mock 场景 2：无 API key
    const ctx2 = makeCtx();
    ctx2.ctx.get = (name) => (name === "credentials" ? { resolve: async () => undefined } : undefined);
    plugin.apply(ctx2.ctx, { storagePath: join(tmp, "storages", "b.json") });
    const routes2 = ctx2.routes;
    const call2 = async (url) => {
      const req = { url };
      let status = 0, body = "";
      const res = { writeHead: (s) => { status = s; }, end: (b) => { body = b; } };
      await routes2[0].handler(req, res);
      return { status, body: JSON.parse(body) };
    };
    const b2 = await call2("/token-stats/balance");
    check("F3 未配置 DEEPSEEK_API_KEY → no-api-key（200 降级，不 5xx）",
      b2.status === 200 && b2.body.ok === false && b2.body.error === "no-api-key", JSON.stringify(b2.body));
  } finally {
    globalThis.fetch = originalFetch;
  }

  rmSync(tmp, { recursive: true, force: true });
}

console.log(`\n=== 结果：${pass} 通过 / ${fail} 失败 ===`);
process.exit(fail > 0 ? 1 : 0);
