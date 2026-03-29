// Patch Electron renderer realm incompatibilities before any child_process usage
export function patchElectronCompat(): void {
	try {
		// Electron uses a different realm for Node built-ins; EventTarget.setMaxListeners
		// may be undefined in the renderer process
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const ET = EventTarget as any;
		if (typeof ET !== 'undefined' && !ET.prototype?.setMaxListeners) {
			ET.prototype.setMaxListeners = function () {};
		}
	} catch {
		// Ignore — patching is best-effort
	}
}
