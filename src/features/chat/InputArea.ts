import { App, FuzzySuggestModal, TFile } from 'obsidian';
import type { Attachment } from '../../core/types';

export interface InputAreaCallbacks {
	onSend: (text: string, attachments: Attachment[]) => void;
	onCancel: () => void;
}

/** Modal for picking a vault file to attach */
class FilePicker extends FuzzySuggestModal<TFile> {
	private onChoose: (file: TFile) => void;

	constructor(app: App, onChoose: (file: TFile) => void) {
		super(app);
		this.onChoose = onChoose;
		this.setPlaceholder('Pick a file to attach…');
	}

	getItems(): TFile[] {
		return this.app.vault.getFiles();
	}

	getItemText(file: TFile): string {
		return file.path;
	}

	onChooseItem(file: TFile): void {
		this.onChoose(file);
	}
}

export class InputArea {
	private containerEl: HTMLElement;
	private wrapEl: HTMLElement;
	private attachmentsEl: HTMLElement;
	private textareaEl: HTMLTextAreaElement;
	private sendBtn: HTMLButtonElement;
	private cancelBtn: HTMLButtonElement;
	private callbacks: InputAreaCallbacks;
	private app: App;
	private isStreaming = false;
	private attachments: Attachment[] = [];

	constructor(containerEl: HTMLElement, app: App, callbacks: InputAreaCallbacks) {
		this.containerEl = containerEl;
		this.app = app;
		this.callbacks = callbacks;
		this.build();
	}

