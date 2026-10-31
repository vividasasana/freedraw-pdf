import type { AnnotationTool, InkToolKind, InkToolOptions, ShapeOptions } from "../types";

export interface ContextualToolControl { id: string; label: string; title: string; run: () => void; }
export interface ContextualToolActions {
	ink: (kind: InkToolKind, patch: Partial<InkToolOptions>) => void;
	shape: (patch: Partial<ShapeOptions>) => void;
}
const nextValue = <T>(values: readonly T[], current: T): T => values[(values.indexOf(current) + 1) % values.length];
const lineStyles = ["solid", "dashed", "dotted", "wavy"] as const;
const label = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

/** Discrete options cycle; controls depend only on the active tool's preferences. */
export function contextualToolControls(tool: AnnotationTool, ink: InkToolOptions | undefined, shape: ShapeOptions, actions: ContextualToolActions): ContextualToolControl[] {
	const controls: ContextualToolControl[] = [];
	const add = (id: string, text: string, title: string, run: () => void) => controls.push({ id, label: text, title, run });
	const wave = (value: number, run: (size: number) => void) => add("wave-size", `Wave ${value}`, "Wave size. Click to cycle sizes.", () => run(nextValue([.25, .5, .75, 1, 1.5, 2, 3, 4, 6], value)));
	if ((tool === "pen" || tool === "highlighter") && ink) {
		add("drawing-mode", ink.mode === "straight" ? "Straight line" : "Freehand", "Drawing mode. Click to switch Freehand / Straight line.", () => actions.ink(tool, { mode: ink.mode === "straight" ? "freehand" : "straight" }));
		if (ink.mode === "straight") {
			add("line-style", label(ink.lineStyle), "Line style. Click to cycle Solid, Dashed, Dotted and Wavy.", () => actions.ink(tool, { lineStyle: nextValue(lineStyles, ink.lineStyle) }));
			if (ink.lineStyle === "wavy") wave(ink.waveSize, waveSize => actions.ink(tool, { waveSize }));
		}
	} else if (["line", "rectangle", "ellipse", "triangle"].includes(tool)) {
		add("shape-method", shape.method === "drag" ? "Drag to size" : "Draw and hold", "Shape creation. Click to switch Draw and hold / Drag to size.", () => actions.shape({ method: shape.method === "drag" ? "hold" : "drag" }));
		if (shape.method === "drag") {
			add("shape-type", label(shape.shape), "Drag shape. Click to cycle Line, Rectangle, Ellipse and Triangle.", () => actions.shape({ shape: nextValue(["line", "rectangle", "ellipse", "triangle"] as const, shape.dragShape ?? "line") }));
			if (shape.shape === "line") {
				add("line-style", label(shape.lineStyle), "Line style. Click to cycle Solid, Dashed, Dotted and Wavy.", () => actions.shape({ lineStyle: nextValue(lineStyles, shape.lineStyle) }));
			}
		}
	}
	return controls;
}
