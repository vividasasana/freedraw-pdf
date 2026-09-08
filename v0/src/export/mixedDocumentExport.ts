import { App, Notice, TFile } from "obsidian";
import { renderAnnotationDocumentPage, renderAnnotationDocumentPageImages } from "../markdown/embedRender";
import { getNotebookPageRenderDimensions, hasEditableNativePageTemplates } from "../notebook/pageModel";
import { drawTemplatePageBackground } from "../notebook/templateCanvas";
import { getNativePdfJs, type NativePdfDocument } from "../pdf/nativePdfJs";
import { dataUrlToArrayBuffer, getBaseName } from "../utils/general";
import { buildPdfFromJpegPages, type PdfImagePage } from "./simplePdfWriter";
import type { AnnotationDocument, MixedPageEntry } from "../types";

export type MixedDocumentExportHost = object;

const EXPORT_PAGE_WIDTH_PX = 1600;
const EXPORT_JPEG_QUALITY = 0.92;

export interface NativeMixedWorkingPdfResult {
	file: TFile;
	pageMap: Map<number, number>;
}

function uint8FromArrayBuffer(buffer: ArrayBuffer): Uint8Array {
	return new Uint8Array(buffer);
}

async function createUniquePdfFile(app: App, sourceFile: TFile, bytes: Uint8Array, suffix: string): Promise<TFile> {
	const folderPrefix = sourceFile.parent?.path ? `${sourceFile.parent.path}/` : "";
	const baseName = `${getBaseName(sourceFile)} ${suffix}`;
	let outputPath = `${folderPrefix}${baseName}.pdf`;
	let counter = 2;
	while (app.vault.getAbstractFileByPath(outputPath)) {
		outputPath = `${folderPrefix}${baseName} ${counter}.pdf`;
		counter += 1;
	}
	const buffer = new ArrayBuffer(bytes.byteLength);
	new Uint8Array(buffer).set(bytes);
	return app.vault.createBinary(outputPath, buffer);
}

function canvasToJpegPage(canvas: HTMLCanvasElement): PdfImagePage {
	const jpegBytes = uint8FromArrayBuffer(dataUrlToArrayBuffer(canvas.toDataURL("image/jpeg", EXPORT_JPEG_QUALITY)));
	return {
		widthPx: canvas.width,
		heightPx: canvas.height,
		jpegBytes
	};
}

async function renderSyntheticPageToCanvas(annotationDocument: AnnotationDocument, pageNumber: number, realPdfPageCount: number, includeAnnotations: boolean): Promise<HTMLCanvasElement> {
	const syntheticIndex = pageNumber - realPdfPageCount - 1;
	const syntheticPage = annotationDocument.appendedPages?.[syntheticIndex];
	if (!syntheticPage) {
		throw new Error(`Missing inserted notebook page ${pageNumber}.`);
	}
	const dimensions = getNotebookPageRenderDimensions(syntheticPage.pageSize, EXPORT_PAGE_WIDTH_PX);
	const canvas = createEl("canvas");
	canvas.width = dimensions.width;
	canvas.height = dimensions.height;
	const context = canvas.getContext("2d");
	if (!context) {
		throw new Error("Could not create export canvas.");
	}
	drawTemplatePageBackground(context, canvas.width, canvas.height, syntheticPage);
	if (includeAnnotations) {
		await renderAnnotationDocumentPageImages(context, annotationDocument, pageNumber, canvas.width, canvas.height);
		renderAnnotationDocumentPage(context, annotationDocument, pageNumber, canvas.width, canvas.height);
	}
	return canvas;
}

