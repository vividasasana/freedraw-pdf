import type { AnnotationDocument } from "../types";
import { collectOcrGroups } from "./transforms";

/** Never include text belonging to unselected, changed or overlapping ink. */
export function recognisedSelectionText(document: AnnotationDocument, ids: ReadonlySet<string>): string | null {
	if (!ids.size) return null;
	const groups = collectOcrGroups(document, ids), covered = new Set<string>();
	for (const group of groups) {
		if (!group.text.trim()) return null;
		for (const id of group.strokeIds) {
			if (covered.has(id)) return null;
			covered.add(id);
		}
	}
	if (covered.size !== ids.size || [...ids].some(id => !covered.has(id))) return null;
	const top = (group: typeof groups[number]): number => Math.min(...group.lines.map(line => line.box.top));
	const left = (group: typeof groups[number]): number => Math.min(...group.lines.map(line => line.box.left));
	return groups.sort((a, b) => a.page - b.page || top(a) - top(b) || left(a) - left(b) || a.id.localeCompare(b.id))
		.map(group => group.text.trim()).join("\n");
}
