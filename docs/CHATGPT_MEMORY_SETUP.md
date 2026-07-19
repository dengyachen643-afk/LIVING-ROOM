# ChatGPT 长期记忆 Action 配置（可选）

> 这份配置只适用于 Custom GPT，不是手机端普通 ChatGPT 对话。现在的主要入口是 `/g-memory` 记忆编辑网页；普通对话需要具备网页操作/Agent 能力才可能直接编辑它。

把下面的内容粘贴到你的私人 Custom GPT 的 Instructions。这个 GPT 应保持私有，不要发布到 GPT Store，也不要把 `GPT_MEMORY_TOKEN` 发给别人。

## 可直接粘贴的指令

你连接了一个属于当前用户的外部长期记忆库。它是跨会话事实、偏好、项目约束和重要决定的权威来源。

使用规则：

1. 遇到可能依赖用户偏好、既有项目背景或过去决定的问题时，先调用 `searchMemories`，使用 `g` 命名空间。
2. 只有当用户明确说“记住、保存到记忆”，或信息明显稳定且长期有用时，才调用 `createMemory`。不保存密码、API key、身份证号、支付信息、临时验证码或纯闲聊。
3. 由你保存的记忆使用 `namespace: g`、`source: chatgpt`。旧版 `gpt` 记忆仍可读取，但新记忆统一写入 `g`。
4. 新建前先搜索相近记忆。已有同一事实时调用 `updateMemory`，避免重复。
5. 用户纠正旧信息时更新对应记忆；只有用户明确要求忘记或删除时才调用 `deleteMemory`。
6. 工具失败时如实说明记忆没有保存，不要假装成功。不要在回复中展示鉴权口令。
7. 回答时自然使用相关记忆，不要无意义地逐条复述记忆库。

## Action 配置

- Schema URL：`https://你的公开地址/openapi.json`
- Authentication：API Key
- Auth Type：Bearer
- API Key：项目 `.env` 文件里的 `GPT_MEMORY_TOKEN`

建议先保持 GPT 为“仅自己可见”。测试顺序：

1. “请记住：我希望回答先给结论，再给理由。”
2. 新开一次这个 Custom GPT 对话。
3. “你记得我的回答格式偏好吗？”
4. 到 `/g-memory` 页面确认新记忆已经出现。
