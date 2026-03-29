/** Renders a simple inline diff between oldText and newText inside containerEl. */
export function renderDiff(containerEl: HTMLElement, oldText: string, newText: string): void {
	containerEl.empty();
	containerEl.addClass('droidian-diff');

	const oldLines = oldText.split('\n');
	const newLines = newText.split('\n');
	const hunks = computeDiff(oldLines, newLines);

	for (const hunk of hunks) {
		const lineEl = containerEl.createDiv('droidian-diff-line');
		if (hunk.type === 'del') {
			lineEl.addClass('is-del');
			lineEl.createSpan('droidian-diff-sign').setText('−');
		} else if (hunk.type === 'add') {
			lineEl.addClass('is-add');
			lineEl.createSpan('droidian-diff-sign').setText('+');
		} else {
			lineEl.addClass('is-ctx');
			lineEl.createSpan('droidian-diff-sign').setText(' ');
		}
		lineEl.createSpan('droidian-diff-text').setText(hunk.text);
	}
}

interface DiffHunk {
	type: 'add' | 'del' | 'ctx';
	text: string;
}

/** Very simple LCS-based diff — good enough for small files. */
function computeDiff(oldLines: string[], newLines: string[]): DiffHunk[] {
	const result: DiffHunk[] = [];
	const lcs = buildLCS(oldLines, newLines);

	let oi = 0, ni = 0, li = 0;
	while (oi < oldLines.length || ni < newLines.length) {
		if (li < lcs.length && oi < oldLines.length && ni < newLines.length
			&& oldLines[oi] === lcs[li] && newLines[ni] === lcs[li]) {
			result.push({ type: 'ctx', text: oldLines[oi] });
			oi++; ni++; li++;
		} else if (ni < newLines.length && (li >= lcs.length || newLines[ni] !== lcs[li])) {
			result.push({ type: 'add', text: newLines[ni++] });
		} else if (oi < oldLines.length && (li >= lcs.length || oldLines[oi] !== lcs[li])) {
			result.push({ type: 'del', text: oldLines[oi++] });
		} else {
			break;
		}
	}
	return result;
}

function buildLCS(a: string[], b: string[]): string[] {
	const m = a.length, n = b.length;
	// Cap to avoid O(m*n) blowup on huge files
	if (m * n > 200_000) return [];
	const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
	for (let i = 1; i <= m; i++) {
		for (let j = 1; j <= n; j++) {
			dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
		}
	}
	const lcs: string[] = [];
	let i = m, j = n;
	while (i > 0 && j > 0) {
		if (a[i - 1] === b[j - 1]) { lcs.unshift(a[i - 1]); i--; j--; }
		else if (dp[i - 1][j] > dp[i][j - 1]) i--;
		else j--;
	}
	return lcs;
}
