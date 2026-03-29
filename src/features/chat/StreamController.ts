import type { DroidEvent, ChatMessage, ToolCallInfo } from '../../core/types';
import type { ChatRenderer } from './ChatRenderer';
import type { MessageRenderer } from './MessageRenderer';
import { log } from '../../utils/logger';

export interface StreamCallbacks {
	onSessionId: (id: string) => void;
	onComplete: (sessionId: string, messages: ChatMessage[]) => void;
	onError: (err: string) => void;
	onThinkingUpdate: (seconds: number) => void;
	onTitle?: (title: string) => void;
	onAssistantMessageDone?: (message: ChatMessage, renderer: MessageRenderer) => void;
}

export class StreamController {
	private renderer: ChatRenderer;
	private messages: ChatMessage[];
	private callbacks: StreamCallbacks;
	private sessionId: string | undefined;

	private currentAssistantMessage: ChatMessage | null = null;
	private currentMessageRenderer: MessageRenderer | null = null;
	private thinkingStartMs: number | null = null;
	private thinkingTimer: ReturnType<typeof setInterval> | null = null;
	private pendingToolCalls = new Map<string, ToolCallInfo>();
	private streamingContent = '';

	// Simple boolean: are we in an active agent turn?
	private isActive = false;

	constructor(renderer: ChatRenderer, messages: ChatMessage[], callbacks: StreamCallbacks) {
		this.renderer = renderer;
		this.messages = messages;
		this.callbacks = callbacks;
	}

	handleEvent(event: DroidEvent): void {
		log.info(`event type=${event.type}${event.type === 'working_state' ? ' state=' + event.state : ''}`);

		switch (event.type) {
			case 'system':
				this.sessionId = event.sessionId;
				this.callbacks.onSessionId(event.sessionId);
				break;

			case 'working_state':
				this.handleWorkingState(event.state);
				break;

			case 'text_chunk':
				this.handleTextChunk(event.text, event.messageId);
				break;

			case 'message':
				// create_message for assistant — only render text if no chunks arrived yet
				if (event.role === 'assistant' && this.currentAssistantMessage && !this.currentAssistantMessage.content && event.text) {
					this.handleTextChunk(event.text, event.id);
				}
				break;

			case 'thinking':
				this.handleThinking();
				break;

			case 'tool_call':
				this.handleToolCall(event);
				break;

			case 'tool_result':
				this.handleToolResult(event);
				break;

			case 'title':
				this.callbacks.onTitle?.(event.title);
				break;

			case 'error':
				log.error(`droid error: ${event.message}`);
				this.callbacks.onError(event.message);
				this.stopThinkingTimer();
				break;
		}
	}

	private handleWorkingState(state: string): void {
		if (state === 'idle') {
			if (this.isActive) {
				log.info('working_state=idle → handleCompletion');
				this.isActive = false;
				this.handleCompletion();
			} else {
				log.info('working_state=idle (already inactive, ignoring)');
			}
		} else {
			// streaming_assistant_message, executing_tool, waiting_for_tool_confirmation — all keep turn alive
			if (!this.isActive) {
				log.info(`working_state=${state} → turn start`);
				this.isActive = true;
				this.ensureAssistantMessage();
			} else {
				log.info(`working_state=${state} (already active)`);
			}
		}
	}

	private ensureAssistantMessage(id?: string): MessageRenderer {
		if (!this.currentAssistantMessage) {
			this.currentAssistantMessage = {
				id: id ?? `assistant-${Date.now()}`,
				role: 'assistant',
				content: '',
				timestamp: Date.now(),
				toolCalls: [],
				isStreaming: true,
			};
			this.messages.push(this.currentAssistantMessage);
			this.currentMessageRenderer = this.renderer.addMessage(this.currentAssistantMessage);
			this.currentMessageRenderer.showLoading();
		}
		return this.currentMessageRenderer!;
	}

