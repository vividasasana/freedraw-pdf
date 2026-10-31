import { normalizeShapeOptions } from "./shapeOptions";
import type { InkToolOptions, InkToolKind, ShapeInkStyle, ShapeOptions } from "../types";

export function normalizeInkToolOptions(value?: Partial<InkToolOptions>): InkToolOptions {
	const shape = normalizeShapeOptions({ method: "hold", shape: value?.holdShape, lineStyle: value?.lineStyle, waveSize: value?.waveSize });
	return {
		mode: value?.mode === "straight" ? "straight" : "freehand",
		holdShape: "auto",
		lineStyle: shape.lineStyle,
		waveSize: shape.waveSize
	};
}

export function normalizeInkToolOptionsByKind(value?: Partial<Record<InkToolKind, InkToolOptions>>): Record<InkToolKind, InkToolOptions> {
	return { pen: normalizeInkToolOptions(value?.pen), highlighter: normalizeInkToolOptions(value?.highlighter) };
}

/** Freeze the chosen behaviour and measured tool style at pointerdown. */
export function inkToolShapeOptions(kind: InkToolKind, value: InkToolOptions, style: ShapeInkStyle, shiftOverride = false): ShapeOptions | null {
	const options = normalizeInkToolOptions(value);
	if (!shiftOverride && options.mode === "freehand") return null;
	const method = !shiftOverride && options.mode === "hold" ? "hold" : "drag";
	return normalizeShapeOptions({
		method,
		shape: method === "hold" ? options.holdShape : "line",
		appearance: kind,
		lineStyle: shiftOverride ? "solid" : options.lineStyle,
		waveSize: options.waveSize,
		[kind]: { ...style }
	});
}
