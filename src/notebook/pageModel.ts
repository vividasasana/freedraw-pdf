import { generateId } from "../utils/general";
import type { AnnotationDocument, NotebookPage, NotebookPageSize, NotebookTemplate } from "../types";

export const NOTEBOOK_TEMPLATES: readonly NotebookTemplate[] = ["blank", "ruled", "grid", "dot"];
export const NOTEBOOK_PAGE_SIZES: readonly NotebookPageSize[] = ["a4", "letter", "compact", "long"];

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
