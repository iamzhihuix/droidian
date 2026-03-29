import { ItemView, Modal, WorkspaceLeaf, Notice } from 'obsidian';
import type DroidianPlugin from '../../main';
import type { Session, ChatMessage, DroidEvent, Attachment } from '../../core/types';
import type { FileEditPermission } from '../../core/DroidService';
import { renderDiff } from './DiffViewer';
import { exportSessionToMarkdown } from '../../utils/sessionExporter';
import { VIEW_TYPE_DROIDIAN } from '../../core/constants';
import { DroidService } from '../../core/DroidService';
import { ChatRenderer } from './ChatRenderer';
import { StreamController } from './StreamController';
import { InputArea } from './InputArea';
import { StatusBar } from './StatusBar';
import { TabManager } from './TabManager';

export class DroidianView extends ItemView {
	private plugin: DroidianPlugin;
	private service: DroidService;
	private chatRenderer: ChatRenderer;
	private streamController: StreamController | null = null;
	private inputArea: InputArea;
	private statusBar: StatusBar;
	private tabManager: TabManager;
	private isStreaming = false;
	private sessions: Session[] = [];
	private activeSession: Session | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: DroidianPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE_DROIDIAN;
	}

	getDisplayText(): string {
		return 'Factory Droid';
	}

	getIcon(): string {
		return 'bot';
	}

	async onOpen(): Promise<void> {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('droidian-view');

		// Initialize service
		this.service = new DroidService(
			this.plugin.settings,
			(event) => this.handleDroidEvent(event),
			(err) => this.handleProcessError(err),
			(code) => this.handleProcessClose(code)
		);

		// Wire up diff preview permission handler
		this.service.onPermission = (perm) => this.handleFileEditPermission(perm);

		// Load persisted sessions
		this.sessions = this.plugin.getSessions();
		if (this.sessions.length === 0) {
			this.activeSession = this.createNewSession();
		} else {
			this.activeSession = this.sessions[this.sessions.length - 1];
		}
		if (this.activeSession.sessionId) {
			this.service.setSessionId(this.activeSession.sessionId);
		}

		this.buildUI();
	}

	async onClose(): Promise<void> {
		this.service?.cancel();
	}

	private buildUI(): void {
		const { contentEl } = this;

		// Tab bar
		const tabBarEl = contentEl.createDiv('droidian-tab-bar');
		this.tabManager = new TabManager(tabBarEl, this.sessions, {
			onTabSwitch: (session) => this.switchToSession(session),
			onTabNew: () => this.newTab(),
			onTabClose: (id) => this.closeTab(id),
		});
		this.tabManager.setSessions(this.sessions);
		if (this.activeSession) {
			this.tabManager.setActive(this.activeSession.id);
		}

		// Export button in tab bar
		if (this.plugin.settings.exportEnabled) {
			const exportBtn = tabBarEl.createEl('button', {
				cls: 'droidian-tab-export-btn',
				attr: { 'aria-label': 'Export chat to Markdown' },
			});
			exportBtn.innerHTML = exportIcon();
			exportBtn.addEventListener('click', () => this.exportActiveSession());
		}

		// Chat area
		const chatAreaEl = contentEl.createDiv('droidian-chat-area');
		const sourcePath = this.getActiveNotePath();
		this.chatRenderer = new ChatRenderer(chatAreaEl, sourcePath, this.app, {
			onRetry: (msg) => this.retryMessage(msg),
		});

		if (this.activeSession && this.activeSession.messages.length > 0) {
			this.chatRenderer.renderAll(this.activeSession.messages);
		} else {
			this.chatRenderer.showWelcome();
		}

		// Input area
		const inputEl = contentEl.createDiv('droidian-input-area');
		this.inputArea = new InputArea(inputEl, this.app, {
			onSend: (text, attachments) => this.sendMessage(text, attachments),
			onCancel: () => this.cancelStreaming(),
		});

		// Status bar
		const statusEl = contentEl.createDiv('droidian-status-bar');
		this.statusBar = new StatusBar(statusEl, this.plugin.settings, {
			onModelChange: async (model) => {
				this.plugin.settings.model = model;
				await this.plugin.saveSettings();
				this.service.updateSettings(this.plugin.settings);
			},
			onAutoLevelChange: async (level) => {
				this.plugin.settings.autoLevel = level;
				await this.plugin.saveSettings();
				this.service.updateSettings(this.plugin.settings);
			},
		});
	}

	private async sendMessage(text: string, attachments: Attachment[] = []): Promise<void> {
		if (this.isStreaming || !this.activeSession) return;

		const vaultPath = this.getVaultPath();
		if (!vaultPath) {
			new Notice('Could not determine vault path.');
			return;
		}

		// Build enriched text: prepend file attachment paths so Droid can read them
		const fileAttachments = attachments.filter(a => a.type === 'file');
		const imageAttachments = attachments.filter(a => a.type === 'image');
		let enrichedText = text;
		if (fileAttachments.length > 0) {
			const refs = fileAttachments.map(a => `[Attached file: ${a.vaultPath}]`).join('\n');
			enrichedText = refs + (text ? '\n\n' + text : '');
		}

		// Add user message
		const userMsg: ChatMessage = {
			id: `user-${Date.now()}`,
			role: 'user',
			content: text || fileAttachments.map(a => a.name).join(', '),
			timestamp: Date.now(),
			attachments: attachments.length > 0 ? attachments : undefined,
		};
		this.activeSession.messages.push(userMsg);

		if (this.activeSession.messages.length === 1) {
			// First message — hide welcome, add to chat
			this.chatRenderer.renderAll(this.activeSession.messages);
		} else {
			this.chatRenderer.addMessage(userMsg);
		}

		// Auto-generate title from first message
		if (this.activeSession.messages.length === 1) {
			const title = text.slice(0, 30) + (text.length > 30 ? '…' : '');
			this.activeSession.title = title;
			this.tabManager.updateSessionTitle(this.activeSession.id, title);
		}

		this.setStreaming(true);

		// Initialize stream controller for this turn
		this.streamController = new StreamController(
			this.chatRenderer,
			this.activeSession.messages,
			{
				onSessionId: (id) => {
					if (this.activeSession) {
						this.activeSession.sessionId = id;
						this.service.setSessionId(id);
					}
				},
				onComplete: async (_sessionId, messages) => {
					if (this.activeSession) {
						this.activeSession.messages = messages;
						this.activeSession.updatedAt = Date.now();
					}
					await this.plugin.saveSessions(this.sessions);
					this.setStreaming(false);
					// Auto-export to Markdown if enabled
					if (this.plugin.settings.exportEnabled && this.activeSession) {
						exportSessionToMarkdown(this.app, this.activeSession, this.plugin.settings.exportFolder).catch(() => {});
					}
				},
				onError: (err) => {
					new Notice(`Droid error: ${err}`);
					this.setStreaming(false);
				},
				onThinkingUpdate: (_seconds) => {
					// Status bar could show thinking progress here
				},
				onTitle: (title) => {
					if (this.activeSession && this.activeSession.messages.length <= 2) {
						this.activeSession.title = title;
						this.tabManager.updateSessionTitle(this.activeSession.id, title);
					}
				},
				onAssistantMessageDone: (message, renderer) => {
					renderer.showActions({
						onCopy: () => navigator.clipboard.writeText(message.content),
					});
				},
			}
		);

		try {
			const activeFile = this.app.workspace.getActiveFile();
			const noteContext = activeFile?.path ?? '';
			const noteContent = activeFile
				? await this.app.vault.cachedRead(activeFile).catch(() => '')
				: '';
			const selectedText = this.getSelectedText();
			const images = imageAttachments
				.filter(a => a.mimeType && a.base64)
				.map(a => ({ media_type: a.mimeType!, data: a.base64! }));
			await this.service.sendMessage(vaultPath, {
				text: enrichedText,
				noteContext,
				noteContent: noteContent || undefined,
				selectedText: selectedText || undefined,
				images: images.length > 0 ? images : undefined,
			});
		} catch (err) {
			new Notice(`Failed to send message: ${(err as Error).message}`);
			this.setStreaming(false);
		}
	}

	private handleDroidEvent(event: DroidEvent): void {
		this.streamController?.handleEvent(event);
	}

	private handleProcessError(err: Error): void {
		new Notice(`Droid process error: ${err.message}`);
		this.setStreaming(false);
	}

	private handleProcessClose(code: number | null): void {
		if (code !== 0 && code !== null && this.isStreaming) {
			new Notice(`Droid process exited with code ${code}`);
		}
		// Reset process state so next sendMessage spawns fresh (keeps sessionId for continuity)
		this.service.resetProcess();
		this.setStreaming(false);
	}

	private cancelStreaming(): void {
		// Send interrupt RPC so the process keeps running for the next message
		this.service.interrupt();
		this.streamController?.cancel();
		this.setStreaming(false);
	}

	private retryMessage(userMsg: ChatMessage): void {
		if (this.isStreaming || !this.activeSession) return;

		// Remove this message and everything after it from the session
		const idx = this.activeSession.messages.indexOf(userMsg);
		if (idx === -1) return;
		this.activeSession.messages = this.activeSession.messages.slice(0, idx);

		// Re-render chat and re-send
		this.chatRenderer.renderAll(this.activeSession.messages);
		this.sendMessage(userMsg.content);
	}

	private setStreaming(streaming: boolean): void {
		this.isStreaming = streaming;
		this.inputArea.setStreaming(streaming);
	}

	private switchToSession(session: Session): void {
		if (this.isStreaming) {
			this.cancelStreaming();
		}
		this.activeSession = session;
		this.service.setSessionId(session.sessionId);
		this.chatRenderer.renderAll(session.messages);
		if (session.messages.length === 0) {
			this.chatRenderer.showWelcome();
		}
		this.inputArea.focus();
	}

	openNewTab(): void {
		this.newTab();
	}

	/** Called by editor commands — sends a pre-built prompt as a user message. */
	sendFromCommand(text: string): void {
		if (!text.trim()) return;
		this.inputArea.setPrefilledText(text);
		// Auto-send
		this.sendMessage(text);
	}

	private newTab(): void {
		if (this.isStreaming) {
			this.cancelStreaming();
		}
		const session = this.createNewSession();
		this.activeSession = session;
		this.tabManager.addSession(session);
		this.service.resetSession();
		this.chatRenderer.showWelcome();
		this.inputArea.focus();
	}

	private closeTab(id: string): void {
		if (this.sessions.length <= 1) return;

		this.sessions = this.sessions.filter(s => s.id !== id);
		this.tabManager.removeSession(id);

		if (this.activeSession?.id === id) {
			this.activeSession = this.sessions[this.sessions.length - 1] ?? null;
			if (this.activeSession) {
				this.switchToSession(this.activeSession);
			}
		}

		this.plugin.saveSessions(this.sessions);
	}

	private createNewSession(): Session {
		const session: Session = {
			id: `session-${Date.now()}`,
			title: 'New chat',
			createdAt: Date.now(),
			updatedAt: Date.now(),
			messages: [],
		};
		this.sessions.push(session);
		return session;
	}

	private getVaultPath(): string | null {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		return (this.app.vault.adapter as any).basePath ?? null;
	}

	private async exportActiveSession(): Promise<void> {
		if (!this.activeSession || this.activeSession.messages.length === 0) {
			new Notice('No messages to export.');
			return;
		}
		try {
			const path = await exportSessionToMarkdown(
				this.app, this.activeSession, this.plugin.settings.exportFolder
			);
			new Notice(`Exported to ${path}`);
			// Open the exported file
			const file = this.app.vault.getFileByPath(path);
			if (file) this.app.workspace.openLinkText(path, '', 'tab');
		} catch (err) {
			new Notice(`Export failed: ${(err as Error).message}`);
		}
	}

	private async handleFileEditPermission(perm: FileEditPermission): Promise<void> {
		// Read current file content for diff if not provided
		let oldContent = perm.oldContent;
		if (!oldContent && perm.filePath) {
			const file = this.app.vault.getFileByPath(perm.filePath);
			if (file) {
				oldContent = await this.app.vault.read(file).catch(() => '');
			}
		}

		const modal = new DiffModal(this.app, perm, oldContent);
		modal.open();
	}

	private getActiveNotePath(): string {
		const file = this.app.workspace.getActiveFile();
		return file?.path ?? '';
	}

	private getSelectedText(): string {
		const editor = this.app.workspace.activeEditor?.editor;
		if (!editor) return '';
		const sel = editor.getSelection();
		return sel ?? '';
	}
}

