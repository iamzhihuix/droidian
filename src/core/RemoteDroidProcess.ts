import type { DroidSettings, JsonRpcRequest } from './types';
import { FACTORY_API_VERSION, FACTORY_PROTOCOL_VERSION } from './constants';

export interface SpawnOptions {
	vaultPath: string;
}

/** Minimal stream-like EventEmitter usable in both Electron and mobile Obsidian */
class FakeStream {
	private _listeners: Map<string, ((chunk: string) => void)[]> = new Map();

	setEncoding(_enc: string): void { /* no-op */ }

	on(event: string, listener: (chunk: string) => void): this {
		const list = this._listeners.get(event) ?? [];
		list.push(listener);
		this._listeners.set(event, list);
		return this;
	}

	emit(event: string, data: string): void {
		for (const l of this._listeners.get(event) ?? []) l(data);
	}
}

/** Fake ChildProcess-compatible object returned by RemoteDroidProcess.spawn() */
export class FakeChildProcess {
	readonly stdout = new FakeStream();
	readonly stderr = new FakeStream();
	killed = false;

	private _listeners: Map<string, ((...args: unknown[]) => void)[]> = new Map();

	on(event: string, listener: (...args: unknown[]) => void): this {
		const list = this._listeners.get(event) ?? [];
		list.push(listener);
		this._listeners.set(event, list);
		return this;
	}

	emit(event: string, ...args: unknown[]): void {
		for (const l of this._listeners.get(event) ?? []) l(...args);
	}
}

/**
 * Connects to the Droidian Relay Server over WebSocket and bridges
 * JSON-RPC messages — same public interface as DroidProcess.
 */
export class RemoteDroidProcess {
	private ws: WebSocket | null = null;
	private settings: DroidSettings;
	private reqCounter = 0;
	private _isRunning = false;
	private _proc: FakeChildProcess | null = null;
	private pendingMessages: string[] = [];

	constructor(settings: DroidSettings) {
		this.settings = settings;
	}

	updateSettings(settings: DroidSettings): void {
		this.settings = settings;
	}

	spawn(opts: SpawnOptions): FakeChildProcess {
		const fakeProc = new FakeChildProcess();
		this._proc = fakeProc;

		const url = this.settings.remoteUrl;
		if (!url) {
			setTimeout(() => fakeProc.emit('error', new Error('Remote URL is not configured.')), 0);
			return fakeProc;
		}

		try {
			this.ws = new WebSocket(url);
		} catch (e) {
			setTimeout(() => fakeProc.emit('error', e as Error), 0);
			return fakeProc;
		}

		this.ws.onopen = () => {
			this._isRunning = true;
			// Send relay init so server spawns droid with the right args
			const init = JSON.stringify({
				type: 'relay_init',
				cwd: opts.vaultPath,
				model: this.settings.model,
				autoLevel: this.settings.autoLevel,
			});
			this.ws!.send(init);
			// Flush buffered JSON-RPC messages
			for (const msg of this.pendingMessages) this.ws!.send(msg);
			this.pendingMessages = [];
		};

		this.ws.onmessage = (event: MessageEvent) => {
			const data = typeof event.data === 'string' ? event.data : String(event.data);
			// Check for relay control envelope
			try {
				const parsed = JSON.parse(data) as Record<string, unknown>;
				if (parsed['type'] === 'relay_event') {
					const ev = parsed['event'] as string;
					if (ev === 'process_closed') {
						this._isRunning = false;
						fakeProc.emit('close', (parsed['code'] as number | null) ?? null);
					} else if (ev === 'process_error') {
						fakeProc.emit('error', new Error(parsed['message'] as string ?? 'Relay error'));
					}
					// 'started' is informational; DroidService waits with a timeout
					return;
				}
				if (parsed['type'] === 'relay_pong') return;
			} catch {
				// Not a relay envelope — fall through to stdout
			}
			fakeProc.stdout.emit('data', data);
		};

		this.ws.onerror = () => {
			this._isRunning = false;
			fakeProc.emit('error', new Error(`WebSocket connection failed: ${url}`));
		};

		this.ws.onclose = () => {
			this._isRunning = false;
			fakeProc.emit('close', null);
		};

		return fakeProc;
	}

	sendJsonRpc(method: string, params: Record<string, unknown>): string {
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
		const msg = JSON.stringify(request);
		if (this.ws?.readyState === WebSocket.OPEN) {
			this.ws.send(msg);
		} else {
			this.pendingMessages.push(msg);
		}
		return id;
	}

	sendJsonRpcResponse(id: string, result: Record<string, unknown>): void {
		if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
		const response = {
			jsonrpc: '2.0',
			type: 'response',
			factoryApiVersion: FACTORY_API_VERSION,
			factoryProtocolVersion: FACTORY_PROTOCOL_VERSION,
			id,
			result,
		};
		this.ws.send(JSON.stringify(response));
	}

	kill(): void {
		this._isRunning = false;
		this.pendingMessages = [];
		if (this.ws) {
			try { this.ws.close(); } catch {}
			this.ws = null;
		}
		this._proc = null;
		this.reqCounter = 0;
	}

	get isRunning(): boolean {
		return this._isRunning;
	}

	get process(): FakeChildProcess | null {
		return this._proc;
	}
}
