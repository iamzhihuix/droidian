import { App, FuzzySuggestModal, TFile } from 'obsidian';
import type { Attachment } from '../../core/types';

export interface InputAreaCallbacks {
	onSend: (text: string, attachments: Attachment[]) => void;
	onCancel: () => void;
}

/** Modal for picking a vault file to attach via paperclip button */
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

// ── @ Mention popup ───────────────────────────────────────────────────────────

interface MentionCandidate {
	kind: 'file' | 'folder';
	path: string;
	name: string;
	score: number;
}

/** Simple fuzzy scorer: higher = better match. */
function fuzzyScore(query: string, path: string): number {
	const q = query.toLowerCase();
	const p = path.toLowerCase();
	const name = p.split('/').pop() ?? p;

	if (name === q) return 100;
	if (name.startsWith(q)) return 80;
	if (name.includes(q)) return 60;
	if (p.includes(q)) return 40;

	// Character sequence match
	let qi = 0;
	for (let i = 0; i < p.length && qi < q.length; i++) {
		if (p[i] === q[qi]) qi++;
	}
	return qi === q.length ? 20 : 0;
}

function getMentionCandidates(app: App, query: string): MentionCandidate[] {
	const results: MentionCandidate[] = [];
	const q = query.toLowerCase();

	// Files
	for (const file of app.vault.getFiles()) {
		const score = fuzzyScore(q, file.path);
		if (score > 0 || q === '') {
			results.push({ kind: 'file', path: file.path, name: file.name, score: q === '' ? 50 : score });
		}
	}

	// Folders
	const seen = new Set<string>();
	for (const file of app.vault.getFiles()) {
		const parts = file.path.split('/');
		for (let i = 1; i < parts.length; i++) {
			const folderPath = parts.slice(0, i).join('/');
			if (seen.has(folderPath)) continue;
			seen.add(folderPath);
			const folderName = parts[i - 1];
			const score = fuzzyScore(q, folderPath);
			if (score > 0 || q === '') {
				results.push({ kind: 'folder', path: folderPath, name: folderName, score: q === '' ? 45 : score });
			}
		}
	}

	return results.sort((a, b) => b.score - a.score).slice(0, 8);
}

