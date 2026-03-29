import { Plugin, Platform, WorkspaceLeaf } from 'obsidian';
import { patchElectronCompat } from './utils/electronCompat';
import type { DroidSettings, Session } from './core/types';
import { VIEW_TYPE_DROIDIAN, DEFAULT_SETTINGS } from './core/constants';
import { DroidianView } from './features/chat/DroidianView';
import { DroidianSettingsTab } from './features/settings/SettingsTab';

patchElectronCompat();

// Injected at build time by esbuild.config.mjs
declare const RELAY_SERVER_B64: string;

interface DroidianData {
	settings: DroidSettings;
	sessions: Session[];
}

export default class DroidianPlugin extends Plugin {
	settings: DroidSettings;
	private sessions: Session[] = [];
	private relayProcess: import('child_process').ChildProcess | null = null;
	private relayAddresses: string[] = [];

	async onload(): Promise<void> {
		await this.loadData_();

		this.registerView(VIEW_TYPE_DROIDIAN, (leaf) => new DroidianView(leaf, this));

		this.addRibbonIcon('bot', 'Open Factory Droid', () => {
			this.activateView();
		});

		this.addCommand({
			id: 'open-droid-chat',
			name: 'Open Droid chat',
			callback: () => this.activateView(),
		});

		this.addCommand({
			id: 'new-droid-session',
			name: 'New Droid session',
			callback: () => {
				const view = this.getView();
				if (view) {
					view.openNewTab();
				} else {
					this.activateView();
				}
			},
		});

		this.addSettingTab(new DroidianSettingsTab(this.app, this));

		if (Platform.isDesktop && this.settings.serverEnabled) {
			this.startRelayServer().catch(err => console.error('[Droidian] relay server start error:', err));
		}
	}

	async onunload(): Promise<void> {
		this.stopRelayServer();
		this.app.workspace.detachLeavesOfType(VIEW_TYPE_DROIDIAN);
	}

	// ── Relay server management ───────────────────────────────────────────────

	async startRelayServer(): Promise<void> {
		if (!Platform.isDesktop) return;
		this.stopRelayServer();

		try {
			// eslint-disable-next-line @typescript-eslint/no-require-imports
			const { spawn, execSync } = require('child_process') as typeof import('child_process');
			// eslint-disable-next-line @typescript-eslint/no-require-imports
			const { writeFileSync } = require('fs') as typeof import('fs');
			// eslint-disable-next-line @typescript-eslint/no-require-imports
			const { tmpdir, networkInterfaces } = require('os') as typeof import('os');
			// eslint-disable-next-line @typescript-eslint/no-require-imports
			const path = require('path') as typeof import('path');

			// Kill any existing process on this port
			try {
				execSync(`lsof -ti:${this.settings.serverPort} | xargs kill -9 2>/dev/null`, { encoding: 'utf8' });
				await new Promise(r => setTimeout(r, 100));
			} catch {}

			// Extract relay server script
			const scriptPath = path.join(tmpdir(), 'droidian_relay_server.js');
			const script = Buffer.from(RELAY_SERVER_B64, 'base64').toString('utf-8');
			writeFileSync(scriptPath, script, { mode: 0o755 });

			// Get shell PATH
			let shellEnv = { ...process.env };
			try {
				const shell = process.env.SHELL || '/bin/zsh';
				const out = execSync(`${shell} -lic 'echo "__PATH__"; echo "$PATH"'`, { encoding: 'utf8', timeout: 2000 });
				const p = out.split('__PATH__\n')[1]?.trim().split('\n')[0];
				if (p) shellEnv = { ...shellEnv, PATH: p };
			} catch {}

			const args = [
				scriptPath,
				'--port', String(this.settings.serverPort),
				'--vault-path', this.getVaultPath() ?? '',
				'--cli-path', this.settings.droidCliPath || '',
			];
			if (this.settings.serverToken) {
				args.push('--token', this.settings.serverToken);
			}

			// Find node executable
			let nodeExec = 'node';
			const nodePaths = ['/usr/local/bin/node', '/opt/homebrew/bin/node', '/usr/bin/node'];
			for (const p of nodePaths) {
				try {
					// eslint-disable-next-line @typescript-eslint/no-require-imports
					(require('fs') as typeof import('fs')).statSync(p);
					nodeExec = p; break;
				} catch {}
			}
			try {
				nodeExec = execSync('which node', { encoding: 'utf8', env: shellEnv as NodeJS.ProcessEnv }).trim() || nodeExec;
			} catch {}

			this.relayProcess = spawn(nodeExec, args, {
				detached: false,
				stdio: ['pipe', 'pipe', 'pipe'],
				env: shellEnv as NodeJS.ProcessEnv,
			});

			this.relayProcess.stderr?.on('data', (d: Buffer) => {
				console.log('[Droidian relay]', d.toString());
			});
			this.relayProcess.stdout?.on('data', (d: Buffer) => {
				console.log('[Droidian relay]', d.toString());
			});
			this.relayProcess.on('exit', (code: number | null) => {
				console.log('[Droidian relay] exited code=' + code);
				this.relayProcess = null;
			});
			this.relayProcess.on('error', (err: Error) => {
				console.error('[Droidian relay] error:', err.message);
			});

			// Collect LAN addresses
			const ifaces = networkInterfaces();
			this.relayAddresses = [];
			for (const list of Object.values(ifaces)) {
				for (const a of list ?? []) {
					if (a.family === 'IPv4' && !a.internal) this.relayAddresses.push(a.address);
				}
			}

			await new Promise(r => setTimeout(r, 300));
			console.log('[Droidian] relay server started on port', this.settings.serverPort);
		} catch (err) {
			console.error('[Droidian] failed to start relay server:', err);
		}
	}

