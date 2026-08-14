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
- **启动重建（v0.1.1）**：每次加载插件时把"今天"的统计从会话日志整体重算
  （`$DSH_HOME/sessions` 下今天有写入的 zstd/jsonl 日志，完整解码全部 zstd 帧），
  再叠加实时订阅的新事件。插件无论何时安装/重启/热重载，今天的数据都以日志为准，
  不漏计、不重复计数。
- **三处展示（v0.2.0 起，数字用 k/m/b 缩写）**：
  1. 侧边栏底部常驻小部件：今日输入/输出 token 总计（如 `今日 72.7M / 425.2k tok`），
     点击展开按提供商/模型明细（每 30s 轮询 + 窗口聚焦时刷新）；
  2. 设置页"用量统计"分区（v0.3.1 起为克制数据面板：无卡片盒子，复用宿主 CSS
     变量，深浅色自适应）：
     - 头部统计：一个主数字（计费输入）+ 三个次级数字（请求/输出/缓存读），
       靠留白分隔，数字等宽对齐
     - 一行次要指标：缓存命中率、平均输入/输出每请求
     - 一行对账（v0.3.0）：`顶层会话 X ＋ 子代理会话 Y（n 个）＝ 总计 Z`，
       说明插件统计全部会话（含子代理），GUI 会话列表只显示顶层
     - 模型明细表：提供商/模型/计费输入/未缓存/缓存读/输出/推理/请求 + **细占比条**
     - 会话明细表：按"顶层会话 / 子代理会话"分组，子代理标注父会话
     - 最近 7 天：纯 CSS 迷你柱状图（带图例，hover 看完整数字）+ 逐日表；
  3. `/usage` 命令：对话中输入 `/usage` 直接查看今日用量（缩写 + 子代理对账行，
     结果渲染为对话流节点）。
- **HTTP API**（同源，供客户端插件使用）：
  - `GET /token-stats/summary?day=YYYY-MM-DD`（默认今天）
  - `GET /token-stats/history?days=N`（默认 7，上限 30）
  - `GET /token-stats/sessions?day=YYYY-MM-DD`（v0.3.0：按会话明细，含子代理标记）

## 安装

从 GitHub 安装（推荐，锁定版本标签）：

```bash
dsh plugin --profile web add "github:FantasyStarry/dsh-token-stats#v0.2.0"
```

本地源码安装（开发调试）：

```bash
# 1. 安装进 web profile（file: 引用源码目录）
dsh plugin --profile web add "file:C:/path/to/dsh-token-stats"

# 2. 在 $DSH_HOME/profiles/web/cordis.patch.yml 中激活：
# - insert:
#     - id: token-stats
#       name: dsh-token-stats

# 3. 重启 dsh web（服务端插件代码变更需要重启加载；浏览器刷新页面加载客户端插件）
```

> **开发迭代注意**：本机 profile 的 `nodeLinker: hoisted`（pnpm v11）会把 `file:`
> 依赖**拷贝**进 `node_modules`，并非符号链接。改代码后需要重新
> `dsh plugin --profile web add "file:..."` 或手动把 `lib/` 同步到
> `node_modules/dsh-token-stats/lib/`：客户端 bundle（`client.js`）是每次请求实时
> 读文件的，同步后**刷新浏览器**即生效；服务端（`index.js`）需要**重启 dsh web**。

升级插件：改代码 → 提交推送 → 打新标签（如 `v0.2.0`）→
`dsh plugin --profile web add "github:FantasyStarry/dsh-token-stats#v0.2.0"` → 重启 `dsh web`。

> **注意（v0.1.0 已知问题，v0.1.1 修复）**：DSH 会话日志（`session.jsonl.zstd`）是
> **多帧 zstd 容器**——每批事件追加一个独立压缩帧。v0.1.0 的回填用
> `zstdDecompressSync` 解整个文件只能得到第一帧（通常是 session 头），导致启动回填
> 实际读到 0 条 usage：插件加载之前发生的调用全部漏计（实测漏掉约 3/4 的用量）。
> v0.1.1 改为按帧完整解码 + 每次加载重建今天，数据与日志完全一致。

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
audit-sessions.mjs    会话日志审计工具：完整解码所有日志并与插件统计对比
verify-real.mjs       用真实日志验证重建逻辑（storage 指向临时文件，不碰真实数据）
verify-ui.py    Playwright 端到端验证（python verify-ui.py）
```

## 说明

- 数据源可靠性：`assistant/message` 事件在适配器上报时携带 `usage`
  （DeepSeek 官方适配器与 pi-ai 适配器均上报）。未上报的调用不会计入。
- 重建只覆盖当前自然日；更早的天依赖插件当时在运行（实时计数），
  插件没在运行期间发生的调用不会补计。
- 客户端插件无需重新构建 web 前端：宿主扫描带 `dsh.client` 字段的包并通过
  `/plugins/<id>/client.js` 运行时提供。
