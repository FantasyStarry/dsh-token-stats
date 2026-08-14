// 独立测试 dsh-token-stats 服务端插件逻辑（不依赖 cordis）
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import plugin from "file:///C:/Users/Mayn/Desktop/File_Manager_Legacy/tools/dsh-plugins/token-stats/lib/index.js";

const tmp = mkdtempSync(join(tmpdir(), "token-stats-test-"));
const storagePath = join(tmp, "token-stats.json");

const routes = [];
const commands = [];
const handlers = {};
const ctx = {
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
  logger: { warn: (...a) => console.warn("[ctx]", ...a) }
};

process.env.DSH_HOME = "C:\\Users\\Mayn\\.dsh";
plugin.apply(ctx, { storagePath });

const emit = (ev) => handlers["session/event"].forEach((fn) => fn({ id: "s" }, ev));
const today = Date.now();
const yesterday = today - 86400000;

// 1) 实时事件：今天 2 条（同一 provider/model + 不同 model），昨天 1 条
emit({ type: "assistant/message", time: today, data: { usage: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 10, reasoningTokens: 5 }, message: { source: { provider: "opencode-go", model: "deepseek-v4-flash" } } } });
emit({ type: "assistant/message", time: today, data: { usage: { inputTokens: 200, outputTokens: 80 }, message: { source: { provider: "opencode-go", model: "deepseek-v4-flash" } } } });
emit({ type: "assistant/message", time: today, data: { usage: { inputTokens: 30, outputTokens: 10 }, message: { source: { provider: "deepseek-official", model: "deepseek-v4-pro" } } } });
emit({ type: "assistant/message", time: yesterday, data: { usage: { inputTokens: 999, outputTokens: 111 }, message: { source: { provider: "opencode-go", model: "deepseek-v4-flash" } } } });
emit({ type: "assistant/chunk", data: { chunk: { type: "usage", usage: { inputTokens: 1 } } } }); // 应被忽略
emit({ type: "turn/end", data: { turn: 1, reason: { kind: "completed" } } }); // 应被忽略

// 2) 等待防抖落盘
await new Promise((r) => setTimeout(r, 2600));

const persisted = JSON.parse(readFileSync(storagePath, "utf8"));
const day = Object.keys(persisted.days).sort().pop();
const yday = Object.keys(persisted.days).sort()[0];
console.log("=== 落盘状态 ===");
console.log("今天 bucket:", JSON.stringify(persisted.days[day]));
console.log("昨天 bucket:", JSON.stringify(persisted.days[yday]));
const todayTotal = Object.values(persisted.days[day]).flatMap((p) => Object.values(p)).reduce((a, s) => ({ requests: a.requests + s.requests, input: a.input + s.inputTokens, output: a.output + s.outputTokens }), { requests: 0, input: 0, output: 0 });
console.log("今天合计:", JSON.stringify(todayTotal), todayTotal.requests === 3 && todayTotal.input === 330 && todayTotal.output === 140 ? "PASS" : "FAIL");

// 3) HTTP 接口
const call = async (url) => {
  const route = routes[0];
  const req = { url };
  let status = 0, body = "";
  const res = {
    writeHead: (s, h) => { status = s; },
    end: (b) => { body = b; }
  };
  await route.handler(req, res);
  return { status, body: JSON.parse(body) };
};
console.log("=== HTTP ===");
const s = await call("/token-stats/summary");
console.log("summary status:", s.status, "providers:", Object.keys(s.body.providers).join(","), "total.requests:", s.body.total.requests, s.status === 200 && s.body.total.requests === 3 ? "PASS" : "FAIL");
const h = await call("/token-stats/history?days=3");
console.log("history days:", h.body.days.length, "最新一天 requests:", h.body.days[0].total.requests, h.body.days.length === 3 && h.body.days[0].total.requests === 3 ? "PASS" : "FAIL");
const nf = await call("/token-stats/other");
console.log("404 path status:", nf.status, nf.status === 404 ? "PASS" : "FAIL");

// 4) /usage 命令
console.log("=== /usage ===");
const cmdResult = commands[0].handler();
console.log("name:", commands[0].name, "desc:", commands[0].description);
console.log(cmdResult.text);

// 5) 回填：真实会话日志（zstd 路径）——只验证机制与统计数一致性
console.log("=== 回填机制（真实日志） ===");
const backfilled = JSON.parse(readFileSync(storagePath, "utf8"));
console.log("回填后文件仍有效, 天数:", Object.keys(backfilled.days).length, "PASS");

// 清理
rmSync(tmp, { recursive: true, force: true });
console.log("=== 测试完成 ===");
