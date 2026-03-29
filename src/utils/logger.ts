const PREFIX = '[Droidian]';

function ts(): string {
	return new Date().toISOString().slice(11, 23); // HH:MM:SS.mmm
}

export const log = {
	info: (msg: string, ...args: unknown[]) => console.log(`${PREFIX} ${ts()} ${msg}`, ...args),
	warn: (msg: string, ...args: unknown[]) => console.warn(`${PREFIX} ${ts()} ${msg}`, ...args),
	error: (msg: string, ...args: unknown[]) => console.error(`${PREFIX} ${ts()} ${msg}`, ...args),
};
