import { Platform } from 'obsidian';
import type {
	DroidEvent,
	DroidSettings,
	JsonRpcResponse,
	JsonRpcIncomingRequest,
	PermissionToolUse,
	PermissionOption,
	AskUserQuestion,
} from './types';
import { DroidProcess } from './DroidProcess';
import { RemoteDroidProcess } from './RemoteDroidProcess';
import { StreamParser } from './StreamParser';
import { log } from '../utils/logger';

function generateUUID(): string {
	if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
		return crypto.randomUUID();
	}
	return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
		const r = Math.random() * 16 | 0;
		return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
	});
}

export type DroidEventCallback = (event: DroidEvent) => void;
export type DroidErrorCallback = (error: Error) => void;
export type DroidCloseCallback = (code: number | null) => void;

export interface SendMessageOptions {
	text: string;
	noteContext?: string;
	images?: { media_type: string; data: string }[];
}

export class DroidService {
	private droidProcess: DroidProcess | RemoteDroidProcess;
	private settings: DroidSettings;
	private parser: StreamParser | null = null;
	private sessionId: string | undefined;
	private vaultPath: string | undefined;
	private initPromise: Promise<void> | null = null;

	// Pending RPC response resolvers keyed by request id
	private pendingResponses = new Map<string, (resp: JsonRpcResponse) => void>();

	private onEvent: DroidEventCallback;
	private onError: DroidErrorCallback;
	private onClose: DroidCloseCallback;

	constructor(
		settings: DroidSettings,
		onEvent: DroidEventCallback,
		onError: DroidErrorCallback,
		onClose: DroidCloseCallback
	) {
		this.settings = settings;
		this.droidProcess = this.createProcessImpl(settings);
		this.onEvent = onEvent;
		this.onError = onError;
		this.onClose = onClose;
	}

	private createProcessImpl(settings: DroidSettings): DroidProcess | RemoteDroidProcess {
		if (Platform.isMobile || settings.remoteMode) {
			return new RemoteDroidProcess(settings);
		}
		return new DroidProcess(settings);
	}

	updateSettings(settings: DroidSettings): void {
		const wasRemote = this.droidProcess instanceof RemoteDroidProcess;
		const willBeRemote = Platform.isMobile || settings.remoteMode;
		this.settings = settings;
		if (wasRemote !== willBeRemote) {
			// Transport mode changed — recreate the process impl
			this.droidProcess.kill();
			this.droidProcess = this.createProcessImpl(settings);
			this.parser = null;
			this.initPromise = null;
		} else {
			this.droidProcess.updateSettings(settings);
		}
	}

	async sendMessage(vaultPath: string, opts: SendMessageOptions): Promise<void> {
		this.vaultPath = vaultPath;
		await this.ensureProcess(vaultPath);

		const parts: string[] = [];
		if (opts.noteContext) {
			parts.push(`Current note: ${opts.noteContext}\n\n`);
		}
		parts.push(opts.text);
		const text = parts.join('');

		const params: Record<string, unknown> = { text };
		if (opts.images && opts.images.length > 0) {
			params['images'] = opts.images.map(img => ({
				type: 'base64',
				media_type: img.media_type,
				data: img.data,
			}));
		}

		log.info(`sendMessage → add_user_message (images=${opts.images?.length ?? 0})`);
		this.droidProcess.sendJsonRpc('droid.add_user_message', params);
	}

	interrupt(): void {
		if (this.droidProcess.isRunning) {
			try {
				this.droidProcess.sendJsonRpc('droid.interrupt_session', {});
			} catch {
				// process may have already died
			}
		}
	}

	cancel(): void {
		this.interrupt();
	}

	resetSession(): void {
		this.droidProcess.kill();
		this.parser = null;
		this.sessionId = undefined;
		this.initPromise = null;
		this.pendingResponses.clear();
	}

	/** Reset the process state without clearing the session ID (used on unexpected process exit). */
	resetProcess(): void {
		this.parser = null;
		this.initPromise = null;
		this.pendingResponses.clear();
	}

	setSessionId(id: string | undefined): void {
		this.sessionId = id;
	}

	getSessionId(): string | undefined {
		return this.sessionId;
	}

	get isRunning(): boolean {
		return this.droidProcess.isRunning;
	}

	private async ensureProcess(vaultPath: string): Promise<void> {
		if (this.droidProcess.isRunning && this.initPromise) {
			return this.initPromise;
		}

		this.initPromise = this.startProcess(vaultPath);
		return this.initPromise;
	}

