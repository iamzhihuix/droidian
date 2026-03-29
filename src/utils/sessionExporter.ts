import type { App } from 'obsidian';
import type { Session, ChatMessage, ToolCallInfo } from '../core/types';

function sanitizeTitle(title: string): string {
	return title.replace(/[\\/:*?"<>|]/g, '-').slice(0, 60).trim() || 'Untitled';
}

function formatDate(ts: number): string {
	return new Date(ts).toISOString().replace('T', ' ').slice(0, 19);
}

function toolCallsMarkdown(toolCalls: ToolCallInfo[]): string {
	return toolCalls.map(tc => {
		const paramSummary = Object.entries(tc.parameters)
			.slice(0, 2)
			.map(([k, v]) => `${k}: ${String(v).slice(0, 80)}`)
			.join(', ');
		const status = tc.status === 'error' ? ' ❌' : '';
		const lines: string[] = [`> **Tool: ${tc.toolName}**(${paramSummary})${status}`];
		if (tc.result) {
			const snippet = tc.result.slice(0, 300);
			lines.push(`> \`\`\``);
			lines.push(snippet.split('\n').map(l => `> ${l}`).join('\n'));
			lines.push(`> \`\`\``);
		}
		return lines.join('\n');
	}).join('\n\n');
}

function messageToMarkdown(msg: ChatMessage): string {
	const role = msg.role === 'user' ? '## User' : '## Assistant';
	const parts: string[] = [role];

	if (msg.toolCalls && msg.toolCalls.length > 0) {
		parts.push(toolCallsMarkdown(msg.toolCalls));
	}

	if (msg.content) {
		parts.push(msg.content);
	}

	return parts.join('\n\n');
}

export async function exportSessionToMarkdown(
	app: App,
	session: Session,
	folderPath: string
): Promise<string> {
	const title = sanitizeTitle(session.title);
	const dateStr = new Date(session.createdAt).toISOString().slice(0, 10);
	const fileName = `${dateStr} ${title}.md`;
	const fullPath = `${folderPath.replace(/\/$/, '')}/${fileName}`;

	// Ensure folder exists
	const folder = app.vault.getFolderByPath(folderPath);
	if (!folder) {
		await app.vault.createFolder(folderPath).catch(() => {/* already exists */});
	}

	const frontmatter = [
		'---',
		'droid-session: true',
		`sessionId: "${session.sessionId ?? ''}"`,
		`created: "${formatDate(session.createdAt)}"`,
		`updated: "${formatDate(session.updatedAt)}"`,
		'---',
	].join('\n');

	const body = session.messages.map(messageToMarkdown).join('\n\n---\n\n');
	const content = `${frontmatter}\n\n# ${title}\n\n${body}\n`;

	const existing = app.vault.getFileByPath(fullPath);
	if (existing) {
		await app.vault.modify(existing, content);
	} else {
		await app.vault.create(fullPath, content);
	}

	return fullPath;
}
