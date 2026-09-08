import type { AnnotationTool } from "../types";

const TOOL_KEYS: Record<string, AnnotationTool> = {
	"1": "pen", "2": "highlighter", "3": "eraser", "4": "select", "5": "text"
};

export function resolveToolShortcut(event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey" | "repeat" | "isComposing">): AnnotationTool | null {
	if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || event.repeat || event.isComposing) {
		return null;
	}
	return TOOL_KEYS[event.key] ?? null;
}
