import { getNotebookTemplateLabel } from "../notebook/pageModel";
import type { MixedPageEntry } from "../types";

const templateClasses = ["is-template-blank", "is-template-ruled", "is-template-grid", "is-template-dot"];

export function clearNativeTemplateThumbnail(thumbnail: HTMLElement): void {
	if (!thumbnail.classList.contains("pdf-native-annotator-native-template-thumbnail")) return;
	thumbnail.querySelector(".pdf-native-annotator-native-template-paper")?.remove();
	thumbnail.querySelector(".pdf-native-annotator-native-template-count")?.remove();
	thumbnail.classList.remove("pdf-native-annotator-native-template-thumbnail", "pdf-native-annotator-native-thumbnail", ...templateClasses);
	thumbnail.style.removeProperty("--page-list-paper");
}

/** Decorate plugin-created template PDFs while keeping their native link, image and page number. */
export function syncNativeTemplateThumbnail(thumbnail: HTMLElement, entry?: MixedPageEntry): void {
	if (!entry?.template) { clearNativeTemplateThumbnail(thumbnail); return; }
	thumbnail.classList.remove(...templateClasses);
	thumbnail.classList.add("pdf-native-annotator-native-thumbnail", "pdf-native-annotator-native-template-thumbnail", `is-template-${entry.template}`);
	thumbnail.setCssProps({ "--page-list-paper": entry.paperColor ?? "#fffdf7" });
	let paper = thumbnail.querySelector<HTMLElement>(".pdf-native-annotator-native-template-paper");
	if (!paper) {
		paper = thumbnail.createDiv({ cls: "pdf-native-annotator-native-thumbnail-paper pdf-native-annotator-native-template-paper" });
		paper.createDiv({ cls: "pdf-native-annotator-native-thumbnail-pattern" });
		paper.createSpan({ cls: "pdf-native-annotator-native-thumbnail-kind" }).setAttribute("aria-hidden", "true");
	}
	const label = getNotebookTemplateLabel(entry.template), kind = paper.querySelector<HTMLElement>(".pdf-native-annotator-native-thumbnail-kind");
	if (kind && kind.textContent !== label) kind.textContent = label;
	paper.title = entry.detail;
	let count = thumbnail.querySelector<HTMLElement>(".pdf-native-annotator-native-template-count");
	if (entry.annotationCount > 0) {
		count ??= thumbnail.createSpan({ cls: "pdf-native-annotator-native-thumbnail-count pdf-native-annotator-native-template-count" });
		if (count.textContent !== String(entry.annotationCount)) count.textContent = String(entry.annotationCount);
	} else count?.remove();
}
