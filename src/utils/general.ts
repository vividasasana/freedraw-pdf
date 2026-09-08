import type { TFile } from "obsidian";

export function generateId(prefix: string): string {
	return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

export function getBaseName(file: TFile): string {
	const extensionWithDot = `.${file.extension}`;
	return file.name.endsWith(extensionWithDot)
		? file.name.slice(0, -extensionWithDot.length)
		: file.basename;
}

export function dataUrlToArrayBuffer(dataUrl: string): ArrayBuffer {
	const base64 = dataUrl.split(",")[1] ?? "";
	const binary = window.atob(base64);
	const bytes = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index += 1) {
		bytes[index] = binary.charCodeAt(index);
	}
	return bytes.buffer;
}
