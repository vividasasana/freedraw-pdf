import type { TFile } from "obsidian";
import { generateId } from "../utils/general";
import type { AnnotationDocument, NotebookPage, NotebookPageSize, NotebookTemplate } from "../types";

export function hasEditableNativePageTemplates(document: AnnotationDocument, realPdfPageCount: number): boolean {
	if (document.nativePageTemplatesEditable === true) {
		return true;
	}
	if (document.nativePageTemplatesEditable === false || realPdfPageCount < 1) {
		return false;
	}
	const templatePages = new Set((document.pdfPageTemplates ?? []).map((template) => template.page));
	if (templatePages.size !== realPdfPageCount) {
		return false;
	}
	for (let pageNumber = 1; pageNumber <= realPdfPageCount; pageNumber += 1) {
		if (!templatePages.has(pageNumber)) {
			return false;
		}
	}
	return true;
}

export function createTemplateNotebookPage(
	title: string,
	template: NotebookTemplate,
	pageSize: NotebookPageSize,
	paperColor: string
): NotebookPage {
	return {
		id: generateId("page"),
		title,
		kind: "template",
		sourceLabel: "Template page",
		template,
		paperColor,
		pageSize,
		strokes: [],
		textItems: [],
		shapes: []
	};
}

export function createPdfBackedNotebookPage(
	title: string,
	sourceFile: TFile,
	sourcePage: number,
	pageSize: NotebookPageSize,
	paperColor: string
): NotebookPage {
	return {
		id: generateId("page"),
		title,
		kind: "pdf",
		sourceLabel: `${sourceFile.name} page ${sourcePage}`,
		pdfSource: {
			filePath: sourceFile.path,
			page: sourcePage
		},
		template: "blank",
		paperColor,
		pageSize,
		strokes: [],
		textItems: [],
		shapes: []
	};
}

export function getNotebookPageKindLabel(page: NotebookPage): string {
	if (page.kind === "pdf" && page.pdfSource) {
		return `PDF page ${page.pdfSource.page}`;
	}
	return "Template page";
}

export function getNotebookPageSourceSummary(page: NotebookPage): string {
	if (page.kind === "pdf" && page.pdfSource) {
		const fileName = page.pdfSource.filePath.split("/").pop()?.split("\\").pop() ?? page.pdfSource.filePath;
		return `${fileName} p.${page.pdfSource.page}`;
	}
	return getNotebookTemplateLabel(page.template);
}

export function getNotebookTemplateLabel(template: NotebookTemplate): string {
	switch (template) {
		case "blank":
			return "Blank";
		case "grid":
			return "Grid";
		case "dot":
			return "Dot grid";
		case "ruled":
		default:
			return "Ruled lines";
	}
}

export function getNotebookPageSizeLabel(pageSize: NotebookPageSize): string {
	switch (pageSize) {
		case "compact":
			return "Compact";
		case "letter":
			return "Letter portrait";
		case "long":
			return "Long notes";
		case "a4":
		default:
			return "A4 portrait";
	}
}

export function getNotebookPageSizeDimensions(pageSize: NotebookPageSize): { width: number; height: number } {
	switch (pageSize) {
		case "compact":
			return { width: 700, height: 980 };
		case "letter":
			return { width: 920, height: 1189 };
		case "long":
			return { width: 920, height: 1500 };
		case "a4":
		default:
			return { width: 920, height: 1301 };
	}
}

export function getNotebookPageRenderDimensions(pageSize: NotebookPageSize, a4ReferenceWidth: number): { width: number; height: number } {
	const dimensions = getNotebookPageSizeDimensions(pageSize);
	const a4Dimensions = getNotebookPageSizeDimensions("a4");
	const width = Math.max(1, Math.round(a4ReferenceWidth * dimensions.width / Math.max(a4Dimensions.width, 1)));
	const height = Math.max(1, Math.round(width * dimensions.height / Math.max(dimensions.width, 1)));
	return { width, height };
}
