import { Editor, Menu, MenuItem, Plugin } from 'obsidian';
import type { DroidianView } from '../chat/DroidianView';
import { VIEW_TYPE_DROIDIAN } from '../../core/constants';

interface EditorCommandDef {
	id: string;
	name: string;
	prompt: (selection: string) => string;
}

const EDITOR_COMMANDS: EditorCommandDef[] = [
	{
		id: 'ask-about-selection',
		name: 'Ask Droid about selection',
		prompt: (s) => s,
	},
	{
		id: 'summarize-selection',
		name: 'Summarize selection',
		prompt: (s) => `Summarize the following text:\n\n${s}`,
	},
	{
		id: 'translate-selection',
		name: 'Translate selection',
		prompt: (s) => `Translate the following text to Chinese:\n\n${s}`,
	},
	{
		id: 'rewrite-selection',
		name: 'Rewrite / improve selection',
		prompt: (s) => `Rewrite and improve the following text while preserving meaning:\n\n${s}`,
	},
	{
		id: 'explain-selection',
		name: 'Explain selection',
		prompt: (s) => `Explain the following clearly and concisely:\n\n${s}`,
	},
];

export function registerEditorCommands(plugin: Plugin): void {
	// Command palette entries (work with or without selection)
	for (const def of EDITOR_COMMANDS) {
		plugin.addCommand({
			id: `droid-${def.id}`,
			name: def.name,
			editorCallback: (editor: Editor) => {
				const selection = editor.getSelection();
				if (!selection.trim()) return;
				sendToDroid(plugin, def.prompt(selection));
			},
		});
	}

	// Editor right-click context menu
	plugin.registerEvent(
		plugin.app.workspace.on('editor-menu', (menu: Menu, editor: Editor) => {
			const selection = editor.getSelection();
			if (!selection.trim()) return;

			menu.addSeparator();
			menu.addItem((item: MenuItem) => {
				item
					.setTitle('Droid')
					.setIcon('bot')
					.setSection('droid');
			});

			for (const def of EDITOR_COMMANDS) {
				menu.addItem((item: MenuItem) => {
					item
						.setTitle(def.name)
						.setSection('droid')
						.onClick(() => sendToDroid(plugin, def.prompt(selection)));
				});
			}
		})
	);
}

async function sendToDroid(plugin: Plugin, text: string): Promise<void> {
	const { workspace } = plugin.app;

	// Ensure the droidian view is open
	let leaf = workspace.getLeavesOfType(VIEW_TYPE_DROIDIAN)[0];
	if (!leaf) {
		leaf = workspace.getRightLeaf(false) ?? workspace.getLeaf('tab');
		await leaf.setViewState({ type: VIEW_TYPE_DROIDIAN, active: true });
	}
	workspace.revealLeaf(leaf);

	const view = leaf.view as DroidianView;
	// Small delay to ensure view is mounted
	setTimeout(() => view.sendFromCommand(text), 100);
}