	stopRelayServer(): void {
		if (this.relayProcess) {
			this.relayProcess.kill('SIGTERM');
			this.relayProcess = null;
		}
		this.relayAddresses = [];
	}

	isRelayServerRunning(): boolean {
		return this.relayProcess !== null && !this.relayProcess.killed;
	}

	getRelayServerAddresses(): string[] {
		return this.relayAddresses;
	}

	private getVaultPath(): string | null {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		return (this.app.vault.adapter as any).basePath ?? null;
	}

	async activateView(): Promise<void> {
		const { workspace } = this.app;
		let leaf: WorkspaceLeaf | null = workspace.getLeavesOfType(VIEW_TYPE_DROIDIAN)[0] ?? null;

		if (!leaf) {
			leaf = this.settings.openInMainTab
				? workspace.getLeaf('tab')
				: workspace.getRightLeaf(false);

			if (leaf) {
				await leaf.setViewState({ type: VIEW_TYPE_DROIDIAN, active: true });
			}
		}

		if (leaf) {
			workspace.revealLeaf(leaf);
		}
	}

	getView(): DroidianView | null {
		const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_DROIDIAN);
		return leaves.length > 0 ? (leaves[0].view as DroidianView) : null;
	}

	getSessions(): Session[] {
		return this.sessions;
	}

	async saveSessions(sessions: Session[]): Promise<void> {
		this.sessions = sessions;
		await this.saveData_();
	}

	async saveSettings(): Promise<void> {
		await this.saveData_();
	}

	private async loadData_(): Promise<void> {
		const data = (await this.loadData()) as DroidianData | null;
		this.settings = { ...DEFAULT_SETTINGS, ...(data?.settings ?? {}) };
		this.sessions = data?.sessions ?? [];
	}

	private async saveData_(): Promise<void> {
		const data: DroidianData = {
			settings: this.settings,
			sessions: this.sessions.map(s => ({
				...s,
				// Persist messages but cap to last 200 to avoid bloat
				messages: s.messages.slice(-200),
			})),
		};
		await this.saveData(data);
	}
}
