import type { DroidSettings } from '../../core/types';
import { AVAILABLE_MODELS, AUTO_LEVEL_LABELS } from '../../core/constants';

export interface StatusBarCallbacks {
	onModelChange: (model: string) => void;
	onAutoLevelChange: (level: DroidSettings['autoLevel']) => void;
}

export class StatusBar {
	private containerEl: HTMLElement;
	private modelEl: HTMLElement;
	private effortEl: HTMLElement;
	private autoToggleEl: HTMLElement;
	private settings: DroidSettings;
	private callbacks: StatusBarCallbacks;
	private progressEl: HTMLElement;
	private isAutoRun = false;

	constructor(containerEl: HTMLElement, settings: DroidSettings, callbacks: StatusBarCallbacks) {
		this.containerEl = containerEl;
		this.settings = settings;
		this.callbacks = callbacks;
		this.isAutoRun = settings.autoLevel !== 'readonly';
		this.build();
	}

	private build(): void {
		this.containerEl.empty();

		// Model selector
		this.modelEl = this.containerEl.createEl('button', { cls: 'droidian-statusbar-model' });
		this.updateModelLabel();
		this.modelEl.addEventListener('click', () => this.openModelMenu());

		// Effort / auto level
		this.effortEl = this.containerEl.createEl('button', { cls: 'droidian-statusbar-effort' });
		this.updateEffortLabel();
		this.effortEl.addEventListener('click', () => this.openAutoMenu());

		// Progress placeholder
		this.progressEl = this.containerEl.createSpan({ cls: 'droidian-statusbar-progress' });
		this.progressEl.hide();

		// Spacer
		this.containerEl.createSpan({ cls: 'droidian-statusbar-spacer' });

		// YOLO toggle
		const toggleWrap = this.containerEl.createDiv('droidian-statusbar-toggle-wrap');
		toggleWrap.createSpan().setText('YOLO');
		this.autoToggleEl = toggleWrap.createDiv('droidian-toggle');
		this.autoToggleEl.toggleClass('is-active', this.isAutoRun);
		this.autoToggleEl.addEventListener('click', () => this.handleToggle());
	}

	private updateModelLabel(): void {
		const m = AVAILABLE_MODELS.find(m => m.id === this.settings.model);
		this.modelEl.setText(m?.name ?? this.settings.model);
	}

	private updateEffortLabel(): void {
		const label = AUTO_LEVEL_LABELS[this.settings.autoLevel] ?? this.settings.autoLevel;
		this.effortEl.setText(`Effort: ${label}`);
	}

	private openModelMenu(): void {
		const menu = document.createElement('div');
		menu.className = 'droidian-dropdown-menu';

		for (const m of AVAILABLE_MODELS) {
			const item = menu.createDiv('droidian-dropdown-item');
			item.setText(m.name);
			if (m.id === this.settings.model) item.addClass('is-selected');
			item.addEventListener('click', () => {
				this.settings.model = m.id;
				this.updateModelLabel();
				this.callbacks.onModelChange(m.id);
				menu.remove();
			});
		}

		this.positionMenu(menu, this.modelEl);
		document.body.appendChild(menu);
		setTimeout(() => document.addEventListener('click', () => menu.remove(), { once: true }), 0);
	}

	private openAutoMenu(): void {
		const levels: DroidSettings['autoLevel'][] = ['readonly', 'low', 'medium', 'high'];
		const menu = document.createElement('div');
		menu.className = 'droidian-dropdown-menu';

		for (const lvl of levels) {
			const item = menu.createDiv('droidian-dropdown-item');
			item.setText(AUTO_LEVEL_LABELS[lvl]);
			if (lvl === this.settings.autoLevel) item.addClass('is-selected');
			item.addEventListener('click', () => {
				this.settings.autoLevel = lvl;
				this.isAutoRun = lvl !== 'readonly';
				this.autoToggleEl.toggleClass('is-active', this.isAutoRun);
				this.updateEffortLabel();
				this.callbacks.onAutoLevelChange(lvl);
				menu.remove();
			});
		}

		this.positionMenu(menu, this.effortEl);
		document.body.appendChild(menu);
		setTimeout(() => document.addEventListener('click', () => menu.remove(), { once: true }), 0);
	}

	private handleToggle(): void {
		this.isAutoRun = !this.isAutoRun;
		this.autoToggleEl.toggleClass('is-active', this.isAutoRun);
		const newLevel: DroidSettings['autoLevel'] = this.isAutoRun ? 'low' : 'readonly';
		this.settings.autoLevel = newLevel;
		this.updateEffortLabel();
		this.callbacks.onAutoLevelChange(newLevel);
	}

	showProgress(pct: number): void {
		this.progressEl.show();
		this.progressEl.setText(`${pct}%`);
	}

	hideProgress(): void {
		this.progressEl.hide();
	}

	updateSettings(settings: DroidSettings): void {
		this.settings = settings;
		this.isAutoRun = settings.autoLevel !== 'readonly';
		this.build();
	}

	private positionMenu(menu: HTMLElement, anchor: HTMLElement): void {
		const rect = anchor.getBoundingClientRect();
		menu.style.position = 'fixed';
		menu.style.bottom = `${window.innerHeight - rect.top + 4}px`;
		menu.style.left = `${rect.left}px`;
	}
}
