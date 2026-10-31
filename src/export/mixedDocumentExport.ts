import { App, Notice, TFile } from "obsidian";
import { renderAnnotationDocumentPage, renderAnnotationDocumentPageImages } from "../markdown/embedRender";
import { getNotebookPageRenderDimensions, getNotebookPageSizeDimensions, hasEditableNativePageTemplates } from "../notebook/pageModel";
import { drawTemplatePageBackground } from "../notebook/templateCanvas";
import { dataUrlToArrayBuffer, getBaseName } from "../utils/general";
import { buildPdfWithOverlays, type PdfDisplayBox } from "./preservedPdfWriter";
import type { AnnotationDocument, MixedPageEntry } from "../types";
import { selectableTextRuns } from "../text/selectableRuns";
import { selectableOcrTextRuns } from "../ocr/layout";

const EXPORT_PAGE_WIDTH_PX = 1600;

export interface NativeMixedWorkingPdfResult {
	file: TFile;
	pageMap: Map<number, number>;
}

async function createUniquePdfFile(app: App, sourceFile: TFile, bytes: Uint8Array, suffix: string): Promise<TFile> {
	const folder=sourceFile.parent?.path?.replace(/^\/+|\/+$/g, "") ?? "";
	const folderPrefix = folder ? `${folder}/` : "";
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

async function renderPdfPageToCanvas(box: PdfDisplayBox, annotationDocument: AnnotationDocument, pageNumber: number, realPdfPageCount: number, includeAnnotations: boolean): Promise<HTMLCanvasElement> {
	const sideways = box.rotation === 90 || box.rotation === 270;
	const width = sideways ? box.height : box.width;
	const height = sideways ? box.width : box.height;
	const canvas = createEl("canvas");
	canvas.width = EXPORT_PAGE_WIDTH_PX;
	canvas.height = Math.max(1, Math.round(EXPORT_PAGE_WIDTH_PX * height / width));
	const context = canvas.getContext("2d");
	if (!context) {
		throw new Error("Could not create export canvas.");
	}
	// Remain transparent: printed text and vector graphics stay in the source page.
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
	sourceFile: TFile,
	annotationDocument: AnnotationDocument,
	mixedEntries: MixedPageEntry[],
	realPdfPageCount: number,
	includeAnnotations: boolean
): Promise<{ pdfBytes: Uint8Array; pageMap: Map<number, number> }> {
	const binary = await app.vault.adapter.readBinary(sourceFile.path);
	return buildPdfWithOverlays(new Uint8Array(binary), mixedEntries.map(entry => entry.pageNumber), async (pageNumber, box) => {
		if (Boolean(box) !== (pageNumber <= realPdfPageCount)) throw new Error("The source PDF changed. Reopen it before exporting.");
		const sideways = box?.rotation === 90 || box?.rotation === 270;
		const pageSize = annotationDocument.appendedPages?.[pageNumber - realPdfPageCount - 1]?.pageSize ?? "a4";
		const dimensions = getNotebookPageSizeDimensions(pageSize);
		const widthPt = box ? (sideways ? box.height : box.width) : pageSize === "letter" ? 612 : 595.276 * dimensions.width / 920;
		const heightPt = box ? (sideways ? box.width : box.height) : pageSize === "letter" ? 792 : widthPt * dimensions.height / dimensions.width;
		const hasAnnotations = includeAnnotations && [annotationDocument.strokes, annotationDocument.textItems, annotationDocument.shapes, annotationDocument.imageItems ?? []]
			.some(items => items.some(item => item.page === pageNumber));
		const hasTemplate = box && hasEditableNativePageTemplates(annotationDocument, realPdfPageCount)
			&& annotationDocument.pdfPageTemplates?.some(template => template.page === pageNumber);
		if (box && !hasAnnotations && !hasTemplate) return { pngBytes: null, widthPt, heightPt };
		const canvas = box
			? await renderPdfPageToCanvas(box, annotationDocument, pageNumber, realPdfPageCount, includeAnnotations)
			: await renderSyntheticPageToCanvas(annotationDocument, pageNumber, realPdfPageCount, includeAnnotations);
		try {
			const context=canvas.getContext("2d");
			const items=includeAnnotations?annotationDocument.textItems.filter(item=>item.page===pageNumber):[];
			const textRuns=context&&includeAnnotations?[...items.flatMap(item=>selectableTextRuns(context,item,canvas.width,canvas.height)),...selectableOcrTextRuns(context,annotationDocument,pageNumber,canvas.width,canvas.height)]:[];
			return { pngBytes: new Uint8Array(dataUrlToArrayBuffer(canvas.toDataURL("image/png"))), widthPt, heightPt, textRuns };
		} finally {
			canvas.width = 0;
			canvas.height = 0;
		}
	});
}

export async function exportAnnotatedMixedDocumentPdf(
	app: App,
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
		const { pdfBytes } = await renderMixedPagesToPdfBytes(app, sourceFile, annotationDocument, mixedEntries, realPdfPageCount, true);
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
		const { pdfBytes, pageMap } = await renderMixedPagesToPdfBytes(app, sourceFile, annotationDocument, mixedEntries, realPdfPageCount, false);
		const file = await createUniquePdfFile(app, sourceFile, pdfBytes, "native mixed working");
		new Notice(`Created ${file.name}`);
		return { file, pageMap };
	} catch (error) {
		console.error("freedraw-pdf: failed to create native mixed working PDF", error);
		new Notice("Could not create native mixed working PDF.");
		return null;
	}
}