// ── InputArea ─────────────────────────────────────────────────────────────────

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

	// @ mention popup state
	private mentionPopup: HTMLElement | null = null;
	private mentionQuery = '';
	private mentionStart = -1;
	private mentionActiveIdx = 0;
	private mentionCandidates: MentionCandidate[] = [];

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
			attr: { placeholder: 'How can I help you today?  ( @ to attach a file or folder )', rows: '1' },
		});

		this.textareaEl.addEventListener('input', () => {
			this.autoResize();
			this.updateSendState();
			this.handleMentionInput();
		});

		this.textareaEl.addEventListener('keydown', (e: KeyboardEvent) => {
			if (this.mentionPopup) {
				if (e.key === 'ArrowDown') { e.preventDefault(); this.moveMention(1); return; }
				if (e.key === 'ArrowUp')   { e.preventDefault(); this.moveMention(-1); return; }
				if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); this.selectMention(); return; }
				if (e.key === 'Escape')    { e.preventDefault(); this.closeMention(); return; }
			}
			if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
				e.preventDefault();
				this.handleSend();
			}
		});

		this.textareaEl.addEventListener('blur', () => {
			// Delay so click on popup item fires first
			setTimeout(() => this.closeMention(), 150);
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

		// Stop button
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

	// ── @ Mention logic ───────────────────────────────────────────────────────

	private handleMentionInput(): void {
		const val = this.textareaEl.value;
		const cursor = this.textareaEl.selectionStart ?? val.length;
		const textBefore = val.slice(0, cursor);

		// Find the last '@' that isn't preceded by a word char (to avoid email addresses)
		const atMatch = textBefore.match(/(?:^|[\s\n])@([^\s@]*)$/);
		if (atMatch) {
			const query = atMatch[1];
			// Position of the '@' in the full string
			const atPos = cursor - query.length - 1;
			this.mentionStart = atPos;
			this.mentionQuery = query;
			this.mentionCandidates = getMentionCandidates(this.app, query);
			this.mentionActiveIdx = 0;
			this.renderMentionPopup();
		} else {
			this.closeMention();
		}
	}

	private renderMentionPopup(): void {
		this.closeMentionPopupEl();
		if (this.mentionCandidates.length === 0) return;

		const popup = document.createElement('div');
		popup.className = 'droidian-mention-popup';

		for (let i = 0; i < this.mentionCandidates.length; i++) {
			const c = this.mentionCandidates[i];
			const item = popup.createDiv('droidian-mention-item');
			if (i === this.mentionActiveIdx) item.addClass('is-active');

			item.createSpan('droidian-mention-icon').innerHTML = c.kind === 'folder' ? folderIcon() : fileIcon();
			const textEl = item.createDiv('droidian-mention-text');
			textEl.createSpan('droidian-mention-name').setText(c.name);
			const dir = c.path.includes('/') ? c.path.slice(0, c.path.lastIndexOf('/')) : '';
			if (dir) textEl.createSpan('droidian-mention-dir').setText(dir);

			const idx = i;
			item.addEventListener('mousedown', (e) => {
				e.preventDefault();
				this.mentionActiveIdx = idx;
				this.selectMention();
			});
		}

		// Position popup above the input wrap
		this.wrapEl.style.position = 'relative';
		this.wrapEl.appendChild(popup);
		this.mentionPopup = popup;

		// Position: above the wrap
		const popupH = Math.min(this.mentionCandidates.length, 8) * 40 + 8;
		popup.style.bottom = `${this.wrapEl.offsetHeight + 4}px`;
	}

	private moveMention(delta: number): void {
		if (!this.mentionCandidates.length) return;
		this.mentionActiveIdx = (this.mentionActiveIdx + delta + this.mentionCandidates.length) % this.mentionCandidates.length;
		this.updateMentionHighlight();
	}

	private updateMentionHighlight(): void {
		if (!this.mentionPopup) return;
		const items = this.mentionPopup.querySelectorAll('.droidian-mention-item');
		items.forEach((el, i) => el.toggleClass('is-active', i === this.mentionActiveIdx));
		(items[this.mentionActiveIdx] as HTMLElement)?.scrollIntoView({ block: 'nearest' });
	}

	private selectMention(): void {
		const c = this.mentionCandidates[this.mentionActiveIdx];
		if (!c) { this.closeMention(); return; }

		// Remove '@query' from textarea
		const val = this.textareaEl.value;
		const cursor = this.textareaEl.selectionStart ?? val.length;
		const before = val.slice(0, this.mentionStart);
		const after = val.slice(cursor);
		// Insert a space after so typing continues naturally
		this.textareaEl.value = before + after;
		const newCursor = before.length;
		this.textareaEl.setSelectionRange(newCursor, newCursor);

		// Add attachment
		if (c.kind === 'folder') {
			this.addFolderAttachment(c.path, c.name);
		} else {
			const file = this.app.vault.getFileByPath(c.path);
			if (file) this.addFileAttachment(file);
		}

		this.closeMention();
		this.autoResize();
		this.updateSendState();
		this.textareaEl.focus();
	}

	private closeMention(): void {
		this.closeMentionPopupEl();
		this.mentionQuery = '';
		this.mentionStart = -1;
		this.mentionCandidates = [];
	}

	private closeMentionPopupEl(): void {
		if (this.mentionPopup) {
			this.mentionPopup.remove();
			this.mentionPopup = null;
		}
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
		if (files) {
			for (const file of Array.from(files)) {
				if (file.type.startsWith('image/')) {
					await this.addImageFile(file);
				} else {
					const vaultFile = this.app.vault.getFiles().find(f => f.name === file.name || f.path === file.name);
					if (vaultFile) this.addFileAttachment(vaultFile);
				}
			}
		}
		const text = e.dataTransfer?.getData('text/plain') ?? '';
		if (text) {
			const vaultFile = this.app.vault.getFileByPath(text) ?? this.app.metadataCache.getFirstLinkpathDest(text, '');
			if (vaultFile) this.addFileAttachment(vaultFile);
		}
	}

	private async addImageFile(file: File): Promise<void> {
		const reader = new FileReader();
		reader.onload = () => {
			const dataUrl = reader.result as string;
			const comma = dataUrl.indexOf(',');
			const base64 = dataUrl.slice(comma + 1);
			const attachment: Attachment = {
				type: 'image',
				name: file.name || 'image',
				mimeType: file.type || 'image/png',
				base64,
			};
			this.attachments.push(attachment);
			this.renderAttachmentPreview(attachment);
			this.updateSendState();
		};
		reader.readAsDataURL(file);
	}

	private addFileAttachment(file: TFile): void {
		if (this.attachments.some(a => a.vaultPath === file.path)) return;
		const attachment: Attachment = { type: 'file', name: file.name, vaultPath: file.path };
		this.attachments.push(attachment);
		this.renderAttachmentPreview(attachment);
		this.updateSendState();
	}

	private addFolderAttachment(path: string, name: string): void {
		if (this.attachments.some(a => a.vaultPath === path)) return;
		const attachment: Attachment = { type: 'folder', name: name || path, vaultPath: path };
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
			const icon = label.createSpan('droidian-attachment-file-icon');
			icon.innerHTML = attachment.type === 'folder' ? folderIcon() : fileIcon();
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
			if (this.attachmentsEl.childElementCount === 0) this.attachmentsEl.hide();
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

	setPrefilledText(text: string): void {
		this.textareaEl.value = text;
		this.autoResize();
		this.updateSendState();
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

function folderIcon(): string {
	return `<svg viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
		<path d="M1 3.5C1 2.67 1.67 2 2.5 2H5l1.5 1.5H11.5C12.33 3.5 13 4.17 13 5v6c0 .83-.67 1.5-1.5 1.5h-9C1.67 12.5 1 11.83 1 11V3.5z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>
	</svg>`;
}
