import type { App } from 'obsidian';

// File extensions we treat as openable in Obsidian
const OPENABLE_EXTS = new Set([
	'md', 'canvas', 'txt', 'csv', 'json', 'yaml', 'yml',
	'ts', 'tsx', 'js', 'jsx', 'py', 'sh', 'css', 'html',
	'rs', 'go', 'java', 'cpp', 'c', 'h', 'rb', 'php',
	'toml', 'ini', 'conf', 'xml', 'svg',
]);

// Matches path-like tokens: relative (foo/bar.md) or absolute (/Users/x/y.md)
const PATH_RE = /(?:^|[\s(["'])((\.{0,2}\/[^\s"')\],:;?!]+|[A-Za-z0-9_\-][A-Za-z0-9_\-./]*\.[A-Za-z0-9]+))/g;

function hasOpenableExt(p: string): boolean {
	const dot = p.lastIndexOf('.');
	if (dot === -1) return false;
	return OPENABLE_EXTS.has(p.slice(dot + 1).toLowerCase());
}

/** Strip absolute vault prefix so we get a vault-relative path, or return null. */
function toVaultRelative(rawPath: string, vaultBasePath: string): string | null {
	const clean = rawPath.replace(/\\/g, '/');
	const base = vaultBasePath.replace(/\\/g, '/').replace(/\/$/, '');
	if (clean.startsWith(base + '/')) return clean.slice(base.length + 1);
	// Already relative (no leading slash)
	if (!clean.startsWith('/')) return clean;
	return null;
}

/** Returns the vault-relative path if the file exists in the vault, else null. */
export function resolveVaultPath(rawPath: string, app: App): string | null {
	if (!hasOpenableExt(rawPath)) return null;

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const basePath: string = (app.vault.adapter as any).basePath ?? '';

	const candidate = toVaultRelative(rawPath, basePath) ?? rawPath;
	if (!candidate) return null;

	// Check vault
	const file = app.vault.getFileByPath(candidate) ?? app.metadataCache.getFirstLinkpathDest(candidate, '');
	return file ? file.path : null;
}

/** Open a vault path in a new tab. */
export function openFileInNewTab(app: App, vaultPath: string): void {
	app.workspace.openLinkText(vaultPath, '', true);
}

/**
 * Walk text nodes in `el` and wrap recognized vault file paths with clickable spans.
 * Called after content is rendered.
 */
export function linkifyFilePaths(el: HTMLElement, app: App): void {
	const walk = (node: Node) => {
		if (node.nodeType === Node.TEXT_NODE) {
			const text = node.textContent ?? '';
			if (!text.trim()) return;

			const frag = document.createDocumentFragment();
			let last = 0;
			let match: RegExpExecArray | null;
			PATH_RE.lastIndex = 0;

			while ((match = PATH_RE.exec(text)) !== null) {
				const rawPath = match[1];
				const matchStart = match.index + (match[0].length - rawPath.length);

				const vaultPath = resolveVaultPath(rawPath, app);
				if (!vaultPath) continue;

				// Text before the match
				if (matchStart > last) {
					frag.appendChild(document.createTextNode(text.slice(last, matchStart)));
				}

				const span = document.createElement('span');
				span.className = 'droidian-file-link';
				span.textContent = rawPath;
				span.title = vaultPath;
				span.addEventListener('click', (e) => {
					e.preventDefault();
					e.stopPropagation();
					openFileInNewTab(app, vaultPath);
				});
				frag.appendChild(span);
				last = matchStart + rawPath.length;
			}

			if (last === 0) return; // nothing replaced
			if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
			node.parentNode?.replaceChild(frag, node);
			return;
		}

		// Skip code blocks and existing links — they're handled by Obsidian or are raw text
		if (node.nodeType === Node.ELEMENT_NODE) {
			const tag = (node as Element).tagName?.toLowerCase();
			if (tag === 'a' || tag === 'code' || tag === 'pre') return;
		}

		for (const child of Array.from(node.childNodes)) walk(child);
	};

	walk(el);
}
