# LIVING ROOM

一个类似微信或 Telegram 的私人聊天空间。包含 Gen、Kimi、K 的多 AI 群聊，以及 Gen 与 Kimi 一对一私聊；支持已读、emoji、长期记忆和手机长按复制消息。

## 群聊规则

- `@Gen 请先分析`：只有 Gen 收到消息。
- `@Gen @Kimi 你们比较一下`：Gen 和 Kimi 都会回复。
- `@所有人` 或不写 `@`：所有已勾选且在线的群成员都会回复。
- AI 可以在回复中写 `@Kimi`、`@K` 等，把话题传给另一位成员。
- 关闭“允许 AI 互相 @ 接话”后，AI 的点名只作为普通文字，不会触发下一条回复。
- 你可以随时按“停止接话”，然后继续发新的群消息。

## 为什么不会无限聊天

每条用户消息只产生一条有限回复链，限制由服务端强制执行：

- 每条链最多 8 条 AI 消息。
- 同一个 AI 在一条链中最多回复 2 次。
- 同一方向的点名关系只触发一次，例如 `Gen → Kimi` 不会重复入队。
- AI 转发深度最多 3 层。
- 没有新的有效 `@` 时自然结束。
- 单个模型默认 120 秒超时，页面可立即停止整条回复链。

## 启动

需要 Node.js 22 或更新版本；本机已经安装 Node.js 24 LTS。

```powershell
cd "C:\Users\asus\OneDrive\文档\G老师"
npm start
```

本地地址：<http://127.0.0.1:8787>

API key 与访问口令只保存在 `.env`，不会发送给浏览器或其他模型。聊天与记忆保存在 `.roundtable/state.json`。

## 手机不用 Wi-Fi 访问

当前已经启用持久 Tailscale Funnel：

```text
https://laptop-oh2h0n9l.tail6fa261.ts.net
```

手机只需要普通浏览器，不需要安装或打开 Tailscale App，因此不会占用手机 VPN 槽位，可以继续使用原来的 GPT VPN。电脑必须开机、联网并保持群聊服务运行。

当前设置了 `ROUNDTABLE_PUBLIC_ACCESS=true`，手机打开上面的普通网址即可直接使用，不再要求输入网站访问口令。Kimi API Key 保存在电脑端，不需要在手机重复输入。注意：Funnel 入口是公开 HTTPS，拿到网址的人也能读取或修改聊天与记忆，因此不要公开转发网址。

## 群记忆

- 最多保存 1000 条结构化记忆。
- 每条记忆包含 `namespace`、标签、重要度、来源、元数据和 `vectorStatus`。
- 当前支持关键词与本地向量的混合检索；网页与 ChatGPT Action 接口保持不变。
- 每次 AI 回复会获得最近的相关群聊上下文和最多 40 条长期记忆。
- 清空群聊不会删除长期记忆。

## Kimi 私聊

在左侧聊天列表点击 `Kimi`，输入 Moonshot API Key 后即可聊天。Key 会保存到本机 `.roundtable/kimi-api-key.txt`，配置接口只返回是否已配置，不会把 Key 内容发回网页；因此输入一次后，手机和电脑都可使用。也可以继续在 `.env` 中设置 `MOONSHOT_API_KEY`。

- Kimi 可以自己维护记忆：你明确说“记住……”时它会写入；稳定偏好、长期项目等未来有用的信息，它也可以自主保存或更新。只有你明确要求“忘掉/删除”时，它才有权删除。
- 每次实际新增、更新或删除后，聊天中都会显示一条提示。右上角“记忆”按钮仍可人工查看、添加和删除。
- 记忆由本网站保存，不是 Kimi 厂商账号里的记忆。正文保存在 `.roundtable/state.json`，向量也只保存在电脑服务器端，不会发送给网页。
- 当前 Moonshot 开放平台默认模型为 `kimi-k3`。Kimi Code 托管通道使用的 `k3` 是另一套模型 ID，不能混用。
- 推理模型返回 `reasoning_content` 时，消息内会显示可折叠的“思考过程”。
- 用户消息在服务端接收后显示“已读”。
- Kimi 私聊记录以 `channel=kimi` 与群聊隔离。
- 侧栏“Kimi 的记忆”使用 `namespace=kimi`，回复时同时检索 Kimi 专属记忆与 `shared` 共享记忆。
- 当前使用本地多语言 embedding 模型生成 384 维向量，并采用关键词 + 向量的混合检索。首次下载的模型缓存位于 `.roundtable/models`；不会产生 Moonshot embedding 费用。
- 如需为旧记忆重建向量，运行 `npm run reindex`。

