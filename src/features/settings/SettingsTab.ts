import { App, Platform, PluginSettingTab, Setting, Notice } from 'obsidian';
import type DroidianPlugin from '../../main';
import { AVAILABLE_MODELS, AUTO_LEVEL_LABELS } from '../../core/constants';
import { resolveDroidCli } from '../../utils/droidCli';

function isLoggedIn(): boolean {
	try {
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const { existsSync } = require('fs') as typeof import('fs');
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const { homedir } = require('os') as typeof import('os');
		const home = homedir();
		const paths = [
			`${home}/.factory/auth.json`,
			`${home}/.factory/credentials.json`,
			`${home}/.factory/config.json`,
		];
		return paths.some(p => existsSync(p));
	} catch {
		return false;
	}
}

export class DroidianSettingsTab extends PluginSettingTab {
	plugin: DroidianPlugin;

	constructor(app: App, plugin: DroidianPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.createEl('h2', { text: 'Factory Droid Settings' });

		// ── Desktop-only: local CLI settings ──────────────────────────────────
		if (Platform.isDesktop) {
			// CLI Path
			new Setting(containerEl)
				.setName('Droid CLI path')
				.setDesc('Path to the droid executable. Leave blank for auto-detection.')
				.addText(text =>
					text
						.setPlaceholder('/usr/local/bin/droid')
						.setValue(this.plugin.settings.droidCliPath)
						.onChange(async (value) => {
							this.plugin.settings.droidCliPath = value;
							await this.plugin.saveSettings();
						})
				)
				.addButton(btn =>
					btn
						.setButtonText('Detect')
						.onClick(() => {
							const found = resolveDroidCli(
								this.plugin.settings.droidCliPath,
								this.plugin.settings.environmentVariables
							);
							if (found) {
								new Notice(`Found: ${found}`);
							} else {
								new Notice('Droid CLI not found. Please install it or set the path manually.');
							}
						})
				);

			// Environment variables
			new Setting(containerEl)
				.setName('Environment variables')
				.setDesc('Extra environment variables passed to Droid (KEY=VALUE, one per line).')
				.addTextArea(text => {
					text
						.setPlaceholder('ANTHROPIC_API_KEY=sk-...\nHTTPS_PROXY=http://...')
						.setValue(this.plugin.settings.environmentVariables)
						.onChange(async (value) => {
							this.plugin.settings.environmentVariables = value;
							await this.plugin.saveSettings();
						});
					text.inputEl.rows = 4;
					text.inputEl.addClass('droidian-env-textarea');
				});
		}

		// ── Model + autonomy (all platforms) ──────────────────────────────────
		new Setting(containerEl)
			.setName('Default model')
			.setDesc('AI model to use for conversations.')
			.addDropdown(drop => {
				for (const m of AVAILABLE_MODELS) {
					drop.addOption(m.id, m.name);
				}
				drop.setValue(this.plugin.settings.model);
				drop.onChange(async (value) => {
					this.plugin.settings.model = value;
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName('Autonomy level')
			.setDesc('Controls what operations Droid is allowed to perform.')
			.addDropdown(drop => {
				for (const [id, label] of Object.entries(AUTO_LEVEL_LABELS)) {
					drop.addOption(id, label);
				}
				drop.setValue(this.plugin.settings.autoLevel);
				drop.onChange(async (value) => {
					this.plugin.settings.autoLevel = value as DroidianPlugin['settings']['autoLevel'];
					await this.plugin.saveSettings();
				});
			});

		// ── Desktop: Relay Server ─────────────────────────────────────────────
		if (Platform.isDesktop) {
			containerEl.createEl('h3', { text: 'Relay Server (Mobile Access)' });

			const isRunning = this.plugin.isRelayServerRunning();

			new Setting(containerEl)
				.setName('Enable relay server')
				.setDesc('Start a local WebSocket relay so mobile devices can connect to Droid on this Mac.')
				.addToggle(toggle =>
					toggle
						.setValue(this.plugin.settings.serverEnabled)
						.onChange(async (value) => {
							this.plugin.settings.serverEnabled = value;
							await this.plugin.saveSettings();
							if (value) {
								await this.plugin.startRelayServer();
							} else {
								this.plugin.stopRelayServer();
							}
							this.display();
						})
				);

			if (this.plugin.settings.serverEnabled) {
				new Setting(containerEl)
					.setName('Port')
					.setDesc('Port the relay server listens on.')
					.addText(text =>
						text
							.setPlaceholder('8766')
							.setValue(String(this.plugin.settings.serverPort))
							.onChange(async (value) => {
								const port = parseInt(value, 10);
								if (!isNaN(port) && port > 0 && port < 65536) {
									this.plugin.settings.serverPort = port;
									await this.plugin.saveSettings();
								}
							})
					);

				new Setting(containerEl)
					.setName('Auth token')
					.setDesc('Optional secret appended to the URL (?token=...) to prevent unauthorized access when using tunneling.')
					.addText(text =>
						text
							.setPlaceholder('leave blank for no auth')
							.setValue(this.plugin.settings.serverToken)
							.onChange(async (value) => {
								this.plugin.settings.serverToken = value.trim();
								await this.plugin.saveSettings();
							})
					);

				// Status display
				const statusDiv = containerEl.createDiv('droidian-server-status');
				if (isRunning) {
					const serverAddresses = this.plugin.getRelayServerAddresses();
					statusDiv.createEl('p', {
						text: `Server running on port ${this.plugin.settings.serverPort}`,
						cls: 'droidian-server-running',
					});
					if (serverAddresses.length > 0) {
						const addrEl = statusDiv.createEl('p', { cls: 'droidian-server-addrs' });
						addrEl.setText('LAN: ' + serverAddresses.map(ip => `ws://${ip}:${this.plugin.settings.serverPort}`).join('  '));
					}
					statusDiv.createEl('p', {
						text: 'Use a tunneling tool (frp, ngrok, etc.) to expose port ' + this.plugin.settings.serverPort + ' for remote access.',
						cls: 'droidian-server-hint',
					});
				} else {
					statusDiv.createEl('p', {
						text: 'Server is not running.',
						cls: 'droidian-server-stopped',
					});
				}
			}
		}

		// ── Remote connection (all platforms) ─────────────────────────────────
		containerEl.createEl('h3', { text: Platform.isMobile ? 'Remote Connection' : 'Remote Mode' });

		if (Platform.isDesktop) {
			new Setting(containerEl)
				.setName('Use remote relay')
				.setDesc('Connect to a relay server instead of running Droid locally. Useful for testing or unusual setups.')
				.addToggle(toggle =>
					toggle
						.setValue(this.plugin.settings.remoteMode)
						.onChange(async (value) => {
							this.plugin.settings.remoteMode = value;
							await this.plugin.saveSettings();
							this.display();
						})
				);
		}

		if (Platform.isMobile || this.plugin.settings.remoteMode) {
			new Setting(containerEl)
				.setName('Relay server URL')
				.setDesc('WebSocket URL of the Droidian relay server running on your Mac (e.g. ws://192.168.1.5:8766 or your tunnel URL).')
				.addText(text =>
					text
						.setPlaceholder('ws://your-mac-ip:8766')
						.setValue(this.plugin.settings.remoteUrl)
						.onChange(async (value) => {
							this.plugin.settings.remoteUrl = value.trim();
							await this.plugin.saveSettings();
						})
				);
		}

		// ── Diff preview (desktop) ────────────────────────────────────────────
		if (Platform.isDesktop) {
			containerEl.createEl('h3', { text: 'File Edit Preview' });

			new Setting(containerEl)
				.setName('Show diff before applying edits')
				.setDesc('When Droid edits a file, show a diff preview with Accept / Reject buttons before writing.')
				.addToggle(toggle =>
					toggle
						.setValue(this.plugin.settings.showDiffPreview)
						.onChange(async (value) => {
							this.plugin.settings.showDiffPreview = value;
							await this.plugin.saveSettings();
						})
				);
		}

		// ── Chat export ───────────────────────────────────────────────────────
		containerEl.createEl('h3', { text: 'Chat Export' });

		new Setting(containerEl)
			.setName('Export conversations to Markdown')
			.setDesc('Automatically save chat sessions as .md files in your vault after each reply.')
			.addToggle(toggle =>
				toggle
					.setValue(this.plugin.settings.exportEnabled)
					.onChange(async (value) => {
						this.plugin.settings.exportEnabled = value;
						await this.plugin.saveSettings();
						this.display();
					})
			);

		if (this.plugin.settings.exportEnabled) {
			new Setting(containerEl)
				.setName('Export folder')
				.setDesc('Vault-relative path where exported chat Markdown files are saved.')
				.addText(text =>
					text
						.setPlaceholder('Droid/sessions')
						.setValue(this.plugin.settings.exportFolder)
						.onChange(async (value) => {
							this.plugin.settings.exportFolder = value.trim() || 'Droid/sessions';
							await this.plugin.saveSettings();
						})
				);
		}

		// ── Desktop: Auth status ───────────────────────────────────────────────
		if (Platform.isDesktop) {
			containerEl.createEl('h3', { text: 'Authentication' });
			const authEl = containerEl.createDiv('droidian-install-help');

			const loggedIn = isLoggedIn();
			const statusEl = authEl.createDiv('droidian-auth-status');
			const dot = statusEl.createSpan('droidian-auth-dot');
			dot.addClass(loggedIn ? 'is-online' : 'is-offline');
			statusEl.createSpan().setText(loggedIn ? 'Logged in to Factory' : 'Not logged in');

			if (!loggedIn) {
				authEl.createEl('p', { text: 'Run the following commands to authenticate:' });
				authEl.createEl('code').setText('curl -fsSL https://app.factory.ai/cli | sh');
				authEl.createEl('br');
				authEl.createEl('code').setText('droid   →   /login');
			} else {
				authEl.createEl('p', {
					text: 'Credentials found. You\'re ready to use Factory Droid.',
					cls: 'droidian-auth-ok',
				});
			}
		}
	}
}
