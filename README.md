# Factory Droid for Obsidian

> [中文](README_CN.md)

An Obsidian plugin that brings [Factory Droid](https://factory.ai) — a powerful AI coding and knowledge agent — directly into your vault. Chat with Droid in a sidebar panel, run it from the editor context menu, and even use it from your phone or tablet.

## Features

### Chat Interface
- Streaming assistant responses with Markdown rendering
- Tool call display with expand/collapse and status indicators (running / success / error)
- Multiple tabs per session, persistent across restarts
- Retry any user message; copy any assistant message

### Context Awareness
- **Active note injection** — the content of the currently open note is automatically included in every message
- **Selected text focus** — highlight text in the editor before asking; only the selection is sent (saves tokens)
- **File links** — file paths mentioned in responses are clickable and open the file in a new tab

### Editor Commands
Right-click selected text in any note for quick Droid actions:
- Ask Droid about selection
- Summarize
- Translate (to Chinese)
- Rewrite / improve
- Explain

All commands are also available in the Command Palette (`Cmd/Ctrl + P`).

### Attachments
- **Paste images** — `Cmd/Ctrl + V` to paste a screenshot or image; shown as thumbnail, sent as base64
- **Attach files** — click the paperclip icon or drag a file onto the input box to reference vault files
- **Drag & drop** — drag images or vault files directly into the input

### Diff Preview
When Droid edits a file, a diff modal shows the proposed change before it is written. Accept, reject, or set "always allow" per tool call. Toggle in Settings → File Edit Preview.

### Chat Export
Export any conversation to a Markdown file in your vault (e.g. `Droid/sessions/2026-03-29 Session Title.md`), complete with frontmatter and tool call summaries. Configure auto-export in Settings → Chat Export.

### Mobile / Remote Access
Use Droid on your iPhone or Android via a WebSocket relay server running on your Mac:
1. On Mac: Settings → Relay Server → Enable
2. On mobile: Settings → Remote Connection → enter the server URL
3. Use any tunneling tool (Tailscale, frp, ngrok) to expose the relay port remotely

## Keyboard Shortcuts

| Action | Shortcut |
|--------|----------|
| Send message | `Cmd+Enter` (macOS) / `Ctrl+Enter` (Windows/Linux) |
| New line in input | `Enter` |
| Open Droid | Ribbon icon or Command Palette |

## Installation

### From the Plugin Directory
Search for **"Factory Droid"** in Obsidian → Settings → Community plugins.

### Manual
```bash
mkdir -p <vault>/.obsidian/plugins/droidian
cd <vault>/.obsidian/plugins/droidian
curl -LO https://github.com/iamzhihuix/droidian/releases/latest/download/main.js
curl -LO https://github.com/iamzhihuix/droidian/releases/latest/download/manifest.json
curl -LO https://github.com/iamzhihuix/droidian/releases/latest/download/styles.css
```

Then enable the plugin in Obsidian → Settings → Community plugins.

## Requirements

- [Factory Droid CLI](https://factory.ai) installed on your machine
- Obsidian 1.8.0 or later
- For mobile use: a relay server on a desktop machine (see above)

## Settings

| Setting | Description |
|---------|-------------|
| Droid CLI path | Path to the `droid` executable. Leave blank for auto-detection. |
| Default model | AI model for conversations (Claude, GPT, Gemini, etc.) |
| Autonomy level | Controls what operations Droid can perform without confirmation |
| Show diff before edits | Show a diff preview modal before Droid writes files |
| Export conversations | Auto-save chats as `.md` files in a vault folder |
| Export folder | Vault-relative path for exported chat files (default: `Droid/sessions`) |
| Enable relay server | Start the WebSocket relay for mobile/remote access |
| Relay port | Port the relay server listens on (default: 8766) |
| Auth token | Optional secret for relay URL authentication |
| Remote URL | WebSocket URL of the relay server (mobile / remote mode) |

## Development

```bash
git clone https://github.com/iamzhihuix/droidian
cd droidian
npm install

# Dev build (watch mode)
npm run dev

# Production build
npm run build
```

Copy `main.js`, `manifest.json`, and `styles.css` into your vault's `.obsidian/plugins/droidian/` folder and enable the plugin.

## License

MIT
