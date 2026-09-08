import type {
	AnnotationDocument,
	EraserPathAnnotation,
	ImageAnnotation,
	NotebookPage,
	RemovedNotebookPage,
	ShapeAnnotation,
	StrokeAnnotation,
	TextAnnotation
} from "../types";

type PageAnnotation = StrokeAnnotation | EraserPathAnnotation | TextAnnotation | ShapeAnnotation | ImageAnnotation;

function shiftPages<T extends PageAnnotation>(items: T[], fromPage: number, delta: -1 | 1): T[] {
	return items.map((item) => item.page >= fromPage ? { ...item, page: item.page + delta } : item);
}

function removePage<T extends PageAnnotation>(items: T[], pageNumber: number): { kept: T[]; removed: T[] } {
	const kept: T[] = [];
	const removed: T[] = [];
	for (const item of items) {
		(item.page === pageNumber ? removed : kept).push(item);
	}
	return { kept, removed };
}

function setAnnotationPage<T extends PageAnnotation>(items: T[], pageNumber: number): T[] {
	return items.map((item) => ({ ...item, page: pageNumber }));
}

function ensurePageCollections(document: AnnotationDocument): void {
	document.appendedPages ??= [];
	document.eraserPaths ??= [];
	document.imageItems ??= [];
	document.deletedPdfPages ??= [];
	document.permanentlyDeletedPdfPages ??= [];
	document.removedPages ??= [];
}

export function insertSyntheticPage(
	document: AnnotationDocument,
	realPdfPageCount: number,
	insertIndex: number,
	page: NotebookPage
): number {
	ensurePageCollections(document);
	const pages = document.appendedPages!;
	const boundedIndex = Math.max(0, Math.min(Math.round(insertIndex), pages.length));
	const pageNumber = Math.max(0, realPdfPageCount) + boundedIndex + 1;
	document.strokes = shiftPages(document.strokes, pageNumber, 1);
	document.eraserPaths = shiftPages(document.eraserPaths!, pageNumber, 1);
	document.textItems = shiftPages(document.textItems, pageNumber, 1);
	document.shapes = shiftPages(document.shapes, pageNumber, 1);
	document.imageItems = shiftPages(document.imageItems!, pageNumber, 1);
	pages.splice(boundedIndex, 0, page);
	return pageNumber;
}

export function removeSyntheticPageToTrash(
	document: AnnotationDocument,
	realPdfPageCount: number,
	pageIndex: number,
	removedAt = new Date().toISOString()
): RemovedNotebookPage | null {
	ensurePageCollections(document);
	const pages = document.appendedPages!;
	if (pageIndex < 0 || pageIndex >= pages.length) {
		return null;
	}
	const pageNumber = Math.max(0, realPdfPageCount) + pageIndex + 1;
	const strokeResult = removePage(document.strokes, pageNumber);
	const eraserResult = removePage(document.eraserPaths!, pageNumber);
	const textResult = removePage(document.textItems, pageNumber);
	const shapeResult = removePage(document.shapes, pageNumber);
	const imageResult = removePage(document.imageItems!, pageNumber);
	const [page] = pages.splice(pageIndex, 1);
	const removedPage: RemovedNotebookPage = {
		page,
		originalIndex: pageIndex,
		removedAt,
		annotations: {
			strokes: strokeResult.removed,
			eraserPaths: eraserResult.removed,
			textItems: textResult.removed,
			shapes: shapeResult.removed,
			imageItems: imageResult.removed
		}
	};
	document.strokes = shiftPages(strokeResult.kept, pageNumber + 1, -1);
	document.eraserPaths = shiftPages(eraserResult.kept, pageNumber + 1, -1);
	document.textItems = shiftPages(textResult.kept, pageNumber + 1, -1);
	document.shapes = shiftPages(shapeResult.kept, pageNumber + 1, -1);
	document.imageItems = shiftPages(imageResult.kept, pageNumber + 1, -1);
	document.removedPages = document.removedPages!.filter((entry) => entry.page.id !== page.id);
	document.removedPages.push(removedPage);
	return removedPage;
}

export function restoreSyntheticPageFromTrash(
	document: AnnotationDocument,
	realPdfPageCount: number,
	pageId: string
): number | null {
	ensurePageCollections(document);
	const removedIndex = document.removedPages!.findIndex((entry) => entry.page.id === pageId);
	if (removedIndex < 0) {
		return null;
	}
	const [removedPage] = document.removedPages!.splice(removedIndex, 1);
	const pageNumber = insertSyntheticPage(
		document,
		realPdfPageCount,
		Math.max(0, Math.min(removedPage.originalIndex, document.appendedPages!.length)),
		removedPage.page
	);
	document.strokes.push(...setAnnotationPage(removedPage.annotations.strokes, pageNumber));
	document.eraserPaths!.push(...setAnnotationPage(removedPage.annotations.eraserPaths, pageNumber));
	document.textItems.push(...setAnnotationPage(removedPage.annotations.textItems, pageNumber));
	document.shapes.push(...setAnnotationPage(removedPage.annotations.shapes, pageNumber));
	document.imageItems!.push(...setAnnotationPage(removedPage.annotations.imageItems, pageNumber));
	return pageNumber;
}

export function permanentlyDeleteRemovedPage(document: AnnotationDocument, pageId: string): boolean {
	ensurePageCollections(document);
	const previousLength = document.removedPages!.length;
	document.removedPages = document.removedPages!.filter((entry) => entry.page.id !== pageId);
	return document.removedPages.length !== previousLength;
}

export function hidePdfPage(document: AnnotationDocument, pageNumber: number): boolean {
	ensurePageCollections(document);
	const normalizedPage = Math.max(1, Math.round(pageNumber));
	if (document.deletedPdfPages!.includes(normalizedPage) || document.permanentlyDeletedPdfPages!.includes(normalizedPage)) {
		return false;
	}
	document.deletedPdfPages!.push(normalizedPage);
	document.deletedPdfPages!.sort((left, right) => left - right);
	return true;
}

export function restorePdfPage(document: AnnotationDocument, pageNumber: number): boolean {
	ensurePageCollections(document);
	const normalizedPage = Math.max(1, Math.round(pageNumber));
	if (document.permanentlyDeletedPdfPages!.includes(normalizedPage)) {
		return false;
	}
	const previousLength = document.deletedPdfPages!.length;
	document.deletedPdfPages = document.deletedPdfPages!.filter((page) => page !== normalizedPage);
	return document.deletedPdfPages.length !== previousLength;
}

export function permanentlyDeleteHiddenPdfPage(document: AnnotationDocument, pageNumber: number): boolean {
	ensurePageCollections(document);
	const normalizedPage = Math.max(1, Math.round(pageNumber));
	const wasHidden = document.deletedPdfPages!.includes(normalizedPage);
	const wasPermanent = document.permanentlyDeletedPdfPages!.includes(normalizedPage);
	if (!wasHidden && wasPermanent) {
		return false;
	}
	document.deletedPdfPages = document.deletedPdfPages!.filter((page) => page !== normalizedPage);
	if (!wasPermanent) {
		document.permanentlyDeletedPdfPages!.push(normalizedPage);
		document.permanentlyDeletedPdfPages!.sort((left, right) => left - right);
	}
	return true;
}