	private handleTextChunk(text: string, _messageId: string): void {
		const msgRenderer = this.ensureAssistantMessage();
		this.stopThinkingTimer();
		msgRenderer.hideLoading();
		msgRenderer.hideThinking();

		this.streamingContent += text;
		if (this.currentAssistantMessage) {
			this.currentAssistantMessage.content = this.streamingContent;
		}
		msgRenderer.updateContent(this.streamingContent);
		this.renderer.scrollToBottom();
	}

	private handleThinking(): void {
		const msgRenderer = this.ensureAssistantMessage();
		msgRenderer.hideLoading();

		if (this.thinkingStartMs === null) {
			this.thinkingStartMs = Date.now();
		}

		if (!this.thinkingTimer) {
			this.thinkingTimer = setInterval(() => {
				const seconds = Math.round((Date.now() - (this.thinkingStartMs ?? Date.now())) / 1000);
				this.currentMessageRenderer?.showThinking(seconds);
				this.callbacks.onThinkingUpdate(seconds);
			}, 1000);
		}
	}

	private handleToolCall(event: DroidEvent & { type: 'tool_call' }): void {
		this.ensureAssistantMessage(event.messageId);
		this.stopThinkingTimer();

		const toolCall: ToolCallInfo = {
			id: event.id,
			toolName: event.toolName,
			parameters: event.parameters,
			status: 'running',
			startedAt: event.timestamp,
		};

		this.pendingToolCalls.set(event.id, toolCall);
		if (this.currentAssistantMessage) {
			this.currentAssistantMessage.toolCalls?.push(toolCall);
		}
		this.currentMessageRenderer?.addToolCall(toolCall);
		this.currentMessageRenderer?.hideLoading();
		this.renderer.scrollToBottom();
	}

	private handleToolResult(event: DroidEvent & { type: 'tool_result' }): void {
		const toolCall = this.pendingToolCalls.get(event.id);
		if (!toolCall) {
			log.warn(`tool_result for unknown id=${event.id}`);
			return;
		}

		toolCall.result = event.value;
		toolCall.isError = event.isError;
		toolCall.status = event.isError ? 'error' : 'success';
		toolCall.completedAt = event.timestamp;

		this.currentMessageRenderer?.updateToolCall(toolCall);
		this.pendingToolCalls.delete(event.id);
		log.info(`tool_result resolved id=${event.id}, remaining=${this.pendingToolCalls.size}`);
	}

	private handleCompletion(): void {
		this.stopThinkingTimer();

		if (this.currentAssistantMessage) {
			this.currentAssistantMessage.isStreaming = false;
			this.currentMessageRenderer?.hideLoading();
			this.currentMessageRenderer?.hideThinking();

			for (const [, tc] of this.pendingToolCalls) {
				tc.status = 'success';
				tc.completedAt = Date.now();
				this.currentMessageRenderer?.updateToolCall(tc);
			}
			this.pendingToolCalls.clear();

			if (this.callbacks.onAssistantMessageDone && this.currentMessageRenderer) {
				this.callbacks.onAssistantMessageDone(this.currentAssistantMessage, this.currentMessageRenderer);
			}
		}

		this.currentAssistantMessage = null;
		this.currentMessageRenderer = null;
		this.streamingContent = '';
		this.thinkingStartMs = null;

		this.callbacks.onComplete(this.sessionId ?? '', this.messages);
	}

	private stopThinkingTimer(): void {
		if (this.thinkingTimer) {
			clearInterval(this.thinkingTimer);
			this.thinkingTimer = null;
		}
	}

	cancel(): void {
		this.stopThinkingTimer();
		if (this.currentAssistantMessage) {
			this.currentAssistantMessage.isStreaming = false;
			this.currentMessageRenderer?.hideLoading();
		}
		this.currentAssistantMessage = null;
		this.currentMessageRenderer = null;
		this.streamingContent = '';
		this.isActive = false;
		this.pendingToolCalls.clear();
	}
}