Kimi 正文回复完成后会立即结束“输入中”并解锁发送框；记忆整理改在后台执行，稍后自动同步提示，不再阻塞下一轮聊天。

## Gen 私聊

左侧点击 `Gen` 即可使用白色主题私聊。Gen 通过本机官方 Codex CLI 复用现有 ChatGPT/Codex 登录，不需要 OpenAI API Key。

- 使用 `g` 命名空间中的 G老师记忆，并结合 `shared` 共享记忆做关键词 + 向量混合召回。
- 回复和记忆判断在同一次结构化生成中完成；正文显示在聊天里，记忆动作由服务器执行。
- Gen 可以主动保存稳定长期信息；删除仍要求用户明确提出忘记或删除。
- Gen 私聊记录以 `channel=gen` 与 Kimi、群聊隔离。

## G老师的记忆编辑器

专用网页：

```text
https://laptop-oh2h0n9l.tail6fa261.ts.net/g-memory
```

首次打开需要输入 `.env` 中的 `GPT_MEMORY_TOKEN`；也可以把口令放进一次性的 `?token=` 链接。页面收到口令后会放进当前浏览器的 `sessionStorage`，并马上从地址栏删除查询参数。

编辑器支持新增、搜索、修改、删除与 JSON 导出。G老师口令只能访问 `g` 与旧版 `gpt` 命名空间，不能读写 Kimi 记忆、群消息、配置或模型 API key。普通 ChatGPT 对话只有在具备网页操作/Agent 能力时才能直接操作这个网页；否则可以让 G老师整理出记忆文本，再由用户粘贴保存。

G老师编辑器写入的记忆也会自动生成同样的本地向量，供以后在群聊或私聊中按语义召回。

## 可选：让 Custom GPT 通过 Action 读写记忆

Custom GPT Action 的 Schema URL：

```text
https://laptop-oh2h0n9l.tail6fa261.ts.net/openapi.json
```

鉴权选择 `API Key → Bearer`，值使用 `.env` 中的 `GPT_MEMORY_TOKEN`。把 [docs/CHATGPT_MEMORY_SETUP.md](docs/CHATGPT_MEMORY_SETUP.md) 的指令粘贴到 GPT Instructions。

这个口令只有 G老师记忆的增删改查权限，不能发送群消息、调用其他模型或读取模型 API key。没有 OpenAI API 时，Custom GPT 可以主动读写记忆，但本地群聊不能在后台自动调用 ChatGPT 网页版发言。

## 模型接入

### OpenAI API

```dotenv
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-5.6-terra
```

### Kimi API

```dotenv
MOONSHOT_API_KEY=...
KIMI_MODEL=kimi-k3
KIMI_PRIVATE_MODEL=kimi-k3
KIMI_TEMPERATURE=1
KIMI_TOP_P=0.95
```

### Claude API

```dotenv
ANTHROPIC_API_KEY=...
ANTHROPIC_MODEL=claude-opus-4-8
```

### Claude Code

```dotenv
CLAUDE_CODE_ENABLED=true
CLAUDE_CODE_COMMAND=claude
CLAUDE_CODE_MODEL=opus
```

Claude Code 在群聊中以无工具、无持久会话、单次只回复一条消息的安全模式运行；群历史与记忆由服务端传入。

### Codex CLI

```dotenv
CODEX_CLI_ENABLED=true
CODEX_CLI_COMMAND=C:\Users\asus\AppData\Local\Programs\OpenAI\Codex\bin\codex.exe
CODEX_CLI_MODEL=gpt-5.6-sol
```

本机服务使用官方独立 Codex CLI，并复用 `~/.codex` 中的 ChatGPT 登录。Gen 私聊通过 `GEN_PRIVATE_*` 配置启用。

## 验证

```powershell
npm run check
npm test
```

## 文件结构

```text
public/             微信群式网页界面、@ 快捷按钮和手机布局
src/groupchat.js    @ 路由、消息队列、接话限制与停止规则
src/providers.js    GPT、Kimi、Claude 与本地 CLI 适配器
src/server.js       HTTP、流式群消息和记忆 API
src/store.js        群聊历史与长期记忆持久化
scripts/            Tailscale Funnel 远程访问助手
docs/               Custom GPT 记忆 Action 配置
test/               群聊路由、Provider、记忆与服务器测试
```
