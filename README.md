# dsh-token-stats

按自然日统计 DeepSeek Harness（DSH）Web 的 LLM token 用量，按**提供商 / 模型**拆分，
持久化到磁盘，并在 Web GUI 的多个位置展示。

> **项目介绍页**：[docs/index.html](docs/index.html)（单文件 HTML，浏览器直接打开，含安装指引）

## 功能

- **统计口径**：每次成功的模型调用计一次（来自会话事件 `assistant/message` 的
  `usage` 与 `message.source.{provider,model}`，与 token-meter 同源）。
  失败回合、被重试的尝试不计入。
  - `inputTokens`（未缓存输入）、`outputTokens`、`cacheReadTokens`（缓存读）、
    `cacheWriteTokens`（缓存写）、`reasoningTokens`（推理）
  - 计费输入 ≈ `inputTokens + cacheReadTokens + cacheWriteTokens`
- **费用估算与官方余额（v0.10.0）**：按模型参考价把 token 换算成人民币
  （内置 DeepSeek 官方空闲时段价：`deepseek-v4-flash / -vision-exp` 未缓存输入 1.5 元、
  缓存命中 0.05 元、输出 4.5 元每百万；`deepseek-v4-pro` 4.5/0.15/13.5；
  高峰时段 ×2，故估算为"至少"值；`deepseek-chat / -reasoner` 旧参考价保留）。
  键支持**前缀匹配**（`deepseek-v4-flash-0731` / `DeepSeek-V4-Flash-0731` 均命中
  `deepseek-v4-flash`），未匹配的模型费用显示 `—` 并计入「未计价」；
  单价可在插件配置 `prices` 按模型覆盖（缺省 `cacheWrite = 未缓存输入`、
  `reasoning = 输出`）。费用展示于：设置页概览/模型明细/7 天与 30 天逐日表、
  热力图 tooltip、CSV（估算费用列）、宠物弹窗、`/usage`；
  **官方余额**：`GET /user/balance`（`DEEPSEEK_API_KEY` 经 credentials 通道，
  服务端 60s 缓存），设置页概览与 `/usage` 展示，未配置密钥时优雅隐藏；
- **按自然日**（服务器本地时区 `YYYY-MM-DD`）聚合，历史保留 366 天（可配）。
- **启动重建（v0.1.1）**：每次加载插件时把"今天"的统计从会话日志整体重算
  （`$DSH_HOME/sessions` 下今天有写入的 zstd/jsonl 日志，完整解码全部 zstd 帧），
  再叠加实时订阅的新事件。插件无论何时安装/重启/热重载，今天的数据都以日志为准，
  不漏计、不重复计数。
