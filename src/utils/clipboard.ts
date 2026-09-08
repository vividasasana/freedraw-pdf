export async function writeClipboardText(text: string): Promise<void> {
	const electronClipboard = (window as unknown as { require?: (moduleName: string) => { clipboard?: { writeText?: (value: string) => void } } }).require?.("electron")?.clipboard;
	if (electronClipboard?.writeText) {
		electronClipboard.writeText(text);
		return;
	}
	if (navigator.clipboard?.writeText) {
		await navigator.clipboard.writeText(text);
		return;
	}
	throw new Error("Clipboard write is unavailable in this Obsidian environment.");
}

export async function readClipboardText(): Promise<string> {
	const electronClipboard = (window as unknown as { require?: (moduleName: string) => { clipboard?: { readText?: () => string } } }).require?.("electron")?.clipboard;
	if (electronClipboard?.readText) {
		return electronClipboard.readText();
	}
	if (navigator.clipboard?.readText) {
		return navigator.clipboard.readText();
	}
	throw new Error("Clipboard read is unavailable in this Obsidian environment.");
}
