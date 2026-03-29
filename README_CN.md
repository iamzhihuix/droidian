# Factory Droid for Obsidian

> [English](README.md)

将 [Factory Droid](https://factory.ai)（一个强大的 AI 编程与知识助手）集成到 Obsidian 中。在侧边栏与 Droid 对话、通过编辑器右键菜单快速调用，或在手机/平板上远程使用。

## 功能特性

### 对话界面
- 流式输出，支持 Markdown 渲染
- 工具调用展示（可展开/折叠，显示运行中 / 成功 / 失败状态）
- 多标签会话，关闭后自动持久化
- 支持重试用户消息、复制助手回复

### 上下文感知
- **当前笔记注入** — 每次发送消息时，自动将当前打开笔记的内容作为上下文传入
- **选中文本优先** — 在编辑器中选中文字后提问，仅传入选中部分（节省 token）
- **文件链接** — 回复中出现的文件路径可点击，直接在新标签页打开对应文件

### 编辑器命令
在任意笔记中选中文字，右键调出 Droid 快捷操作：
- 向 Droid 提问
- 总结
- 翻译（中文）
- 改写/润色
- 解释

所有命令也可通过命令面板（`Cmd/Ctrl + P`）调用。

### 附件支持
- **粘贴图片** — `Cmd/Ctrl + V` 粘贴截图或图片，以缩略图预览，发送时以 base64 传入
- **附加文件** — 点击回形针图标或将文件拖入输入框，引用 vault 内文件
- **拖拽** — 直接将图片或 vault 文件拖入输入框

### Diff 预览
Droid 编辑文件前，弹出 diff 对话框展示改动内容，可选择接受、拒绝或"始终允许"。可在设置 → 文件编辑预览中开关。

### 聊天导出
将任意对话导出为 vault 内的 Markdown 文件（如 `Droid/sessions/2026-03-29 会话标题.md`），包含 frontmatter 和工具调用摘要。可在设置 → 聊天导出中配置自动导出。

### 移动端 / 远程访问
通过 Mac 上运行的 WebSocket relay server，在 iPhone 或 Android 上使用 Droid：
1. Mac 端：设置 → Relay Server → 启用
2. 移动端：设置 → Remote Connection → 填入服务器 URL
3. 使用任意内网穿透工具（Tailscale、frp、ngrok 等）将 relay 端口暴露到外网

## 快捷键

| 操作 | 快捷键 |
|------|--------|
| 发送消息 | `Cmd+Enter`（macOS）/ `Ctrl+Enter`（Windows/Linux）|
| 输入框换行 | `Enter` |
| 打开 Droid | 侧边栏图标或命令面板 |

## 安装方法

### 插件市场
在 Obsidian → 设置 → 第三方插件 中搜索 **"Factory Droid"**。

### 手动安装
```bash
mkdir -p <vault>/.obsidian/plugins/droidian
cd <vault>/.obsidian/plugins/droidian
curl -LO https://github.com/iamzhihuix/droidian/releases/latest/download/main.js
curl -LO https://github.com/iamzhihuix/droidian/releases/latest/download/manifest.json
curl -LO https://github.com/iamzhihuix/droidian/releases/latest/download/styles.css
```

然后在 Obsidian → 设置 → 第三方插件 中启用该插件。

## 前置要求

- 已安装 [Factory Droid CLI](https://factory.ai)
- Obsidian 1.8.0 及以上版本
- 移动端使用需在桌面机器上运行 relay server（详见上方）

## 设置说明

| 设置项 | 说明 |
|--------|------|
| Droid CLI 路径 | `droid` 可执行文件路径，留空则自动检测 |
| 默认模型 | 对话使用的 AI 模型（Claude、GPT、Gemini 等）|
| 自主级别 | 控制 Droid 无需确认即可执行的操作范围 |
| 编辑文件前显示 diff | 写入文件前弹出 diff 预览 |
| 导出对话 | 每次对话结束后自动保存为 `.md` 文件 |
| 导出目录 | 导出文件保存的 vault 相对路径（默认：`Droid/sessions`）|
| 启用 relay server | 为移动端/远程访问启动 WebSocket relay |
| Relay 端口 | relay server 监听端口（默认：8766）|
| Auth Token | relay URL 认证密钥（可选）|
| 远程 URL | relay server 的 WebSocket 地址（移动端 / 远程模式）|

## 本地开发

```bash
git clone https://github.com/iamzhihuix/droidian
cd droidian
npm install

# 开发构建（监听模式）
npm run dev

# 生产构建
npm run build
```

将 `main.js`、`manifest.json`、`styles.css` 复制到 vault 的 `.obsidian/plugins/droidian/` 目录并启用插件即可。

## 开源协议

MIT
