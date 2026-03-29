import type { App } from 'obsidian';
import type { ToolCallInfo } from '../../core/types';
import { TOOL_DISPLAY_NAMES } from '../../core/constants';
import { openFileInNewTab, resolveVaultPath, linkifyFilePaths } from '../../utils/fileLink';

// Tools whose first param is a file path worth making clickable
const FILE_PATH_TOOLS = new Set(['read', 'edit', 'write', 'create', 'multiedit']);

export class ToolCallRenderer {
	private containerEl: HTMLElement;
	private toolCalls = new Map<string, HTMLElement>();
	private app: App;

	constructor(containerEl: HTMLElement, app: App) {
		this.containerEl = containerEl;
		this.app = app;
	}

	addToolCall(info: ToolCallInfo): void {
		const el = this.containerEl.createDiv('droidian-tool-call');
		this.toolCalls.set(info.id, el);
		this.render(el, info);
	}

	updateToolCall(info: ToolCallInfo): void {
		const el = this.toolCalls.get(info.id);
		if (!el) return;
		this.render(el, info);
	}

	private render(el: HTMLElement, info: ToolCallInfo): void {
		el.empty();

		const displayName = TOOL_DISPLAY_NAMES[info.toolName] ?? info.toolName;
		const paramSummary = this.buildParamSummary(info.toolName, info.parameters);
		const isExpanded = el.hasClass('expanded');

		const header = el.createDiv('droidian-tool-call-header');

		// Status icon
		const iconEl = header.createSpan('droidian-tool-call-icon');
		if (info.status === 'running') {
			iconEl.addClass('is-spinning');
			iconEl.innerHTML = spinnerSvg();
		} else if (info.status === 'success') {
			iconEl.innerHTML = checkSvg();
			iconEl.addClass('is-success');
		} else {
			iconEl.innerHTML = errorSvg();
			iconEl.addClass('is-error');
		}

		// Tool label
		const labelEl = header.createSpan('droidian-tool-call-label');
		labelEl.setText(`${displayName}  `);
		const paramEl = labelEl.createSpan('droidian-tool-call-param');

		// Make param clickable if it's a file path that exists in the vault
		const isFileTool = FILE_PATH_TOOLS.has(info.toolName.toLowerCase());
		const rawFilePath = isFileTool
			? String(info.parameters['file_path'] ?? info.parameters['path'] ?? '')
			: '';
		const vaultPath = rawFilePath ? resolveVaultPath(rawFilePath, this.app) : null;

		if (vaultPath) {
			paramEl.addClass('droidian-file-link');
			paramEl.setText(paramSummary);
			paramEl.addEventListener('click', (e) => {
				e.stopPropagation();
				openFileInNewTab(this.app, vaultPath);
			});
		} else {
			paramEl.setText(paramSummary);
		}

		// Duration
		if (info.completedAt && info.startedAt) {
			const dur = Math.round((info.completedAt - info.startedAt) / 1000);
			if (dur > 0) {
				const durEl = header.createSpan('droidian-tool-call-duration');
				durEl.setText(`${dur}s`);
			}
		}

		// Toggle expand/collapse
		header.addEventListener('click', () => {
			el.toggleClass('expanded', !el.hasClass('expanded'));
		});

		// Expanded content
		if (isExpanded || info.status !== 'success') {
			el.addClass('expanded');
		}

		if (info.result) {
			const body = el.createDiv('droidian-tool-call-body');
			const pre = body.createEl('pre');
			const code = pre.createEl('code');
			code.setText(this.truncate(info.result, 2000));
			// Linkify any file paths that appear in the result text
			linkifyFilePaths(code, this.app);
		}
	}

	private buildParamSummary(toolName: string, params: Record<string, unknown>): string {
		const tool = toolName.toLowerCase();
		if (tool === 'execute' || tool === 'bash') {
			return String(params.command ?? '').split('\n')[0].slice(0, 80);
		}
		if (tool === 'read') {
			return String(params.file_path ?? params.path ?? '');
		}
		if (tool === 'edit' || tool === 'write') {
			return String(params.file_path ?? params.path ?? '');
		}
		if (tool === 'grep') {
			return `"${String(params.pattern ?? '')}"`;
		}
		if (tool === 'glob') {
			return String(params.patterns ?? params.pattern ?? '');
		}
		const firstVal = Object.values(params)[0];
		return firstVal !== undefined ? String(firstVal).slice(0, 60) : '';
	}

	private truncate(text: string, maxLen: number): string {
		if (text.length <= maxLen) return text;
		return text.slice(0, maxLen) + '\n... (truncated)';
	}
}

function spinnerSvg(): string {
	return `<svg class="droidian-spinner" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
		<circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-dasharray="14 42"/>
	</svg>`;
}

function checkSvg(): string {
	return `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
		<path d="M5 13l4 4L19 7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
	</svg>`;
}

function errorSvg(): string {
	return `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
		<path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
	</svg>`;
}