- **四处展示（v0.2.0 起，数字用 k/m/b 缩写）**：
  1. **悬浮用量宠物（v0.6.0 / v0.7.0 / v0.8.0 / v0.9.0 打磨）**（`shell.overlay`）：右下角一只圆滚滚的史莱姆
     （纯 CSS/SVG 绘制，无图片资源）。v0.8.0 参考 Codex 桌宠（Boba / Desk Otter）设计语言：
     角色描边 + 底部暗影 + 地面阴影落地、尺寸加大（64px）、hover 探头、**双击逗宠物**
     （4 颗爱心依次飘起，最大一颗最后飞出 + 蹦跳 + 开心脸）。v0.9.0 赋予生命力：
     **情绪切换 180ms 弹入过渡、待机身体浮动 + 眼睛左顾右盼、工作态屏幕光标闪烁 +
     加载点、晕眩双星对称环绕 + 身体摇摆**；面板头部显示当前状态行（工作中/忙到冒汗/
     转圈圈/打瞌睡/休息中/干完活啦，彩色圆点）。**v0.9.1：身体径向渐变（高光→主体→暗边）、晕眩螺旋眼自旋（替代 X 眼，不再像"挂了"）、弹窗标题小史莱姆、空态打瞌睡史莱姆**。**情绪 = 实时工作状态 + 今日用量**：
     - **工作中（v0.7.0）**：服务端把 `activity`（上次活动时刻 + 最近完成列表）
       附带进 `/token-stats/summary`，客户端 2.5s 轮询；只要任何会话在活动
       （`turn/start`、`tool/call`、`assistant/chunk` 等事件都会刷新活动时刻），
       宠物就"专注盯小电脑"（表情 + 打字颠簸 + 白屏小电脑蓝色进度条动画 +
       右上角脉冲点动画 + 扩散光环动画），悬停气泡显示「正在干活…」；
     - **空闲**：`0 请求 → 打瞌睡`、`轻用量 → 休息眯眼`、`<300k → 冒汗`、
       `≥300k → 晕眩`（阈值可改 `src/client.ts` 的 `MOOD_BUSY_AT` /
       `MOOD_DIZZY_AT`）；
     - **完成提示（v0.7.0 / v0.8.0）**：多任务/子代理每完成一次模型调用，弹
       `✅ 任务完成 · 输入/输出 · 子代理` 提示（v0.8.0 起带小史莱姆图标 + 绿边
       卡片）+ 扩散光环 + 蹦一下（普通单会话回复不打扰）；整段多任务全部收工弹
       `💤 收工啦～`（蓝边卡片）；
     - 悬停吐泡泡显示一行摘要，点击弹出今日汇总面板（计费输入/输出/请求 +
       缓存命中率进度条 + 7 天迷你柱状图 + 近 7 天合计 + 设置页指引），再点或
       点外部/Escape 收起。可拖拽移动，位置与可见性持久化 localStorage（默认右下角）；
  2. 侧边栏底部"用量宠物"开关（v0.6.0 起替代常驻数字小部件）：显示/隐藏悬浮宠物，
     隐藏后宠物完全消失，界面不占用任何空间；
  3. 设置页"用量统计"分区（v0.3.1 起为克制数据面板；v0.8.0 增强，复用宿主 CSS
     变量，深浅色自适应）：
     - 头部统计：一个主数字（计费输入）+ 三个次级数字（请求/输出/缓存读），
       靠留白分隔，数字等宽对齐；右上角日期胶囊 + 手动刷新按钮 + "更新于"时间
     - 一行次要指标：缓存命中率、平均输入/输出每请求 + **缓存命中率进度条**
     - 一行对账（v0.3.0）：`顶层会话 X ＋ 子代理会话 Y（n 个）＝ 总计 Z`，
       说明插件统计全部会话（含子代理），GUI 会话列表只显示顶层
     - 模型明细表：提供商/模型/计费输入/未缓存/缓存读/输出/推理/请求 + **细占比条**；
       表前有**提供商汇总 chips**（提供商名 + 计费输入 + 占比条 + 百分比，降序）；
       窄屏（≤1100px）自动隐藏低优先级列（未缓存/推理，≤760px 再隐藏输出，
       ≤720px 再隐藏占比并收紧内边距/字号），窄屏**零横向溢出**（长文本 ellipsis）
     - 会话明细表：按"顶层会话 / 子代理会话"分组，子代理标注父会话
     - 最近 7 天：纯 CSS 迷你柱状图（带图例，hover 看完整数字；零值日显示基线
       小圆点而非空柱；最后一天加粗高亮；标题注记 7 天合计）+ 逐日表
     - 最近 30 天（v0.9.0）：可折叠小节（▸ 默认收起、懒加载），展开显示 30 天
       紧凑逐日表，标题注记 30 天合计；
      - v0.9.1：概览卡内新增「近 7 天」趋势 sparkline（渐变面积折线）+ 较昨日增幅（↑ 红 / ↓ 绿）；
        缓存命中率只在进度条展示一次（次行去重）；刷新按钮加载时旋转；主指标标签统一为
        「计费输入」；次级指标格统一分隔线；对账行无子代理时省略「＋ 0（0 个）」；
        7 天图末列标注「今天」；空态显示打瞌睡史莱姆；
      - 活跃热力图（v0.9.2）：GitHub 风格周×星期网格（列=周、行=周一..周日），按每日
        计费输入分 5 档（非零日四分位数，单日爆量不压扁其余层次），月份/星期标尺、
        今天描边高亮、悬停放大 + 明细 tooltip、底部「少 ▫▪▪▪▪ 多」图例；默认展开、
        懒加载 `/token-stats/history?days=366`，窄容器横向滚动且自动滚到最右（今天
        首见）；服务端 history 接口上限 30→366 天（需重启 dsh web 生效，旧服务端
        优雅降级为最近 30 天）；
      - 热力图悬浮卡片（v0.9.3）：悬停格子显示 fixed 定位卡片（日期 + 星期、档位
        色点 + 计费输入大数字、输出/请求数），替代原生 title；事件委托在网格容器上；
      - 会话表子代理「子」徽标 + 今日速率 + 月份悬停合计（v0.9.8）：子代理行 ID 后
        显示粉底「子」徽标 + 父会话前缀；概览卡次行新增「今日速率 X / 时」（按当日
        已过时长折算，仅今天视图）；热力图月份标签悬停显示该月计费输入合计；
      - 宠物弹窗迷你热力图（v0.9.3）：命中条与 7 天柱状图之间内嵌「近 30 周」迷你
        热力条（6px 格子 + 今天描边 + 标题行「活跃 N 天」），数据模块级缓存——每次
        页面加载只拉一次 `/token-stats/history?days=210`，打开面板即秒显；
      - 日期导航（v0.9.4）：日期胶囊两侧 ‹ › 切换浏览近 365 天内任意一天——历史天
        标题切「当日用量」并出现「回到今天」快捷键，概览卡/对账/模型与会话明细全部
        按所选天渲染（`summary?day=` / `sessions?day=` 按需拉取），刷新按所选天重载；
        未来天禁用；空天显示带日期的空态文案；
      - CSV 导出（v0.9.4 / v0.9.5）：头部 ⤓ 按钮一键导出当前所选天的明细 CSV——
        「模型明细」+「会话明细」两段（会话含子代理/父会话/最后活动时间），
        UTF-8 BOM，Excel 直接打开不乱码，文件名 `token-stats-<day>.csv`；
      - 深色主题（v0.9.5 回归验证）：热力图五档/空档格、悬浮卡片（深色走
        `--dsw-alias-bg-layer-2`）、sparkline、日期导航、弹窗迷你热力图全部
        深浅色自适应，Playwright 深色截图回归通过（ui8-dark.py，结束后还原主题）；
     - 加载态：首屏/刷新时显示 shimmer 占位（v0.9.0）；
  4. `/usage` 命令：对话中输入 `/usage` 直接查看今日用量（缩写 + 子代理对账行，
     结果渲染为对话流节点；v0.9.6 起含「近 7 天趋势 ▁▂█▅▃▆█ 合计…」趋势条，v0.9.9 起
      支持区间参数 `/usage 7`（汇总最近 N 天，非法参数回退今天，上限 366）；文案由纯函数 `buildUsageText` 生成（`pnpm test` 覆盖；服务端改动需重启 dsh web 生效）。
