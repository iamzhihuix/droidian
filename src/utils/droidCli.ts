const COMMON_PATHS = [
	'/usr/local/bin/droid',
	'/usr/bin/droid',
	`${process.env.HOME}/.local/bin/droid`,
	`${process.env.HOME}/.factory/bin/droid`,
	'/opt/homebrew/bin/droid',
];

export function resolveDroidCli(customPath: string, envVars: string): string | null {
	if (customPath?.trim()) {
		return customPath.trim();
	}

	// Try to resolve from PATH (with env vars applied)
	try {
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const { execSync } = require('child_process') as typeof import('child_process');
		const env = parseEnvVars(envVars);
		const pathEnv = env['PATH'] ? { ...process.env, PATH: env['PATH'] } : process.env;
		const result = execSync('which droid', { env: pathEnv as NodeJS.ProcessEnv, encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
		const resolved = result.trim();
		if (resolved) return resolved;
	} catch {
		// which failed or child_process unavailable (mobile), try common paths
	}

	for (const p of COMMON_PATHS) {
		try {
			// eslint-disable-next-line @typescript-eslint/no-require-imports
			const { statSync } = require('fs') as typeof import('fs');
			statSync(p);
			return p;
		} catch {
			// not found at this path
		}
	}

	return null;
}

export function parseEnvVars(envText: string): Record<string, string> {
	const result: Record<string, string> = {};
	for (const line of envText.split('\n')) {
		const trimmed = line.replace(/^export\s+/, '').trim();
		if (!trimmed || trimmed.startsWith('#')) continue;
		const eq = trimmed.indexOf('=');
		if (eq === -1) continue;
		const key = trimmed.slice(0, eq).trim();
		let value = trimmed.slice(eq + 1).trim();
		// Strip surrounding quotes
		if ((value.startsWith('"') && value.endsWith('"')) ||
			(value.startsWith("'") && value.endsWith("'"))) {
			value = value.slice(1, -1);
		}
		if (key) result[key] = value;
	}
	return result;
}
