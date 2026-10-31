import type { TextAnnotation } from "../types";
import { selectableTextRuns } from "./selectableRuns";
import { getRenderedTextFontSize, resolveTextFontStyle, resolveTextFontWeight, TEXT_LAYOUT_REFERENCE_WIDTH } from "./textLayout";

/** Invisible native text follows the existing visual text; it never edits the sidecar. */
export function syncReadOnlyTextLayer(host: HTMLElement, items: readonly TextAnnotation[], width: number, height: number, annotationMode: boolean): void {
	let layer = host.querySelector<HTMLElement>(":scope > .freedraw-pdf-readonly-text-layer");
	if (annotationMode || !items.length) { layer?.remove(); return; }
	const aspect = height / Math.max(width, 1);
	const signature = JSON.stringify([items, aspect]);
	if (layer?.dataset.signature === signature) return;
	// Document.createEl/createDiv append to the document in Obsidian; canvas must stay detached.
	const context = host.ownerDocument.createElement("canvas").getContext("2d");
	if (!context) return;
	if (!layer) {
		layer = host.createDiv({cls: "freedraw-pdf-readonly-text-layer"});
		for (const type of ["pointerdown", "pointermove", "pointerup", "touchstart", "touchmove", "touchend", "dblclick"]) layer.addEventListener(type, event => event.stopPropagation());
	}
	layer.replaceChildren(); layer.dataset.signature = signature;
	const referenceHeight = TEXT_LAYOUT_REFERENCE_WIDTH * aspect;
	for (const item of items) {
		const fontScale = getRenderedTextFontSize(item.fontScale && item.fontScale > 0 ? item.fontScale : item.fontSize / TEXT_LAYOUT_REFERENCE_WIDTH, TEXT_LAYOUT_REFERENCE_WIDTH) / TEXT_LAYOUT_REFERENCE_WIDTH;
		for (const run of selectableTextRuns(context, item, TEXT_LAYOUT_REFERENCE_WIDTH, referenceHeight)) {
			const text = layer.createSpan({cls: "freedraw-pdf-readonly-text", text: run.text});
			text.setCssStyles({left: `${run.x * 100}%`, top: `${run.y * 100}%`, height: `${run.height * 100}%`, fontFamily: `"${(item.fontFamily ?? "Arial").replace(/["\\]/g, "")}", sans-serif`, fontWeight: resolveTextFontWeight(item), fontStyle: resolveTextFontStyle(item)});
			text.setCssProps({"--freedraw-readonly-font": String(fontScale)});
			text.setAttribute("data-annotation-id", item.id);
		}
	}
}