- **设置页"插件配置"表单（v0.4.0）**：`设置 → 插件` 页出现 token-stats 卡片，
  可修改 `storagePath` / `keepDays`，保存即实时生效（改路径会先把旧数据落盘，
  再在新路径从日志重建今天）。统计面板本身在 `设置 → 用量统计`（插件页不展示
  统计内容，那是独立的 settings 分区）。
- **HTTP API**（同源，供客户端插件使用）：
  - `GET /token-stats/summary?day=YYYY-MM-DD`（默认今天；每模型带 `cost`/全天 `unpriced`）
  - `GET /token-stats/history?days=N`（默认 7，上限 30）
  - `GET /token-stats/sessions?day=YYYY-MM-DD`（v0.3.0：按会话明细，含子代理标记）
  - `GET /token-stats/balance`（v0.10.0：官方余额，Bearer `DEEPSEEK_API_KEY`，
    60s 缓存；未配置密钥 → `{ ok:false, error:"no-api-key" }`）

## 截图

| 设置页「用量统计」（浅色） | 活跃热力图 + 悬浮卡片（深色） |
| --- | --- |
| ![设置页用量统计](docs/settings-light.png) | ![活跃热力图](docs/settings-dark-heat.png) |

**悬浮用量宠物与弹窗**（迷你热力图 / 情绪状态）：

![宠物弹窗](docs/pet-popup.png)

## 安装

从 GitHub 安装（推荐，锁定版本标签）：

