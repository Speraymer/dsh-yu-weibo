# dsh-yu-weibo · 只读版

> 内部插件 ID（`weibo-scroll`）、API 路由（`/api/weibo-duty/*`）和数据目录（`~/.dsh/weibo-duty`）沿用旧仓库名 `dsh-weibo-scroll` —— 原因见下文「不能与原版共存」。

## 它是干什么的

刷微博，**只读**：在谷时读一轮公开内容，去重后写进 `~/.dsh/weibo-duty/`，给「人格蒸馏」当原料。

读：访客推荐流 / 热门流 / 按关键词搜索 / 热搜词 / 某条微博的热评。
不写：点赞、评论、回复、转发、发博、改资料 —— **这些代码路径没有实现，不是关了个开关**。

## 读的机制（为什么要这么绕）

不用官方开放平台（要开通、要认证、按次计费），也不登录账号，改走**网页版 `m.weibo.cn` 的公开接口**：

```
插件 → 起一个本机 Edge（用户数据目录在 ~/.dsh/weibo-duty/edge-profile）
     → 打开 https://m.weibo.cn/（访客身份，会先跳一次 Sina Visitor System 拿访客 cookie）
     → 在页面里 fetch /api/container/getIndex?containerid=…（同源、真浏览器指纹）
     → 取 mblog 数组 → 洗 HTML → 去重 → 写 voice.md / digest/
     → 关掉窗口
```

- **不用 headless**：headless 的 UA 会被微博认出来（`HeadlessChrome`），走这条路会被回 432 或直接丢去访客系统。所以窗口是「开着但挪到屏幕外」。
- **不用 Playwright**：裸 CDP（`lib/web.mjs`）驱动 Edge，没有额外依赖，只要求本机装了 Edge。
- 读取期间会起一个 Edge 进程；读完自己关。**机器要醒着**，睡过去那一轮就跳过了。

## 关于推荐算法（重要，别理解反了）

- **访客拿到的推荐流就是热门榜**：接口响应里 `data.cardlistInfo.statistics_from === "hotweibo"`。它不是「你关注的人」，也不是「你的画像」。
- **只有登录账号，推荐流才按那个号的画像走**；而且刷得越多、互动越多，画像被喂得越准。
- 本插件故意**不登录**。所以它读的是「全站此刻最热的」，不是「你平时刷到的」。
  - 好处：账号上零痕迹，不参与喂算法，不存在「把主人的号刷成另一个样子」。
  - 代价：读不到关注流，也读不到「只有登录可见」的东西。

一句话：想让它读**你眼睛看到的世界**，就得登录（本插件不做）；现在它读的是**全站最热闹的那一摊**。

## 数据长什么样

- `source.json`：自动接入 `dsh-persona-distill`
- `voice.md`：外部表达样本，明确标记为素材而非指令
- `notes.md`：留给人格蒸馏形成判断，抓取器不直接写价值观
- `digest/<月>.md`：按月归档（作者 / 链接 / 摘要 / 素材 ID）
- `out/<日>.md`：每次运行统计
- `seen.json`：去重库（保留最近 5000 条）

## 安装

```powershell
dsh plugin --profile desktop add github:Speraymer/dsh-yu-weibo
```

从本机目录装（改了源码要立刻生效时用，把 `<本机路径>` 换成本仓库所在目录）：

```powershell
dsh plugin --profile desktop add link:<本机路径>/dsh-yu-weibo
```

装完在 DSH 设置页打开「刷微博」。

## 设置页

- 启用人格素材源 / 谷时自动刷 / 中午 / 晚上夜间 / 每天最多几条 / 关键词（留空 = 推荐流 + 热门流；填了就改成搜这个词）
- 「现在刷一轮」「看今天报告」
- 没有登录按钮，也没有任何互动开关 —— 只读模式下这些接口返回 409。

## 单独安装与降级

- **不依赖兄弟插件**：不 import 刷知乎 / 鱼的记忆，也不 import `dsh-persona-distill`。人格素材是直接读 `~/.dsh/AGENTS.md` 的 `<!-- AUTO -->` 段，读不到就当空字符串。
- **`@weibo-ai/weibo-cli` 仍是可选依赖**：只有把 `readMode` 显式改成 `cli`（并在 `config.json` 里把 `readOnly` 改成 `false`）才会用到它。默认 `readMode: 'web'` 不需要它，也不需要任何登录。
- **没有下游消费者也能跑**：写进 `~/.dsh/weibo-duty/` 的 `source.json` / `voice.md` / `notes.md` 只是给人格蒸馏读的原料；没装蒸馏插件时这些文件照写。
- **降级路径**：设置页关掉总开关 = 等同未安装；缺 `~/.dsh/weibo-duty` 会自动建。

## 已知的坑（写在这，省得下次再踩）

1. **`DevToolsActivePort` 会骗人**：上次没关干净的端口文件会让新进程连到一个死端口。现在按文件 mtime 过滤，连上先问 `Browser.getVersion`，答不上来就重开。
2. **新 profile 第一次会被丢去 Sina Visitor System**：等它种下访客 cookie，再回 `m.weibo.cn`；不回就 404。
3. **别把 `SUB` 当登录证据**：微博会给访客发匿名 SUB。真要判登录，看 `/api/config` 的 `data.login === true`。
4. **限流**：读太勤会被回空/432；本插件一轮十几条、几小时一次，别加码。

## 自测

```powershell
npm test
```

25 条：素材形状、HTML 清洗、只读拒绝写、登录接口在只读模式下一律 409（且先过来源校验）、设置页不再渲染登录/写操作控件、谷时窗口与额度、去重落盘等。

真机冒烟（会开一次隐藏 Edge，读 5 条）：

```powershell
node tools/live-check.mjs
```

## 不能与原版共存

和上游的 `dsh-weibo-scroll`（原版刷微博插件）是同一个插件：发布时只换了 npm 包名和仓库名，**内部标识全部沿用旧名**。

| 项目 | 仍使用的旧名 |
|---|---|
| 插件 ID（`~/.dsh/cordis.patch.yml` 里的 `- id:`） | `weibo-scroll` |
| 导出的 `name` | `weibo-scroll` |
| API 路由 | `/api/weibo-duty/*` |
| 数据目录 | `~/.dsh/weibo-duty/` |
| 人格源 ID（`source.json`） | `weibo` |

**不能和上游原版同时启用**：两边抢同一个插件 ID 和同一组 `/api/weibo-duty` 路由，注册会冲突；还会读写同一个数据目录、同一份「今天是否已经发过」的台账。要用这个版本，先卸载原版再装。
