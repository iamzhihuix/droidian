import type { DroidSettings } from '../../core/types';
import { AVAILABLE_MODELS, AUTO_LEVEL_LABELS } from '../../core/constants';

export interface StatusBarCallbacks {
	onModelChange: (model: string) => void;
	onAutoLevelChange: (level: DroidSettings['autoLevel']) => void;
}

export class StatusBar {
	private containerEl: HTMLElement;
	private modelEl: HTMLElement;
	private autonomyEl: HTMLElement;
	private settings: DroidSettings;
	private callbacks: StatusBarCallbacks;
	private progressEl: HTMLElement;

	constructor(containerEl: HTMLElement, settings: DroidSettings, callbacks: StatusBarCallbacks) {
		this.containerEl = containerEl;
		this.settings = settings;
		this.callbacks = callbacks;
		this.build();
	}

	private build(): void {
		this.containerEl.empty();

		// Model selector
		this.modelEl = this.containerEl.createEl('button', { cls: 'droidian-statusbar-model' });
		this.updateModelLabel();
		this.modelEl.addEventListener('click', () => this.openModelMenu());

		// Autonomy level
		this.autonomyEl = this.containerEl.createEl('button', { cls: 'droidian-statusbar-effort' });
		this.updateAutonomyLabel();
		this.autonomyEl.addEventListener('click', () => this.openAutonomyMenu());

		// Progress placeholder
		this.progressEl = this.containerEl.createSpan({ cls: 'droidian-statusbar-progress' });
		this.progressEl.hide();
	}

	private updateModelLabel(): void {
		const m = AVAILABLE_MODELS.find(m => m.id === this.settings.model);
		this.modelEl.setText(m?.name ?? this.settings.model);
	}

	private updateAutonomyLabel(): void {
		const label = AUTO_LEVEL_LABELS[this.settings.autoLevel] ?? this.settings.autoLevel;
		this.autonomyEl.setText(`Autonomy: ${label}`);
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

	private openAutonomyMenu(): void {
		const levels: DroidSettings['autoLevel'][] = ['readonly', 'low', 'medium', 'high'];
		const menu = document.createElement('div');
		menu.className = 'droidian-dropdown-menu';

		for (const lvl of levels) {
			const item = menu.createDiv('droidian-dropdown-item');
			item.setText(AUTO_LEVEL_LABELS[lvl]);
			if (lvl === this.settings.autoLevel) item.addClass('is-selected');
			item.addEventListener('click', () => {
				this.settings.autoLevel = lvl;
				this.updateAutonomyLabel();
				this.callbacks.onAutoLevelChange(lvl);
				menu.remove();
			});
		}

		this.positionMenu(menu, this.autonomyEl);
		document.body.appendChild(menu);
		setTimeout(() => document.addEventListener('click', () => menu.remove(), { once: true }), 0);
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
		this.build();
	}

	private positionMenu(menu: HTMLElement, anchor: HTMLElement): void {
		const rect = anchor.getBoundingClientRect();
		menu.style.position = 'fixed';
		menu.style.bottom = `${window.innerHeight - rect.top + 4}px`;
		menu.style.left = `${rect.left}px`;
	}
}
