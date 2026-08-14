# DropNavi

DropNavi 是一个以 [Raindrop.io](https://raindrop.io/) 为数据源、部署在 Cloudflare Workers 上的轻量网址导航站。

它刻意把“管理收藏”和“展示收藏”分开：

- 在 Raindrop.io 中新增、删除、移动和整理网站；
- DropNavi 只负责读取 Collection 与 Raindrop 数据并展示；
- Raindrop 数据变化不需要 Git commit，也不需要重新部署；
- Cloudflare Cron 每 10 分钟同步一次，访问到过期快照时再做一次兜底刷新；
- 上一次同步成功的数据保存在 Workers KV，因此 Raindrop API 临时不可用时网站仍可继续访问。

## 架构

```text
Raindrop.io
    │ REST API
    ▼
Cloudflare Worker
    ├── scheduled() ── 每 10 分钟同步
    ├── /api/navigation
    ├── /api/health
    ├── Static Assets ── 导航前端
    └── Workers KV ── navigation:current
```

代码部署与内容同步是两件独立的事情：**Deployment 管程序版本，Sync 管内容版本。**

## 界面

视觉参考项目自身的“微信读书 / 纸张阅读”语言重新设计：米灰背景、暖白内容区、宋体标题、微信绿强调色、细边框和极轻阴影。导航站采用顶部品牌区、搜索框、吸顶分类导航和响应式网站卡片，而不是阅读站的侧栏结构。

导航支持两种分类视图，并统一采用“总览 → 详情”的浏览方式：

- **收藏夹**：默认首页只显示 Raindrop 顶层 Collection 及条目数量；点击收藏夹后进入 `/collection/<id>`，再显示其中的网站与子 Collection 内容；
- **标签**：`/tags` 只显示标签目录及条目数量；点击标签后进入 `/tag/<tag>`，只显示属于该标签的网站。同一网站可以出现在多个标签中，无标签项目统一归入“无标签”。

首页搜索用于筛选收藏夹名称；收藏夹详情页与标签详情页中的搜索会匹配网站标题、域名、简介与标签。

第一版不使用网站封面，也不额外请求第三方 favicon 服务。卡片以文字首字作为轻量标识，减少外部请求并保持版面统一。

## 本地开发

要求 Node.js 20+。

```bash
npm install
```

在项目根目录创建 `.dev.vars`：

```env
RAINDROP_TOKEN=你的_Raindrop_Test_Token
```

然后启动：

```bash
npm run dev
```

Wrangler 会为 `NAV_DATA` 自动创建本地 KV。开发服务器启动后，可测试定时同步：

```bash
curl "http://localhost:8787/__scheduled?cron=*/10+*+*+*+*"
```

再访问：

```text
http://localhost:8787
```

## Raindrop Token

如果这个站点只读取你自己的 Raindrop 数据，可以在 Raindrop App Management Console 中创建应用并使用 **Test token**。

Token 只保存在 Cloudflare Secret 中，绝不能写入 Git 仓库、`wrangler.jsonc` 或前端代码。

## 部署到 Cloudflare Workers

### 方式 A：Wrangler

首次登录：

```bash
npx wrangler login
```

配置生产 Secret：

```bash
npx wrangler secret put RAINDROP_TOKEN
```

部署：

```bash
npm run deploy
```

当前 Wrangler 支持自动资源 provisioning：`wrangler.jsonc` 中只声明了 `NAV_DATA` binding，没有写死 KV ID。首次部署时 Wrangler 会自动创建并绑定 KV。

### 方式 B：Cloudflare Workers Builds / Git 集成

也可以在 Cloudflare Dashboard 中新建 Worker 并连接本仓库。部署命令使用：

```bash
npx wrangler deploy
```

随后在 Worker 的 Settings / Variables and Secrets 中添加 Secret：

```text
RAINDROP_TOKEN
```

Git 集成部署时，Cloudflare 可以自动 provision `NAV_DATA` KV；资源 ID 保存在 Cloudflare 侧，不需要提交到公共仓库。

部署后首次数据快照会在第一次 Cron 或第一次访问 `/api/navigation` 时生成。

## API

### `GET /api/navigation`

返回前端所需的当前导航快照。

### `GET /api/health`

返回 Worker 与数据快照的基本状态，不暴露 Token 或私人数据内容。

## 同步策略

1. Cron 每 10 分钟触发 `scheduled()`。
2. Worker 获取根 Collection、子 Collection 与全部 Raindrops。
3. 数据标准化后一次性写入 `navigation:current`。
4. 前端只读取 KV 快照，不直接访问 Raindrop API。
5. 快照超过 20 分钟时，访问 `/api/navigation` 会返回旧快照并通过 `waitUntil()` 触发兜底刷新。
6. 同步失败时保留上一份成功快照。

Raindrop 单次列表请求最大 50 条，DropNavi 会自动分页。当前安全上限为 200 页（10,000 条收藏），超过时同步会显式失败而不是静默丢数据。

## 许可证

AGPL-3.0 License。