```bash
dsh plugin --profile web add "github:FantasyStarry/dsh-token-stats#v0.4.0"
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
`dsh plugin --profile web add "github:FantasyStarry/dsh-token-stats#v0.4.0"` → 重启 `dsh web`。

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
        # 按模型单价表（元/百万 token，可选；键支持前缀匹配，覆盖内置参考价）
        prices:
          deepseek-v4-flash: { input: 1.5, cacheRead: 0.05, output: 4.5 }  # 缺省 cacheWrite=input、reasoning=output
          my-provider/other-model: { input: 3, output: 6 }
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
src/index.ts    服务端插件源码（TypeScript，strict）
src/client.ts   客户端插件源码（AMD bundle，window.__ModuleLoader__ 加载）
lib/index.js    tsc 编译产物（运行/发布用，改 src 后 pnpm build 重新生成）
lib/client.js   tsc 编译产物
tsconfig.json   strict 编译配置（ES2022 + ESNext 模块，输出 lib/）
test-standalone.mjs   服务端逻辑独立测试（pnpm test）
audit-sessions.mjs    会话日志审计工具：完整解码所有日志并与插件统计对比
verify-real.mjs       用真实日志验证重建逻辑（storage 指向临时文件，不碰真实数据）
verify-ui.py    Playwright 端到端验证（python verify-ui.py）
verify-pet.py   Playwright 用量宠物验证：情绪/气泡/面板/拖拽/开关 + 截图
                （python verify-pet.py）
verify-live.py  Playwright 实时活动验证：路由注入 activity，验证工作脸/脉冲点/
                完成提示/收工提示/休息表情（python verify-live.py）
ui4-shots.py     v0.9.1 UI 验证：宠物螺旋眼/渐变/弹窗小史莱姆 + 设置页 sparkline/命中率
                 去重/刷新旋转/对账条件化/空态史莱姆/移动端零溢出（python ui4-shots.py）
ui5-shots.py     v0.9.2 UI 验证：活跃热力图（真实 30 天 + mock 366 天全年：53 列/12 个月
                 标签/今天描边/图例/五档分布/自动滚到最右）（python ui5-shots.py）
ui6-shots.py     v0.9.3 UI 验证：热力图悬浮卡片（fixed 定位/内容断言）+ 宠物弹窗迷你
                 热力图（真实 30 天 + mock 210 天 ≈ 31 列）（python ui6-shots.py）
ui7-shots.py     v0.9.4 UI 验证：日期导航（‹ ›/回到今天/未来禁用/历史空态文案）+
                 CSV 下载（文件名/表头/行数断言）（python ui7-shots.py）
ui8-dark.py      v0.9.5 深色主题回归：热力图/悬浮卡片/sparkline/弹窗在深色下的
                 截图与计算样式断言，结束自动还原主题（python ui8-dark.py）
ui9-shots.py     v0.9.7 UI 验证：热力图格子点击跳转该天（chip/标题断言）+
                 会话 ID 点击复制（剪贴板内容/✓ 反馈断言）（python ui9-shots.py）
verify-cost-ui.py v0.10.0 UI 验证：mock 新服务端响应（带 cost/unpriced/余额），
                 断言概览估算费用与官方余额、模型/历史表「费用」列、宠物弹窗
                 估算费用、旧服务端无 cost 字段兼容、无页面错误
                 （python verify-cost-ui.py）
CHANGELOG.md     版本历史
```

开发流程：改 `src/*.ts` → `pnpm build`（tsc 生成 `lib/*.js`）→ 把 `lib/` 同步到
profile 的 `node_modules/dsh-token-stats/lib/` → 刷新浏览器（客户端）/ 重启
dsh web（服务端）。服务端插件对 `@deepseek-ai/schemastery`、`@deepseek-ai/dsh-settings`
使用动态 import + 优雅降级（解析不到时仅无配置表单）。

## 说明

- 数据源可靠性：`assistant/message` 事件在适配器上报时携带 `usage`
  （DeepSeek 官方适配器与 pi-ai 适配器均上报）。未上报的调用不会计入。
- 重建只覆盖当前自然日；更早的天依赖插件当时在运行（实时计数），
  插件没在运行期间发生的调用不会补计。
- 客户端插件无需重新构建 web 前端：宿主扫描带 `dsh.client` 字段的包并通过
  `/plugins/<id>/client.js` 运行时提供。
