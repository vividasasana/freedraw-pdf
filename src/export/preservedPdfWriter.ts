import type { PDFPage } from "pdf-lib";
import { SelectableTextLayer } from "./selectableTextLayer";
import type { SelectableTextRun } from "../text/selectableRuns";

export interface PdfDisplayBox {
	x: number;
	y: number;
	width: number;
	height: number;
	rotation: number;
}

export interface PdfPageOverlay {
	textRuns?: SelectableTextRun[];
	pngBytes: Uint8Array | null;
	widthPt: number;
	heightPt: number;
}

/** The visible crop is the intersection of CropBox and MediaBox, before rotation. */
export function getPdfDisplayBox(page: PDFPage): PdfDisplayBox {
	const media = page.getMediaBox();
	const crop = page.getCropBox();
	const x = Math.max(media.x, crop.x);
	const y = Math.max(media.y, crop.y);
	const width = Math.min(media.x + media.width, crop.x + crop.width) - x;
	const height = Math.min(media.y + media.height, crop.y + crop.height) - y;
	if (width <= 0 || height <= 0) throw new Error("PDF page has an empty visible area.");
	const rotation = ((page.getRotation().angle % 360) + 360) % 360;
	if (rotation % 90 !== 0) throw new Error("Unsupported PDF page rotation.");
	return { x, y, width, height, rotation };
}

/** Map the upright viewer image back into the original page's PDF coordinates. */
export function getPdfOverlayPlacement(box: PdfDisplayBox): { x: number; y: number; width: number; height: number; rotation: number } {
	const { x, y, width, height, rotation } = box;
	const sideways = rotation === 90 || rotation === 270;
	return {
		x: x + (rotation === 90 || rotation === 180 ? width : 0),
		y: y + (rotation === 180 || rotation === 270 ? height : 0),
		width: sideways ? height : width,
		height: sideways ? width : height,
		rotation
	};
}

/** Retain page content/resources instead of replacing the source with page screenshots. */
export async function buildPdfWithOverlays(
	sourceBytes: Uint8Array,
	pageNumbers: readonly number[],
	renderOverlay: (pageNumber: number, box: PdfDisplayBox | null) => Promise<PdfPageOverlay>
): Promise<{ pdfBytes: Uint8Array; pageMap: Map<number, number> }> {
	if (!pageNumbers.length) throw new Error("Cannot export an empty document.");
	// Initialize the PDF editor only for an explicit export, outside the ink path.
	const { PDFDocument, PDFName, degrees } = await import("pdf-lib");
	// Work on a parsed copy. Retaining this catalog/page objects also preserves native
	// fonts, text mappings, page annotations, and links between retained source pages.
	const output = await PDFDocument.load(sourceBytes.slice(), { updateMetadata: false });
	const originalPages = output.getPages();
	const textLayer = new SelectableTextLayer(output);
	// Source pages may inherit these from a nested page tree. Materialize them
	// before reparenting pages, or a mixed-order export can lose fonts/crops/rotation.
	for (const page of originalPages) {
		for (const key of ["Resources", "MediaBox", "CropBox", "Rotate"]) {
			const name = PDFName.of(key);
			const value = page.node.getInheritableAttribute(name);
			if (value && !page.node.has(name)) page.node.set(name, value);
		}
	}
	for (let index = originalPages.length - 1; index >= 0; index--) output.removePage(index);
	const pageMap = new Map<number, number>();
	for (const pageNumber of pageNumbers) {
		if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageMap.has(pageNumber)) throw new Error("Invalid or repeated export page.");
		const original = originalPages[pageNumber - 1];
		const box = original ? getPdfDisplayBox(original) : null;
		const overlay = await renderOverlay(pageNumber, box);
		const page = original ? output.addPage(original) : output.addPage([overlay.widthPt, overlay.heightPt]);
		if (overlay.pngBytes) {
			const image = await output.embedPng(overlay.pngBytes);
			const placement = box ? getPdfOverlayPlacement(box) : { x: 0, y: 0, width: overlay.widthPt, height: overlay.heightPt, rotation: 0 };
			page.drawImage(image, { x: placement.x, y: placement.y, width: placement.width, height: placement.height, rotate: degrees(placement.rotation) });
		}
		pageMap.set(pageNumber, output.getPageCount());
		await textLayer.add(page,overlay.textRuns??[],box);
	}
	await textLayer.finish();
	return { pdfBytes: await output.save(), pageMap };
}
