import type { App } from 'obsidian';
import type { ChatMessage, ToolCallInfo, Attachment } from '../../core/types';
import { renderMarkdown } from '../../utils/markdown';
import { ToolCallRenderer } from './ToolCallRenderer';
import { linkifyFilePaths, openFileInNewTab } from '../../utils/fileLink';

export interface MessageCallbacks {
	onCopy: () => void;
	onRetry?: () => void;
}

export class MessageRenderer {
	private el: HTMLElement;
	private contentEl: HTMLElement;
	private thinkingEl: HTMLElement | null = null;
	private toolCallRenderer: ToolCallRenderer | null = null;
	private message: ChatMessage;
	private sourcePath: string;
	private app: App;

	constructor(containerEl: HTMLElement, message: ChatMessage, sourcePath: string, app: App, callbacks?: MessageCallbacks) {
		this.message = message;
		this.sourcePath = sourcePath;
		this.app = app;

		this.el = containerEl.createDiv({
			cls: ['droidian-message', `droidian-message--${message.role}`],
		});

		if (message.role === 'assistant') {
			this.toolCallRenderer = new ToolCallRenderer(
				this.el.createDiv('droidian-tool-calls'),
				app,
			);
		}

		this.contentEl = this.el.createDiv('droidian-message-content');
		this.renderContent();

		if (callbacks && !message.isStreaming) {
			this.buildActions(callbacks);
		}
	}

	private buildActions(callbacks: MessageCallbacks): void {
		const actionsEl = this.el.createDiv('droidian-message-actions');

		if (callbacks.onRetry) {
			const retryBtn = actionsEl.createEl('button', { cls: 'droidian-msg-action-btn', attr: { 'aria-label': 'Retry' } });
			retryBtn.innerHTML = retryIcon();
			retryBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				callbacks.onRetry!();
			});
		}

		const copyBtn = actionsEl.createEl('button', { cls: 'droidian-msg-action-btn', attr: { 'aria-label': 'Copy' } });
		copyBtn.innerHTML = copyIcon();
		copyBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			callbacks.onCopy();
			copyBtn.innerHTML = checkIcon();
			setTimeout(() => { copyBtn.innerHTML = copyIcon(); }, 1500);
		});
	}

	showActions(callbacks: MessageCallbacks): void {
		if (this.el.querySelector('.droidian-message-actions')) return;
		this.buildActions(callbacks);
	}

	private async renderContent(): Promise<void> {
		if (this.message.role === 'user') {
			// Render attachments above the text
			if (this.message.attachments && this.message.attachments.length > 0) {
				this.renderAttachments(this.contentEl, this.message.attachments);
			}
			if (this.message.content) {
				this.contentEl.createDiv('droidian-msg-text').setText(this.message.content);
			}
		} else {
			if (this.message.content) {
				await renderMarkdown(this.message.content, this.contentEl, this.sourcePath);
				linkifyFilePaths(this.contentEl, this.app);
			}
		}
	}

	private renderAttachments(containerEl: HTMLElement, attachments: Attachment[]): void {
		const grid = containerEl.createDiv('droidian-msg-attachments');
		for (const att of attachments) {
			if (att.type === 'image' && att.base64) {
				const img = grid.createEl('img', { cls: 'droidian-msg-attachment-thumb' });
				img.src = `data:${att.mimeType ?? 'image/png'};base64,${att.base64}`;
				img.alt = att.name;
			} else if (att.type === 'file' && att.vaultPath) {
				const chip = grid.createDiv('droidian-msg-attachment-file');
				chip.createSpan('droidian-msg-attachment-icon').innerHTML = msgFileIcon();
				chip.createSpan().setText(att.name);
				chip.addClass('droidian-file-link');
				chip.addEventListener('click', () => openFileInNewTab(this.app, att.vaultPath!));
			}
		}
	}

	async updateContent(newContent: string): Promise<void> {
		this.message.content = newContent;
		if (this.message.role === 'assistant') {
			await renderMarkdown(newContent, this.contentEl, this.sourcePath);
			linkifyFilePaths(this.contentEl, this.app);
		} else {
			this.contentEl.setText(newContent);
		}
	}

	showThinking(seconds: number): void {
		if (!this.thinkingEl) {
			this.thinkingEl = this.el.createDiv('droidian-thinking');
			this.el.insertBefore(this.thinkingEl, this.contentEl);
		}
		this.thinkingEl.setText(`Thought for ${seconds}s`);
	}

	hideThinking(): void {
		this.thinkingEl?.remove();
		this.thinkingEl = null;
	}

	addToolCall(info: ToolCallInfo): void {
		this.toolCallRenderer?.addToolCall(info);
	}

	updateToolCall(info: ToolCallInfo): void {
		this.toolCallRenderer?.updateToolCall(info);
	}

	showLoading(): void {
		if (!this.el.querySelector('.droidian-loading-dots')) {
			const dots = this.el.createDiv('droidian-loading-dots');
			dots.innerHTML = '<span></span><span></span><span></span>';
		}
	}

	hideLoading(): void {
		this.el.querySelector('.droidian-loading-dots')?.remove();
	}

	get element(): HTMLElement {
		return this.el;
	}
}

function copyIcon(): string {
	return `<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
		<rect x="5" y="5" width="8" height="9" rx="1.5" stroke="currentColor" stroke-width="1.3"/>
		<path d="M3 11V3.5A1.5 1.5 0 0 1 4.5 2H11" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
	</svg>`;
}

function retryIcon(): string {
	return `<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
		<path d="M2.5 8a5.5 5.5 0 1 0 1.1-3.3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
		<path d="M2.5 3.5V5.5H4.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
	</svg>`;
}

function checkIcon(): string {
	return `<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
		<path d="M3 8.5L6.5 12L13 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
	</svg>`;
}

function msgFileIcon(): string {
	return `<svg viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
		<path d="M3 1h5.5L11 3.5V13H3V1z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>
		<path d="M8.5 1v3H11" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>
	</svg>`;
}
