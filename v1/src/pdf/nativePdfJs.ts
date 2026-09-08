import { loadPdfJs } from "obsidian";

export const PDF_JS_LOAD_ERROR_MESSAGE = "Obsidian PDF.js could not be loaded.";

export type NativePdfPage = {
	getViewport: (options: { scale: number }) => { width: number; height: number };
	render: (options: { canvasContext: CanvasRenderingContext2D; viewport: unknown }) => { promise: Promise<void> };
};

export type NativePdfDocument = {
	numPages: number;
	getPage: (pageNumber: number) => Promise<NativePdfPage>;
	destroy: () => Promise<void>;
};

type NativePdfLoadingTask = {
	promise: Promise<NativePdfDocument>;
	destroy: () => Promise<void>;
};

type NativePdfJsLib = {
	getDocument: (source: unknown) => NativePdfLoadingTask;
	GlobalWorkerOptions?: {
		workerSrc?: string;
	};
};

function isNativePdfJsLib(value: unknown): value is NativePdfJsLib {
	return typeof value === "object"
		&& value !== null
		&& typeof Reflect.get(value, "getDocument") === "function";
}

export async function loadNativePdfJs(): Promise<NativePdfJsLib> {
	try {
		const loadedPdfJs = await loadPdfJs();
		if (isNativePdfJsLib(loadedPdfJs)) {
			return loadedPdfJs;
		}
	} catch {
		// The caller renders a recoverable source-PDF link for this failure.
	}
	throw new Error(PDF_JS_LOAD_ERROR_MESSAGE);
}
