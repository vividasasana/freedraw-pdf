import type { AnnotationDocument, NormalizedRect, StrokeAnnotation } from "../types";
import { ocrFingerprint, ocrSourceSnapshot, type OcrGroup } from "./model";

type Point = { x: number; y: number };
export type OcrTransform = (point: Point) => Point;
const clamp = (value: number): number => Math.max(0, Math.min(1, value));

/** Only a complete, still-valid recognition group can follow a geometric edit. */
export function collectOcrGroups(document: AnnotationDocument, ids: ReadonlySet<string>): OcrGroup[] {
	let byId: Map<string, StrokeAnnotation> | undefined;
	return (document.ocrGroups ?? []).filter(group => {
		if (!group.strokeIds.every(id => ids.has(id))) return false;
		byId ??= new Map(document.strokes.map(stroke => [stroke.id, stroke]));
		const source = group.strokeIds.map(id => byId!.get(id)).filter((stroke): stroke is StrokeAnnotation => !!stroke);
		return source.length === group.strokeIds.length && source.every(stroke => stroke.page === group.page && stroke.tool === "pen") && ocrFingerprint(ocrSourceSnapshot(source)) === group.sourceFingerprint;
	}).map(group => ({ ...group, strokeIds: [...group.strokeIds], lines: group.lines.map(line => ({ ...line, box: { ...line.box } })) }));
}

function transformBox(box: NormalizedRect, transform: OcrTransform): NormalizedRect | null {
	const a = transform({ x: box.left, y: box.top }), b = transform({ x: box.right, y: box.bottom });
	const next = { left: clamp(Math.min(a.x, b.x)), top: clamp(Math.min(a.y, b.y)), right: clamp(Math.max(a.x, b.x)), bottom: clamp(Math.max(a.y, b.y)) };
	return Object.values(next).every(Number.isFinite) && next.right > next.left && next.bottom > next.top ? next : null;
}

export function transformOcrGroups(document: AnnotationDocument, groups: OcrGroup[], transform: OcrTransform): void {
	const byId = new Map(document.strokes.map(stroke => [stroke.id, stroke]));
	const groupById = new Map((document.ocrGroups ?? []).map(group => [group.id, group]));
	for (const old of groups) {
		const group = groupById.get(old.id);
		const source = old.strokeIds.map(id => byId.get(id)).filter((stroke): stroke is StrokeAnnotation => !!stroke);
		if (!group || source.length !== old.strokeIds.length) continue;
		const lines = old.lines.map(line => ({ text: line.text, box: transformBox(line.box, transform) }));
		if (lines.some(line => !line.box)) continue;
		group.lines = lines.map(line => ({ text: line.text, box: line.box! }));
		group.sourceFingerprint = ocrFingerprint(ocrSourceSnapshot(source));
	}
}

/** Transfer transcript, line boxes and source IDs together; never issue another OCR request. */
export function cloneOcrGroups(document: AnnotationDocument, groups: OcrGroup[], sourceStrokes: StrokeAnnotation[], idMap: ReadonlyMap<string, string>, transform: OcrTransform, nextId: () => string): void {
	const bySourceId = new Map(sourceStrokes.map(stroke => [stroke.id, stroke]));
	const byTargetId = new Map(document.strokes.map(stroke => [stroke.id, stroke]));
	for (const group of groups) {
		if (!group.strokeIds.every(id => idMap.has(id))) continue;
		const originals = group.strokeIds.map(id => bySourceId.get(id)).filter((stroke): stroke is StrokeAnnotation => !!stroke);
		if (originals.length !== group.strokeIds.length || ocrFingerprint(ocrSourceSnapshot(originals)) !== group.sourceFingerprint) continue;
		// Clipping changes the handwriting, rather than simply moving it.
		if (originals.some(stroke => stroke.points.some(point => { const p = transform(point); return p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1; }))) continue;
		const ids = group.strokeIds.map(id => idMap.get(id)!);
		const copied = ids.map(id => byTargetId.get(id)).filter((stroke): stroke is StrokeAnnotation => !!stroke);
		if (copied.length !== ids.length) continue;
		const lines = group.lines.map(line => ({ text: line.text, box: transformBox(line.box, transform) }));
		if (lines.some(line => !line.box)) continue;
		const clone: OcrGroup = { ...group, id: nextId(), page: copied[0].page, strokeIds: ids, sourceFingerprint: ocrFingerprint(ocrSourceSnapshot(copied)), lines: lines.map(line => ({ text: line.text, box: line.box! })) };
		document.ocrGroups ??= [];
		document.ocrGroups.push(clone);
	}
}
