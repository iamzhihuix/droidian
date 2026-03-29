import { MarkdownRenderer, Component } from 'obsidian';

let _component: Component | null = null;

export function getMarkdownComponent(): Component {
	if (!_component) {
		_component = new Component();
		_component.load();
	}
	return _component;
}

export async function renderMarkdown(
	text: string,
	containerEl: HTMLElement,
	sourcePath: string
): Promise<void> {
	containerEl.empty();
	await MarkdownRenderer.render(
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		(window as any).app,
		text,
		containerEl,
		sourcePath,
		getMarkdownComponent()
	);
}