async function renderPdfPageToCanvas(pdfDocument: NativePdfDocument, annotationDocument: AnnotationDocument, pageNumber: number, realPdfPageCount: number, includeAnnotations: boolean): Promise<HTMLCanvasElement> {
	const pdfPage = await pdfDocument.getPage(pageNumber);
	const baseViewport = pdfPage.getViewport({ scale: 1 });
	const scale = EXPORT_PAGE_WIDTH_PX / Math.max(baseViewport.width, 1);
	const viewport = pdfPage.getViewport({ scale });
	const canvas = createEl("canvas");
	canvas.width = Math.max(1, Math.round(viewport.width));
	canvas.height = Math.max(1, Math.round(viewport.height));
	const context = canvas.getContext("2d");
	if (!context) {
		throw new Error("Could not create export canvas.");
	}
	context.fillStyle = "#ffffff";
	context.fillRect(0, 0, canvas.width, canvas.height);
	await pdfPage.render({ canvasContext: context, viewport }).promise;
	const pageTemplate = hasEditableNativePageTemplates(annotationDocument, realPdfPageCount)
		? annotationDocument.pdfPageTemplates?.find((template) => template.page === pageNumber)
		: null;
	if (pageTemplate) {
		drawTemplatePageBackground(context, canvas.width, canvas.height, {
			id: `pdf-template-${pageNumber}`,
			title: `Page ${pageNumber}`,
			kind: "template",
			template: pageTemplate.template,
			paperColor: pageTemplate.paperColor,
			pageSize: pageTemplate.pageSize,
			strokes: [],
			textItems: [],
			shapes: []
		});
	}
	if (includeAnnotations) {
		await renderAnnotationDocumentPageImages(context, annotationDocument, pageNumber, canvas.width, canvas.height);
		renderAnnotationDocumentPage(context, annotationDocument, pageNumber, canvas.width, canvas.height);
	}
	return canvas;
}

async function renderMixedPagesToPdfBytes(
	app: App,
	host: MixedDocumentExportHost,
	sourceFile: TFile,
	annotationDocument: AnnotationDocument,
	mixedEntries: MixedPageEntry[],
	realPdfPageCount: number,
	includeAnnotations: boolean
): Promise<{ pdfBytes: Uint8Array; pageMap: Map<number, number> }> {
	const binary = await app.vault.adapter.readBinary(sourceFile.path);
	const pdfjsLib = getNativePdfJs();
	const loadingTask = pdfjsLib.getDocument({
		data: new Uint8Array(binary),
		disableWorker: true,
		isEvalSupported: false,
		useWorkerFetch: false
	});

	try {
		const pdfDocument = await loadingTask.promise;
		const pages: PdfImagePage[] = [];
		const pageMap = new Map<number, number>();
		for (const entry of mixedEntries) {
			const canvas = entry.pageNumber <= pdfDocument.numPages
				? await renderPdfPageToCanvas(pdfDocument, annotationDocument, entry.pageNumber, realPdfPageCount, includeAnnotations)
				: await renderSyntheticPageToCanvas(annotationDocument, entry.pageNumber, realPdfPageCount, includeAnnotations);
			pages.push(canvasToJpegPage(canvas));
			pageMap.set(entry.pageNumber, pages.length);
		}
		return {
			pdfBytes: buildPdfFromJpegPages(pages),
			pageMap
		};
	} finally {
		await loadingTask.destroy();
	}
}

export async function exportAnnotatedMixedDocumentPdf(
	app: App,
	host: MixedDocumentExportHost,
	sourceFile: TFile,
	annotationDocument: AnnotationDocument,
	mixedEntries: MixedPageEntry[],
	realPdfPageCount: number
): Promise<TFile | null> {
	if (mixedEntries.length === 0) {
		new Notice("No pages available to export.");
		return null;
	}

	try {
		const { pdfBytes } = await renderMixedPagesToPdfBytes(app, host, sourceFile, annotationDocument, mixedEntries, realPdfPageCount, true);
		const outputFile = await createUniquePdfFile(app, sourceFile, pdfBytes, "annotated mixed");
		new Notice(`Exported ${outputFile.name}`);
		return outputFile;
	} catch (error) {
		console.error("freedraw-pdf: failed to export mixed annotated PDF", error);
		new Notice("Could not export annotated mixed PDF.");
		return null;
	}
}

export async function createNativeMixedWorkingPdf(
	app: App,
	host: MixedDocumentExportHost,
	sourceFile: TFile,
	annotationDocument: AnnotationDocument,
	mixedEntries: MixedPageEntry[],
	realPdfPageCount: number
): Promise<NativeMixedWorkingPdfResult | null> {
	if (mixedEntries.length === 0) {
		new Notice("No pages available to materialize.");
		return null;
	}
	try {
		const { pdfBytes, pageMap } = await renderMixedPagesToPdfBytes(app, host, sourceFile, annotationDocument, mixedEntries, realPdfPageCount, false);
		const file = await createUniquePdfFile(app, sourceFile, pdfBytes, "native mixed working");
		new Notice(`Created ${file.name}`);
		return { file, pageMap };
	} catch (error) {
		console.error("freedraw-pdf: failed to create native mixed working PDF", error);
		new Notice("Could not create native mixed working PDF.");
		return null;
	}
}