	private async startProcess(vaultPath: string): Promise<void> {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const proc = this.droidProcess.spawn({ vaultPath }) as any;

		this.parser = new StreamParser(
			(event) => this.onEvent(event),
			(id, resp) => {
				const resolve = this.pendingResponses.get(id);
				if (resolve) {
					this.pendingResponses.delete(id);
					resolve(resp);
				}
			},
			(req) => this.handleIncomingRequest(req)
		);

		proc.stdout?.setEncoding?.('utf8');
		proc.stdout?.on('data', (chunk: string) => this.parser?.feed(chunk));

		proc.stderr?.setEncoding?.('utf8');
		proc.stderr?.on('data', (chunk: string) => {
			console.warn('[Droidian] stderr:', chunk);
		});

		proc.on('error', (err: Error) => {
			log.error(`process error: ${err.message}`);
			this.onError(err);
			this.initPromise = null;
		});

		proc.on('close', (code: number | null) => {
			log.info(`process closed code=${code}`);
			this.parser?.flush();
			this.onClose(code);
			this.initPromise = null;
		});

		log.info('process spawned, waiting for MCP init…');

		// Remote connections may need extra time for WS + relay startup
		const waitMs = (Platform.isMobile || this.settings.remoteMode) ? 2000 : 1500;
		await new Promise<void>((resolve) => setTimeout(resolve, waitMs));

		log.info('sending initialize_session');
		const interactionMode = this.settings.autoLevel === 'readonly' ? 'auto-low'
			: this.settings.autoLevel === 'low' ? 'auto-low'
			: this.settings.autoLevel === 'medium' ? 'auto-medium'
			: 'auto-high';
		const initId = await this.sendAndWait('droid.initialize_session', {
			machineId: generateUUID(),
			cwd: vaultPath,
			interactionMode,
			...(this.sessionId ? { sessionId: this.sessionId } : {}),
		});

		if (initId.result) {
			const result = initId.result as { sessionId?: string; settings?: Record<string, unknown> };
			log.info(`initialize_session OK sessionId=${result.sessionId}`);
			if (result.sessionId) {
				this.sessionId = result.sessionId;
			}
			this.onEvent({
				type: 'system',
				sessionId: result.sessionId ?? '',
				settings: result.settings ?? {},
			});
		} else if (initId.error) {
			throw new Error(`initialize_session failed: ${initId.error.message}`);
		}
	}

	private handleIncomingRequest(req: JsonRpcIncomingRequest): void {
		switch (req.method) {
			case 'droid.request_permission': {
				const params = req.params as {
					toolUses: PermissionToolUse[];
					options: PermissionOption[];
				};
				const toolNames = params.toolUses.map(t => t.toolUse.name).join(', ');
				// Use the first available option (works for both regular tools and exit_spec_mode)
				const selectedOption = params.options[0]?.value ?? 'allow_once';
				log.info(`request_permission tools=[${toolNames}] options=${params.options.map(o => o.value).join('|')} → ${selectedOption}`);
				this.droidProcess.sendJsonRpcResponse(req.id, { selectedOption });
				break;
			}

			case 'droid.ask_user': {
				const params = req.params as {
					toolCallId: string;
					questions: AskUserQuestion[];
				};
				// Auto-answer: pick the first option for each question
				const answers = params.questions.map(q => ({
					index: q.index,
					question: q.question,
					answer: q.options[0] ?? '',
				}));
				log.info(`ask_user toolCallId=${params.toolCallId} questions=${params.questions.length} → auto-answering with first option`);
				this.droidProcess.sendJsonRpcResponse(req.id, { cancelled: false, answers });
				break;
			}

			default:
				log.warn(`unhandled incoming request method=${req.method} id=${req.id}`);
				break;
		}
	}

	private sendAndWait(method: string, params: Record<string, unknown>): Promise<JsonRpcResponse> {
		return new Promise((resolve, reject) => {
			let id: string;
			try {
				id = this.droidProcess.sendJsonRpc(method, params);
			} catch (e) {
				reject(e);
				return;
			}
			const timeout = setTimeout(() => {
				this.pendingResponses.delete(id);
				reject(new Error(`Timeout waiting for ${method} response`));
			}, 15000);

			this.pendingResponses.set(id, (resp) => {
				clearTimeout(timeout);
				resolve(resp);
			});
		});
	}
}
