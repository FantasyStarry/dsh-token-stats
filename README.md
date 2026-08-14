# dsh-token-stats

按自然日统计 DeepSeek Harness（DSH）Web 的 LLM token 用量，按**提供商 / 模型**拆分，
持久化到磁盘，并在 Web GUI 的多个位置展示。

## 功能

- **统计口径**：每次成功的模型调用计一次（来自会话事件 `assistant/message` 的
  `usage` 与 `message.source.{provider,model}`，与 token-meter 同源）。
  失败回合、被重试的尝试不计入。
  - `inputTokens`（未缓存输入）、`outputTokens`、`cacheReadTokens`（缓存读）、
    `cacheWriteTokens`（缓存写）、`reasoningTokens`（推理）
  - 计费输入 ≈ `inputTokens + cacheReadTokens + cacheWriteTokens`
- **按自然日**（服务器本地时区 `YYYY-MM-DD`）聚合，历史保留 366 天（可配）。
- **启动回填**：自动扫描 `$DSH_HOME/sessions` 下今天有写入的会话日志
  （zstd/jsonl），把今天早些时候的用量也统计进来。
- **三处展示**：
  1. 侧边栏底部常驻小部件：今日输入/输出 token 总计，点击展开按提供商/模型明细
     （每 30s 轮询 + 窗口聚焦时刷新）；
  2. 设置页"用量统计"分区：今日明细表（提供商/模型/输入/缓存读/输出/推理/请求数）
     + 最近 7 天历史；
  3. `/usage` 命令：在对话中输入 `/usage` 直接查看今日用量（结果渲染为对话流节点）。
- **HTTP API**（同源，供客户端插件使用）：
  - `GET /token-stats/summary?day=YYYY-MM-DD`（默认今天）
  - `GET /token-stats/history?days=N`（默认 7，上限 30）

## 安装

从 GitHub 安装（推荐，锁定版本标签）：

```bash
dsh plugin --profile web add "github:FantasyStarry/dsh-token-stats#v0.1.0"
```

本地源码安装（开发调试）：

```bash
# 1. 安装进 web profile（file: 引用源码目录，改动即时反映）
dsh plugin --profile web add "file:C:/path/to/dsh-token-stats"

# 2. 在 $DSH_HOME/profiles/web/cordis.patch.yml 中激活：
# - insert:
#     - id: token-stats
#       name: dsh-token-stats

# 3. 重启 dsh web（或依赖 cordis.patch.yml 热重载；浏览器刷新页面加载客户端插件）
```

升级插件：改代码 → 提交推送 → 打新标签（如 `v0.1.1`）→
`dsh plugin --profile web add "github:FantasyStarry/dsh-token-stats#v0.1.1"` → 重启 `dsh web`。

## 配置

`cordis.patch.yml` 行支持 `config`：

```yaml
- insert:
    - id: token-stats
      name: dsh-token-stats
      config:
        storagePath: C:/path/to/token-stats.json   # 默认 $DSH_HOME/storages/token-stats.json
        keepDays: 366                              # 历史保留天数
```

## 数据文件

默认 `$DSH_HOME/storages/token-stats.json`（原子写入，防抖落盘）：

```json
{
  "days": {
    "2026-08-14": {
      "opencode-go": {
        "deepseek-v4-flash": {
          "requests": 29, "inputTokens": 8000, "outputTokens": 16000,
          "cacheReadTokens": 6800000, "cacheWriteTokens": 0, "reasoningTokens": 0
        }
      }
    }
  }
}
```

## 结构

```
lib/index.js    服务端插件（零外部依赖，仅 node 内置模块 + cordis ctx API）
lib/client.js   客户端插件（AMD bundle，window.__ModuleLoader__ 加载）
test-standalone.mjs   服务端逻辑独立测试（node test-standalone.mjs）
verify-ui.py    Playwright 端到端验证（python verify-ui.py）
```

## 说明

- 数据源可靠性：`assistant/message` 事件在适配器上报时携带 `usage`
  （DeepSeek 官方适配器与 pi-ai 适配器均上报）。未上报的调用不会计入。
- 客户端插件无需重新构建 web 前端：宿主扫描带 `dsh.client` 字段的包并通过
  `/plugins/<id>/client.js` 运行时提供。
