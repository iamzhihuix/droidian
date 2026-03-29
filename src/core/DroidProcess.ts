import type { ChildProcess } from 'child_process';
import type { DroidSettings, JsonRpcRequest } from './types';
import { FACTORY_API_VERSION, FACTORY_PROTOCOL_VERSION } from './constants';
import { parseEnvVars, resolveDroidCli } from '../utils/droidCli';

export interface SpawnOptions {
	vaultPath: string;
}

export class DroidProcess {
	private proc: ChildProcess | null = null;
	private settings: DroidSettings;
	private reqCounter = 0;

	constructor(settings: DroidSettings) {
		this.settings = settings;
	}

	updateSettings(settings: DroidSettings): void {
		this.settings = settings;
	}

	spawn(opts: SpawnOptions): ChildProcess {
		const cliPath = resolveDroidCli(this.settings.droidCliPath, this.settings.environmentVariables);
		if (!cliPath) {
			throw new Error('Droid CLI not found. Please install it or set the path in settings.');
		}

		const args = this.buildArgs();
		const env = this.buildEnv();

		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const { spawn } = require('child_process') as typeof import('child_process');
		this.proc = spawn(cliPath, args, {
			cwd: opts.vaultPath,
			env,
			stdio: ['pipe', 'pipe', 'pipe'],
		});

		return this.proc;
	}

	sendJsonRpc(method: string, params: Record<string, unknown>): string {
		if (!this.proc?.stdin) {
			throw new Error('Process not running');
		}
		const id = `req-${++this.reqCounter}`;
		const request: JsonRpcRequest = {
			jsonrpc: '2.0',
			type: 'request',
			factoryApiVersion: FACTORY_API_VERSION,
			factoryProtocolVersion: FACTORY_PROTOCOL_VERSION,
			method,
			params,
			id,
		};
		this.proc.stdin.write(JSON.stringify(request) + '\n');
		return id;
	}

	sendJsonRpcResponse(id: string, result: Record<string, unknown>): void {
		if (!this.proc?.stdin) return;
		const response = {
			jsonrpc: '2.0',
			type: 'response',
			factoryApiVersion: FACTORY_API_VERSION,
			factoryProtocolVersion: FACTORY_PROTOCOL_VERSION,
			id,
			result,
		};
		this.proc.stdin.write(JSON.stringify(response) + '\n');
	}

	kill(): void {
		if (this.proc && !this.proc.killed) {
			this.proc.kill('SIGTERM');
			setTimeout(() => {
				if (this.proc && !this.proc.killed) {
					this.proc.kill('SIGKILL');
				}
			}, 2000);
		}
		this.proc = null;
		this.reqCounter = 0;
	}

	get isRunning(): boolean {
		return this.proc !== null && !this.proc.killed;
	}

	get process(): ChildProcess | null {
		return this.proc;
	}

	private buildArgs(): string[] {
		const args = [
			'exec',
			'--input-format', 'stream-jsonrpc',
			'--output-format', 'stream-jsonrpc',
		];

		if (this.settings.autoLevel !== 'readonly') {
			args.push('--auto', this.settings.autoLevel);
		}

		if (this.settings.model) {
			args.push('--model', this.settings.model);
		}

		return args;
	}

	private buildEnv(): Record<string, string | undefined> {
		const base = { ...process.env };
		const custom = parseEnvVars(this.settings.environmentVariables);
		return { ...base, ...custom };
	}
}
