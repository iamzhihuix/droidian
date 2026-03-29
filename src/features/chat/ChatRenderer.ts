import type { App } from 'obsidian';
import type { ChatMessage } from '../../core/types';
import { MessageRenderer } from './MessageRenderer';

export interface ChatRendererCallbacks {
	onRetry: (message: ChatMessage) => void;
}

export class ChatRenderer {
	private containerEl: HTMLElement;
	private renderers = new Map<string, MessageRenderer>();
	private sourcePath: string;
	private autoScroll = true;
	private callbacks: ChatRendererCallbacks | undefined;
	private app: App;

	constructor(containerEl: HTMLElement, sourcePath: string, app: App, callbacks?: ChatRendererCallbacks) {
		this.containerEl = containerEl;
		this.sourcePath = sourcePath;
		this.app = app;
		this.callbacks = callbacks;

		containerEl.addEventListener('scroll', () => {
			const { scrollTop, scrollHeight, clientHeight } = containerEl;
			this.autoScroll = scrollHeight - scrollTop - clientHeight < 40;
		});
	}

	renderAll(messages: ChatMessage[]): void {
		this.containerEl.empty();
		this.renderers.clear();
		for (const msg of messages) {
			this.addMessage(msg);
		}
		this.scrollToBottom();
	}

	addMessage(message: ChatMessage): MessageRenderer {
		const msgCallbacks = message.isStreaming ? undefined : {
			onCopy: () => navigator.clipboard.writeText(message.content),
			onRetry: message.role === 'user' && this.callbacks
				? () => this.callbacks!.onRetry(message)
				: undefined,
		};
		const renderer = new MessageRenderer(this.containerEl, message, this.sourcePath, this.app, msgCallbacks);
		this.renderers.set(message.id, renderer);
		if (this.autoScroll) this.scrollToBottom();
		return renderer;
	}

	getRenderer(messageId: string): MessageRenderer | undefined {
		return this.renderers.get(messageId);
	}

	scrollToBottom(): void {
		this.containerEl.scrollTop = this.containerEl.scrollHeight;
	}

	showWelcome(): void {
		this.containerEl.empty();
		this.renderers.clear();

		const welcome = this.containerEl.createDiv('droidian-welcome');
		const logo = welcome.createDiv('droidian-welcome-logo');
		logo.innerHTML = droidSvg();
		welcome.createEl('h2').setText('Factory Droid');
		welcome.createEl('p').setText('Ask anything about your vault or codebase.');
	}

	updateSourcePath(sourcePath: string): void {
		this.sourcePath = sourcePath;
	}
}

function droidSvg(): string {
	return `<svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
		<rect x="16" y="20" width="32" height="28" rx="6" fill="currentColor" opacity="0.15"/>
		<rect x="16" y="20" width="32" height="28" rx="6" stroke="currentColor" stroke-width="2"/>
		<circle cx="24" cy="34" r="3" fill="currentColor"/>
		<circle cx="40" cy="34" r="3" fill="currentColor"/>
		<path d="M26 42 Q32 46 38 42" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/>
		<line x1="32" y1="20" x2="32" y2="14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
		<circle cx="32" cy="12" r="2" fill="currentColor"/>
		<line x1="16" y1="32" x2="10" y2="32" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
		<line x1="48" y1="32" x2="54" y2="32" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
	</svg>`;
}