// ── Diff Modal ────────────────────────────────────────────────────────────────

import type { App as ObsidianApp } from 'obsidian';

class DiffModal extends Modal {
	private perm: FileEditPermission;
	private oldContent: string;

	constructor(app: ObsidianApp, perm: FileEditPermission, oldContent: string) {
		super(app);
		this.perm = perm;
		this.oldContent = oldContent;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.addClass('droidian-diff-modal');

		contentEl.createEl('h3', { text: `${this.perm.toolName}: ${this.perm.filePath}` });

		const diffEl = contentEl.createDiv('droidian-diff-container');
		// For Edit tool: show old_str → new_str diff
		// For Create/Write: show empty → new content
		renderDiff(diffEl, this.oldContent, this.perm.newContent || this.perm.newContent);

		const btnRow = contentEl.createDiv('droidian-diff-actions');

		const acceptBtn = btnRow.createEl('button', { cls: 'mod-cta', text: 'Accept' });
		acceptBtn.addEventListener('click', () => {
			this.perm.respond('allow_once');
			this.close();
		});

		const rejectBtn = btnRow.createEl('button', { text: 'Reject' });
		rejectBtn.addEventListener('click', () => {
			this.perm.respond('deny');
			this.close();
		});

		const alwaysBtn = btnRow.createEl('button', { text: 'Always allow' });
		alwaysBtn.addEventListener('click', () => {
			const alwaysOpt = this.perm.options.find(o => o.value === 'allow_always');
			this.perm.respond(alwaysOpt?.value ?? 'allow_once');
			this.close();
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

function exportIcon(): string {
	return `<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
		<path d="M2 10v4h12v-4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
		<path d="M8 2v8M5 7l3 3 3-3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
	</svg>`;
}
