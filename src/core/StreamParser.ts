import type {
	DroidEvent,
	JsonRpcMessage,
	JsonRpcResponse,
	JsonRpcNotification,
	JsonRpcIncomingRequest,
	SessionNotification,
	TextDeltaNotification,
	CreateMessageNotification,
	WorkingStateNotification,
	SessionTitleNotification,
	ToolResultNotification,
} from './types';
import { log } from '../utils/logger';

type EventHandler = (event: DroidEvent) => void;
type ResponseHandler = (id: string, response: JsonRpcResponse) => void;
type IncomingRequestHandler = (req: JsonRpcIncomingRequest) => void;

export class StreamParser {
	private buffer = '';
	private eventHandler: EventHandler;
	private responseHandler: ResponseHandler;
	private incomingRequestHandler: IncomingRequestHandler;

	constructor(
		eventHandler: EventHandler,
		responseHandler: ResponseHandler,
		incomingRequestHandler: IncomingRequestHandler
	) {
		this.eventHandler = eventHandler;
		this.responseHandler = responseHandler;
		this.incomingRequestHandler = incomingRequestHandler;
	}

	feed(chunk: string): void {
		this.buffer += chunk;
		const lines = this.buffer.split('\n');
		this.buffer = lines.pop() ?? '';

		for (const line of lines) {
			const trimmed = line.trim();
			if (!trimmed) continue;
			try {
				const msg = JSON.parse(trimmed) as JsonRpcMessage;
				this.dispatch(msg);
			} catch {
				log.warn('Failed to parse line:', trimmed.slice(0, 120));
			}
		}
	}

	flush(): void {
		const trimmed = this.buffer.trim();
		if (trimmed) {
			try {
				const msg = JSON.parse(trimmed) as JsonRpcMessage;
				this.dispatch(msg);
			} catch {
				// ignore
			}
		}
		this.buffer = '';
	}

	private dispatch(msg: JsonRpcMessage): void {
		if (msg.type === 'response') {
			const resp = msg as JsonRpcResponse;
			log.info(`RPC response id=${resp.id} error=${!!resp.error}`, resp.error?.message ?? '');
			if (resp.id) {
				this.responseHandler(resp.id, resp);
			}
			return;
		}

		if (msg.type === 'notification') {
			const notif = msg as JsonRpcNotification;
			if (notif.method === 'droid.session_notification') {
				const n = notif.params.notification;
				log.info(`notification type=${n.type}`);
				this.handleNotification(n);
			}
			return;
		}

		if (msg.type === 'request') {
			const req = msg as JsonRpcIncomingRequest;
			log.info(`incoming request method=${req.method} id=${req.id}`);
			this.incomingRequestHandler(req);
		}
	}

	private handleNotification(n: SessionNotification): void {
		switch (n.type) {
			case 'assistant_text_delta': {
				const t = n as TextDeltaNotification;
				this.eventHandler({
					type: 'text_chunk',
					messageId: t.messageId,
					text: t.textDelta,
				});
				break;
			}

			case 'create_message': {
				const c = n as CreateMessageNotification;
				if (c.message.role === 'assistant') {
					// Extract text blocks
					const text = c.message.content
						.filter(b => b.type === 'text' && b.text)
						.map(b => b.text as string)
						.join('');

					// Extract tool_use blocks and emit tool_call events
					const toolUseBlocks = c.message.content.filter(b => b.type === 'tool_use');
					for (const block of toolUseBlocks) {
						const id = block['id'] as string ?? `tool-${Date.now()}`;
						const toolName = block['name'] as string ?? 'unknown';
						const input = (block['input'] as Record<string, unknown>) ?? {};
						log.info(`create_message tool_use id=${id} name=${toolName}`);
						this.eventHandler({
							type: 'tool_call',
							id,
							messageId: c.message.id,
							toolName,
							parameters: input,
							timestamp: c.message.createdAt,
						});
					}

					if (text || toolUseBlocks.length === 0) {
						log.info(`create_message role=assistant id=${c.message.id} textLen=${text.length}`);
						this.eventHandler({
							type: 'message',
							role: 'assistant',
							id: c.message.id,
							text,
							timestamp: c.message.createdAt,
						});
					}
				}
				break;
			}

			case 'droid_working_state_changed': {
				const w = n as WorkingStateNotification;
				log.info(`working_state → ${w.newState}`);
				this.eventHandler({
					type: 'working_state',
					state: w.newState,
				});
				break;
			}

			case 'session_title_updated': {
				const ti = n as SessionTitleNotification;
				this.eventHandler({ type: 'title', title: ti.title });
				break;
			}

			case 'thinking_text_delta': {
				// Real protocol name (not assistant_thinking_delta)
				const messageId = (n as unknown as { messageId?: string }).messageId ?? '';
				this.eventHandler({ type: 'thinking', messageId });
				break;
			}

			case 'tool_result': {
				const tr = n as ToolResultNotification;
				log.info(`tool_result toolUseId=${tr.toolUseId} isError=${tr.isError} len=${tr.content?.length ?? 0}`);
				this.eventHandler({
					type: 'tool_result',
					id: tr.toolUseId,
					messageId: (n as { messageId?: string }).messageId ?? '',
					isError: tr.isError,
					value: tr.content,
					timestamp: Date.now(),
				});
				break;
			}

			default: {
				log.info(`unhandled notification type=${n.type}`);
				break;
			}
		}
	}
}
