import type { SessionCommandDefinition } from "./sessionCommands";
import type { AnnotationTool, InkDrawingMode, InkToolKind, ShapeLineStyle, ShapeOptions, ToolPresetKind } from "../types";

export interface ToolCommandSession {
	selectToolFromCommand(tool: AnnotationTool): void;
	setInkToolDrawingMode(kind: InkToolKind, mode: InkDrawingMode): void;
	setInkToolLineStyle(kind: InkToolKind, style: ShapeLineStyle): void;
	chooseToolPreset(kind: ToolPresetKind, index: number): void;
	configureShapeTool(options: Partial<ShapeOptions>): void;
	reshapeSelectedShapes(kind: "circle" | "square" | "equilateral" | "right"): void;
}

/** Normal Obsidian commands so users manage all shortcuts in Settings → Hotkeys. */
export function toolCommandDefinitions<TSession extends ToolCommandSession>(): SessionCommandDefinition<TSession>[] {
	const definitions: SessionCommandDefinition<TSession>[] = [];
	for (const [tool, label] of [["pen", "Pen"], ["highlighter", "Highlighter"], ["eraser", "Eraser"], ["select", "Select"], ["text", "Text"], ["region", "Region capture"]] as const) {
		definitions.push({ id: `tool-select-${tool}`, name: `Tool: select ${label}`, run: session => session.selectToolFromCommand(tool) });
	}
	for (const [kind, label] of [["pen", "Pen"], ["highlighter", "Highlighter"]] as const) {
		for (const [mode, name] of [["freehand", "Freehand"], ["straight", "Straight line"]] as const) definitions.push({ id: `tool-${kind}-${mode}`, name: `${label}: ${name}`, run: session => session.setInkToolDrawingMode(kind, mode) });
		for (const [style, name] of [["solid", "Solid"], ["dashed", "Dashed"], ["dotted", "Dotted"], ["wavy", "Wavy"]] as const) definitions.push({ id: `tool-${kind}-line-${style}`, name: `${label}: ${name} line`, run: session => session.setInkToolLineStyle(kind, style) });
	}
	for (const [kind, label] of [["pen", "Pen"], ["highlighter", "Highlighter"], ["eraser", "Eraser"]] as const) for (let index = 0; index < 3; index++) definitions.push({ id: `tool-${kind}-preset-${index + 1}`, name: `${label}: preset ${index + 1}`, run: session => session.chooseToolPreset(kind, index) });
	definitions.push({ id: "shape-method-hold", name: "Shapes: Draw and hold", run: session => session.configureShapeTool({ method: "hold", shape: "auto" }) });
	definitions.push({ id: "shape-method-drag", name: "Shapes: Drag to size", run: session => session.configureShapeTool({ method: "drag" }) });
	for (const [shape, name] of [["line", "Line"], ["rectangle", "Rectangle"], ["ellipse", "Ellipse"], ["triangle", "Triangle"]] as const) definitions.push({ id: `shape-drag-${shape}`, name: `Shapes: Drag ${name}`, run: session => session.configureShapeTool({ method: "drag", shape }) });
	for (const [kind, name] of [["circle", "Circle"], ["square", "Square"], ["equilateral", "Equilateral triangle"], ["right", "Right-angle triangle or line"]] as const) definitions.push({ id: `reshape-selected-${kind}`, name: `Selected shape: ${name}`, run: session => session.reshapeSelectedShapes(kind) });
	return definitions;
}
