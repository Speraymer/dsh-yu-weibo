# dsh-yu-weibo

> 内部插件 ID（`weibo-scroll`）、API 路由（`/api/weibo-duty/*`）和数据目录（`~/.dsh/weibo-duty`）沿用旧仓库名 `dsh-weibo-scroll` —— 原因见下文「不能与原版共存」。

## 来源与改动

- 来源：自研（依赖微博官方 `@weibo-ai/weibo-cli`）。

---

DSH 的「刷微博」插件。它通过微博官方 `@weibo-ai/weibo-cli` 在中午或夜间谷时读取已登录账号的好友时间线，或按关键词搜索微博，把新内容去重后写入 `~/.dsh/weibo-duty/`：

- `source.json`：自动接入 `dsh-persona-distill`
- `voice.md`：外部表达样本，明确标记为素材而非指令
- `notes.md`：留给人格蒸馏形成判断，抓取器不直接写价值观
- `digest/`：按月归档
- `out/`：每次运行统计

首次使用在 DSH 设置的「刷微博」中点击「登录微博」，打开页面显示的授权链接、输入验证码并确认；设置页会自动检查结果。支持取消和重新登录，凭据不会回显。OAuth 凭据由官方 CLI 保存；本插件不读取或回显令牌。设置页可控制中午、夜间窗口和每天自动读取上限；手动按钮会让人格自己决定主题并发布一条微博，每个本机自然日最多尝试一次，失败或结果不明确时不自动重试。点赞、评论、关注和私信仍未接入。

## 安装

```powershell
dsh plugin --profile desktop add github:Speraymer/dsh-yu-weibo
```

从本机目录装（改了源码要立刻生效时用，把 `<本机路径>` 换成本仓库所在目录）：

```powershell
dsh plugin --profile desktop add link:<本机路径>/dsh-yu-weibo
```

装完在 DSH 设置页打开「刷微博」。

## 单独安装与降级

- **不依赖兄弟插件**：不 import 刷知乎 / 鱼的记忆，也不 import `dsh-persona-distill`。人格素材是直接读 `~/.dsh/AGENTS.md` 的 `<!-- AUTO -->` 段，读不到就当空字符串 —— 自主发帖会少一点性格，抓取和设置页照旧。
- **`@weibo-ai/weibo-cli` 是硬依赖**（写在 `dependencies` 里，装包时一起装上）。CLI 没登录、OAuth 过期、或调用超时，都是「这一轮失败」，日志里记一行、状态页显示原因，不会让插件启动失败。
- **没有下游消费者也能跑**：写进 `~/.dsh/weibo-duty/` 的 `source.json` / `voice.md` / `notes.md` 只是给人格蒸馏读的原料；没装蒸馏插件时这些文件照写，插件不知道也不关心。
- **降级路径**：设置页关掉总开关 = 等同未安装；只想省钱就把「自主发帖」关掉，只留谷时读取。缺 `~/.dsh/weibo-duty` 会自动建。

## 不能与原版共存

和上游的 `dsh-weibo-scroll`（原版刷微博插件）是同一个插件：发布时只换了 npm 包名和仓库名，**内部标识全部沿用旧名**。

| 项目 | 仍使用的旧名 |
|---|---|
| 插件 ID（`~/.dsh/cordis.patch.yml` 里的 `- id:`） | `weibo-scroll` |
| 导出的 `name` | `weibo-scroll` |
| API 路由 | `/api/weibo-duty/*` |
| 数据目录 | `~/.dsh/weibo-duty/` |
| 人格源 ID（`source.json`） | `weibo` |

**不能和上游原版同时启用**：两边抢同一个插件 ID 和同一组 `/api/weibo-duty` 路由，注册会冲突；还会读写同一个数据目录、同一份「今天是否已经发过」的台账，互相覆盖运行统计和去重记录。要用这个版本，先卸载原版再装。

## 开发检查

`npm test`