	private build(): void {
		this.containerEl.empty();

		this.wrapEl = this.containerEl.createDiv('droidian-input-wrap');

		// Attachment preview row (hidden when empty)
		this.attachmentsEl = this.wrapEl.createDiv('droidian-input-attachments');
		this.attachmentsEl.hide();

		// Bottom row: attach button + textarea + action buttons
		const rowEl = this.wrapEl.createDiv('droidian-input-row');

		// Attach button (paperclip)
		const attachBtn = rowEl.createEl('button', {
			cls: 'droidian-input-action-btn droidian-input-attach-btn',
			attr: { 'aria-label': 'Attach file' },
		});
		attachBtn.innerHTML = attachIcon();
		attachBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			new FilePicker(this.app, (file) => this.addFileAttachment(file)).open();
		});

		this.textareaEl = rowEl.createEl('textarea', {
			cls: 'droidian-input-textarea',
			attr: { placeholder: 'How can I help you today?', rows: '1' },
		});

		this.textareaEl.addEventListener('input', () => {
			this.autoResize();
			this.updateSendState();
		});

		this.textareaEl.addEventListener('keydown', (e: KeyboardEvent) => {
			if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
				e.preventDefault();
				this.handleSend();
			}
		});

		this.textareaEl.addEventListener('paste', (e: ClipboardEvent) => {
			this.handlePaste(e);
		});

		this.textareaEl.addEventListener('dragover', (e: DragEvent) => {
			e.preventDefault();
			this.wrapEl.addClass('droidian-input-dragover');
		});

		this.textareaEl.addEventListener('dragleave', () => {
			this.wrapEl.removeClass('droidian-input-dragover');
		});

		this.textareaEl.addEventListener('drop', (e: DragEvent) => {
			e.preventDefault();
			this.wrapEl.removeClass('droidian-input-dragover');
			this.handleDrop(e);
		});

		// Stop button (shown during streaming)
		this.cancelBtn = rowEl.createEl('button', {
			cls: 'droidian-input-action-btn droidian-input-stop-btn',
			attr: { 'aria-label': 'Stop' },
		});
		this.cancelBtn.innerHTML = stopIcon();
		this.cancelBtn.addEventListener('click', () => this.callbacks.onCancel());
		this.cancelBtn.hide();

		// Send button
		this.sendBtn = rowEl.createEl('button', {
			cls: 'droidian-input-action-btn droidian-input-send-btn',
			attr: { 'aria-label': 'Send' },
		});
		this.sendBtn.innerHTML = sendIcon();
		this.sendBtn.addEventListener('click', () => this.handleSend());
		this.updateSendState();
	}

	// ── Attachment handling ───────────────────────────────────────────────────

	private async handlePaste(e: ClipboardEvent): Promise<void> {
		const items = e.clipboardData?.items;
		if (!items) return;

		for (const item of Array.from(items)) {
			if (item.type.startsWith('image/')) {
				e.preventDefault();
				const file = item.getAsFile();
				if (file) await this.addImageFile(file);
			}
		}
	}

	private async handleDrop(e: DragEvent): Promise<void> {
		const files = e.dataTransfer?.files;
		if (!files) return;

		for (const file of Array.from(files)) {
			if (file.type.startsWith('image/')) {
				await this.addImageFile(file);
			} else {
				// Try to find the vault file by name
				const vaultFile = this.app.vault.getFiles().find(f =>
					f.name === file.name || f.path === file.name
				);
				if (vaultFile) {
					this.addFileAttachment(vaultFile);
				}
			}
		}

		// Also handle Obsidian's internal drag data (file path in text)
		const text = e.dataTransfer?.getData('text/plain') ?? '';
		if (text) {
			const vaultFile = this.app.vault.getFileByPath(text)
				?? this.app.metadataCache.getFirstLinkpathDest(text, '');
			if (vaultFile) this.addFileAttachment(vaultFile);
		}
	}

	private async addImageFile(file: File): Promise<void> {
		const reader = new FileReader();
		reader.onload = () => {
			const dataUrl = reader.result as string;
			// dataUrl = "data:image/png;base64,XXXX"
			const comma = dataUrl.indexOf(',');
			const base64 = dataUrl.slice(comma + 1);
			const mimeType = file.type || 'image/png';
			const attachment: Attachment = {
				type: 'image',
				name: file.name || 'image',
				mimeType,
				base64,
			};
			this.attachments.push(attachment);
			this.renderAttachmentPreview(attachment);
			this.updateSendState();
		};
		reader.readAsDataURL(file);
	}

	private addFileAttachment(file: TFile): void {
		// Prevent duplicates
		if (this.attachments.some(a => a.vaultPath === file.path)) return;
		const attachment: Attachment = {
			type: 'file',
			name: file.name,
			vaultPath: file.path,
		};
		this.attachments.push(attachment);
		this.renderAttachmentPreview(attachment);
		this.updateSendState();
	}

	private renderAttachmentPreview(attachment: Attachment): void {
		this.attachmentsEl.show();

		const item = this.attachmentsEl.createDiv('droidian-attachment-item');

		if (attachment.type === 'image' && attachment.base64) {
			const img = item.createEl('img', { cls: 'droidian-attachment-thumb' });
			img.src = `data:${attachment.mimeType};base64,${attachment.base64}`;
			img.alt = attachment.name;
		} else {
			const label = item.createDiv('droidian-attachment-file');
			label.createSpan('droidian-attachment-file-icon').innerHTML = fileIcon();
			label.createSpan('droidian-attachment-file-name').setText(attachment.name);
		}

		const removeBtn = item.createEl('button', {
			cls: 'droidian-attachment-remove',
			attr: { 'aria-label': 'Remove' },
		});
		removeBtn.setText('×');
		removeBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			this.attachments = this.attachments.filter(a => a !== attachment);
			item.remove();
			if (this.attachmentsEl.childElementCount === 0) {
				this.attachmentsEl.hide();
			}
			this.updateSendState();
		});
	}

	// ── Send logic ────────────────────────────────────────────────────────────

	private handleSend(): void {
		if (this.isStreaming) return;
		const text = this.textareaEl.value.trim();
		if (!text && this.attachments.length === 0) return;

		const pendingAttachments = [...this.attachments];
		this.attachments = [];
		this.attachmentsEl.empty();
		this.attachmentsEl.hide();
		this.textareaEl.value = '';
		this.autoResize();
		this.updateSendState();
		this.callbacks.onSend(text, pendingAttachments);
	}

	private autoResize(): void {
		this.textareaEl.style.height = 'auto';
		this.textareaEl.style.height = `${Math.min(this.textareaEl.scrollHeight, 200)}px`;
	}

	private updateSendState(): void {
		const hasContent = this.textareaEl.value.trim().length > 0 || this.attachments.length > 0;
		this.sendBtn.toggleClass('has-content', hasContent);
		this.sendBtn.disabled = !hasContent;
	}

	setStreaming(streaming: boolean): void {
		this.isStreaming = streaming;
		this.textareaEl.disabled = streaming;
		if (streaming) {
			this.cancelBtn.show();
			this.sendBtn.hide();
		} else {
			this.cancelBtn.hide();
			this.sendBtn.show();
			this.updateSendState();
			this.textareaEl.focus();
		}
	}

	focus(): void {
		this.textareaEl.focus();
	}
}

// ── Icons ─────────────────────────────────────────────────────────────────────

function sendIcon(): string {
	return `<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
		<path d="M8 12V4M8 4L5 7M8 4L11 7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
	</svg>`;
}

function stopIcon(): string {
	return `<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
		<rect x="4.5" y="4.5" width="7" height="7" rx="1" fill="currentColor"/>
	</svg>`;
}

function attachIcon(): string {
	return `<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
		<path d="M13 7.5L7.5 13A4 4 0 0 1 2 7.5L7.5 2A2.5 2.5 0 0 1 11 5.5L5.5 11A1 1 0 0 1 4 9.5L9 4.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
	</svg>`;
}

function fileIcon(): string {
	return `<svg viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
		<path d="M3 1h5.5L11 3.5V13H3V1z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>
		<path d="M8.5 1v3H11" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>
	</svg>`;
}
