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

export function getNativePdfJs(): NativePdfJsLib {
	const pdfjsLib = (window as unknown as { pdfjsLib?: NativePdfJsLib }).pdfjsLib;
	if (!pdfjsLib?.getDocument) {
		throw new Error("Obsidian PDF.js is not available yet. Open a PDF once, then retry this action.");
	}
	return pdfjsLib;
}
