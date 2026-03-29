import type { Session } from '../../core/types';

export interface TabManagerCallbacks {
	onTabSwitch: (session: Session) => void;
	onTabNew: () => void;
	onTabClose: (sessionId: string) => void;
}

export class TabManager {
	private containerEl: HTMLElement;
	private sessions: Session[];
	private activeId: string | null = null;
	private callbacks: TabManagerCallbacks;

	constructor(containerEl: HTMLElement, sessions: Session[], callbacks: TabManagerCallbacks) {
		this.containerEl = containerEl;
		this.sessions = sessions;
		this.callbacks = callbacks;
	}

	render(): void {
		this.containerEl.empty();

		const tabsEl = this.containerEl.createDiv('droidian-tabs');

		// Session tabs
		for (const session of this.sessions) {
			const tab = tabsEl.createDiv({
				cls: ['droidian-tab', session.id === this.activeId ? 'is-active' : ''],
			});
			const label = tab.createSpan('droidian-tab-label');
			label.setText(this.shortTitle(session.title));
			label.addEventListener('click', () => {
				this.setActive(session.id);
				this.callbacks.onTabSwitch(session);
			});

			// Only show close on hover if more than 1 tab
			if (this.sessions.length > 1) {
				const closeBtn = tab.createSpan('droidian-tab-close');
				closeBtn.setText('×');
				closeBtn.addEventListener('click', (e) => {
					e.stopPropagation();
					this.callbacks.onTabClose(session.id);
				});
			}
		}

		// Action buttons
		const actions = this.containerEl.createDiv('droidian-tab-actions');

		const newBtn = actions.createEl('button', { cls: 'droidian-tab-btn', attr: { title: 'New tab' } });
		newBtn.innerHTML = plusSvg();
		newBtn.addEventListener('click', () => this.callbacks.onTabNew());

		const historyBtn = actions.createEl('button', { cls: 'droidian-tab-btn', attr: { title: 'Session history' } });
		historyBtn.innerHTML = clockSvg();
		historyBtn.addEventListener('click', () => {
			// History dropdown - shows all sessions
			this.showHistoryMenu(historyBtn);
		});
	}

	setActive(id: string): void {
		this.activeId = id;
		this.render();
	}

	setSessions(sessions: Session[]): void {
		this.sessions = sessions;
		this.render();
	}

	addSession(session: Session): void {
		// session is already in the shared array pushed by DroidianView
		this.activeId = session.id;
		this.render();
	}

	removeSession(id: string): void {
		this.sessions = this.sessions.filter(s => s.id !== id);
		if (this.activeId === id) {
			this.activeId = this.sessions[this.sessions.length - 1]?.id ?? null;
		}
		this.render();
	}

	updateSessionTitle(id: string, title: string): void {
		const session = this.sessions.find(s => s.id === id);
		if (session) {
			session.title = title;
			this.render();
		}
	}

	get activeSessionId(): string | null {
		return this.activeId;
	}

	private shortTitle(title: string): string {
		return title.length > 16 ? title.slice(0, 16) + '…' : title;
	}

	private showHistoryMenu(anchor: HTMLElement): void {
		const existing = document.querySelector('.droidian-history-menu');
		existing?.remove();

		if (this.sessions.length === 0) return;

		const menu = document.createElement('div');
		menu.className = 'droidian-dropdown-menu droidian-history-menu';

		for (const session of [...this.sessions].reverse()) {
			const item = menu.createDiv('droidian-dropdown-item');
			item.setText(session.title);
			if (session.id === this.activeId) item.addClass('is-selected');
			item.addEventListener('click', () => {
				this.setActive(session.id);
				this.callbacks.onTabSwitch(session);
				menu.remove();
			});
		}

		const rect = anchor.getBoundingClientRect();
		menu.style.position = 'fixed';
		menu.style.top = `${rect.bottom + 4}px`;
		menu.style.right = `${window.innerWidth - rect.right}px`;
		document.body.appendChild(menu);
		setTimeout(() => document.addEventListener('click', () => menu.remove(), { once: true }), 0);
	}
}

function plusSvg(): string {
	return `<svg viewBox="0 0 16 16" fill="none"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;
}

function clockSvg(): string {
	return `<svg viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.5"/><path d="M8 5v3.5L10 10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;
}
