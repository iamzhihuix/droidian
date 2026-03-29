import type { DroidSettings } from './types';

export const VIEW_TYPE_DROIDIAN = 'droidian-view';

export const FACTORY_API_VERSION = '1.0.0';
export const FACTORY_PROTOCOL_VERSION = '1.4.0';

export const DEFAULT_SETTINGS: DroidSettings = {
	droidCliPath: '',
	model: 'claude-opus-4-6',
	autoLevel: 'low',
	environmentVariables: '',
	openInMainTab: false,
	remoteMode: false,
	remoteUrl: '',
	serverEnabled: false,
	serverPort: 8766,
	serverToken: '',
};

export const AVAILABLE_MODELS = [
	{ id: 'claude-opus-4-6', name: 'Claude Opus 4.6' },
	{ id: 'claude-opus-4-6-fast', name: 'Claude Opus 4.6 Fast' },
	{ id: 'claude-sonnet-4-5-20250929', name: 'Claude Sonnet 4.5' },
	{ id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5' },
	{ id: 'gpt-5.3-codex', name: 'GPT-5.3 Codex' },
	{ id: 'gpt-5.2', name: 'GPT-5.2' },
	{ id: 'gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro' },
	{ id: 'gemini-3-flash-preview', name: 'Gemini 3 Flash' },
];

export const TOOL_DISPLAY_NAMES: Record<string, string> = {
	Read: 'Read',
	Execute: 'Bash',
	Edit: 'Edit',
	Write: 'Write',
	Glob: 'Glob',
	Grep: 'Grep',
	LS: 'LS',
	Bash: 'Bash',
	TodoWrite: 'Todo',
	TodoRead: 'Todo',
	WebSearch: 'WebSearch',
	Task: 'Task',
};

export const AUTO_LEVEL_LABELS: Record<string, string> = {
	readonly: 'Read-only',
	low: 'Low',
	medium: 'Medium',
	high: 'High',
};
