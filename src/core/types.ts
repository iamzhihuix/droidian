export interface DroidSettings {
	droidCliPath: string;
	model: string;
	autoLevel: AutoLevel;
	environmentVariables: string;
	openInMainTab: boolean;
	// Remote / relay settings
	remoteMode: boolean;
	remoteUrl: string;
	// Desktop relay server settings
	serverEnabled: boolean;
	serverPort: number;
	serverToken: string;
	// Diff preview
	showDiffPreview: boolean;
	// Chat export
	exportEnabled: boolean;
	exportFolder: string;
}

export type AutoLevel = 'readonly' | 'low' | 'medium' | 'high';

export type MessageRole = 'user' | 'assistant';

export interface Attachment {
	type: 'image' | 'file';
	name: string;
	// image attachments
	mimeType?: string;
	base64?: string;
	// file attachments
	vaultPath?: string;
}

export interface ChatMessage {
	id: string;
	role: MessageRole;
	content: string;
	timestamp: number;
	toolCalls?: ToolCallInfo[];
	thinkingSeconds?: number;
	isStreaming?: boolean;
	attachments?: Attachment[];
}

export interface ToolCallInfo {
	id: string;
	toolName: string;
	parameters: Record<string, unknown>;
	result?: string;
	isError?: boolean;
	status: 'running' | 'success' | 'error';
	startedAt: number;
	completedAt?: number;
}

export interface Session {
	id: string;
	title: string;
	sessionId?: string;
	createdAt: number;
	updatedAt: number;
	messages: ChatMessage[];
}

export interface DroidianData {
	sessions: Session[];
	settings: DroidSettings;
}

// --- JSON-RPC protocol types ---

export interface JsonRpcRequest {
	jsonrpc: '2.0';
	type: 'request';
	factoryApiVersion: string;
	factoryProtocolVersion: string;
	method: string;
	params: Record<string, unknown>;
	id: string;
}

export interface JsonRpcResponse {
	jsonrpc: '2.0';
	type: 'response';
	factoryApiVersion: string;
	factoryProtocolVersion: string;
	id: string | null;
	result?: Record<string, unknown>;
	error?: { code: number; message: string };
}

export interface JsonRpcNotification {
	jsonrpc: '2.0';
	type: 'notification';
	method: string;
	params: {
		notification: SessionNotification;
	};
}

// Incoming requests FROM the droid process (require a response back via stdin)
export interface JsonRpcIncomingRequest {
	jsonrpc: '2.0';
	type: 'request';
	method: string;
	params: Record<string, unknown>;
	id: string;
}

export type JsonRpcMessage = JsonRpcResponse | JsonRpcNotification | JsonRpcIncomingRequest;

// Permission request structures
export interface PermissionToolUse {
	toolUse: { name: string; [key: string]: unknown };
	confirmationType: string;
	details: Record<string, unknown>;
}

export interface PermissionOption {
	label: string;
	value: string; // 'allow_once' | 'allow_always' | 'deny' | 'cancel'
}

export interface AskUserQuestion {
	index: number;
	topic: string;
	question: string;
	options: string[];
}

// --- Session notification subtypes ---

export interface TextDeltaNotification {
	type: 'assistant_text_delta';
	messageId: string;
	blockIndex: number;
	textDelta: string;
}

export interface CreateMessageNotification {
	type: 'create_message';
	message: {
		id: string;
		role: MessageRole;
		content: Array<{ type: string; text?: string; [key: string]: unknown }>;
		createdAt: number;
		updatedAt: number;
		parentId: string;
	};
	requestId?: string;
}

export interface WorkingStateNotification {
	type: 'droid_working_state_changed';
	newState: 'idle' | 'streaming_assistant_message' | 'executing_tool' | 'waiting_for_tool_confirmation';
}

export interface SessionTitleNotification {
	type: 'session_title_updated';
	title: string;
}

export interface ToolUseNotification {
	type: 'assistant_tool_use';
	messageId: string;
	blockIndex: number;
	toolUseId: string;
	toolName: string;
	input: Record<string, unknown>;
}

export interface ToolResultNotification {
	type: 'tool_result';
	toolUseId: string;
	content: string;
	isError: boolean;
}

export interface ThinkingDeltaNotification {
	type: 'assistant_thinking_delta';
	messageId: string;
	blockIndex: number;
	thinkingDelta: string;
}

export type SessionNotification =
	| TextDeltaNotification
	| CreateMessageNotification
	| WorkingStateNotification
	| SessionTitleNotification
	| ToolUseNotification
	| ToolResultNotification
	| ThinkingDeltaNotification
	| { type: string; [key: string]: unknown };

// --- Internal events dispatched to StreamController ---

export interface DroidSystemEvent {
	type: 'system';
	sessionId: string;
	settings: Record<string, unknown>;
}

export interface DroidTextChunkEvent {
	type: 'text_chunk';
	messageId: string;
	text: string;
}

export interface DroidMessageEvent {
	type: 'message';
	role: MessageRole;
	id: string;
	text: string;
	timestamp: number;
}

export interface DroidThinkingEvent {
	type: 'thinking';
	messageId: string;
}

export interface DroidToolCallEvent {
	type: 'tool_call';
	id: string;
	messageId: string;
	toolName: string;
	parameters: Record<string, unknown>;
	timestamp: number;
}

export interface DroidToolResultEvent {
	type: 'tool_result';
	id: string;
	messageId: string;
	isError: boolean;
	value: string;
	timestamp: number;
}

export interface DroidWorkingStateEvent {
	type: 'working_state';
	state: 'idle' | 'streaming_assistant_message' | 'executing_tool' | 'waiting_for_tool_confirmation';
}

export interface DroidTitleEvent {
	type: 'title';
	title: string;
}

export interface DroidErrorEvent {
	type: 'error';
	message: string;
}

export type DroidEvent =
	| DroidSystemEvent
	| DroidTextChunkEvent
	| DroidMessageEvent
	| DroidThinkingEvent
	| DroidToolCallEvent
	| DroidToolResultEvent
	| DroidWorkingStateEvent
	| DroidTitleEvent
	| DroidErrorEvent;
