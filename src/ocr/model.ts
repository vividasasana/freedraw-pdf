import type { AnnotationDocument, NormalizedRect, StrokeAnnotation } from "../types";

export type OcrProvider = "gemini" | "openai" | "local";
export interface OcrSettings { provider: OcrProvider; model: string; endpoint: string; language: string; showToolbarButton: boolean; copyHandwritingAsText?: boolean; }
export interface OcrLine { text: string; box: NormalizedRect; }
export interface OcrGroup {
	id: string; page: number; strokeIds: string[]; sourceFingerprint: string;
	text: string; lines: OcrLine[]; mode: "ink" | "text"; provider: string; createdAt: string;
}
export const DEFAULT_OCR_SETTINGS: OcrSettings = { provider: "gemini", model: "", endpoint: "", language: "English", showToolbarButton: true, copyHandwritingAsText: false };
export function normalizeOcrSettings(value: unknown): OcrSettings {
	const raw = value && typeof value === "object" ? value as Partial<OcrSettings> : {};
	return { copyHandwritingAsText: raw.copyHandwritingAsText === true, showToolbarButton: typeof raw.showToolbarButton === "boolean" ? raw.showToolbarButton : true, provider: raw.provider === "local" || raw.provider === "openai" ? raw.provider : "gemini",
		model: typeof raw.model === "string" ? raw.model.trim().slice(0, 150) : DEFAULT_OCR_SETTINGS.model,
		endpoint: typeof raw.endpoint === "string" ? raw.endpoint.trim().slice(0, 1000) : "",
		language: typeof raw.language === "string" && raw.language.trim() ? raw.language.trim().slice(0, 100) : "English" };
}
/** Exact immutable submission snapshot; compared again before a result is applied. */
export function ocrSourceSnapshot(strokes: readonly StrokeAnnotation[]): string {
	return JSON.stringify([...strokes].sort((a,b) => a.id<b.id?-1:a.id>b.id?1:0).map(stroke => {
		const { zIndex: _z, page: _page, createdAt: _time, ...ink } = stroke;
		return ink;
	}));
}
/** Compact display invalidation key, not a security hash. Job guards compare exact snapshots. */
export function ocrFingerprint(snapshot: string): string {
	// Legacy loading enriches per-stroke rendering preferences without changing ink.
	// Job guards still use the complete exact snapshot, including those preferences.
	const value=JSON.parse(snapshot) as Array<Record<string,unknown>>;
	for(const stroke of value)delete stroke.inkSettings;
	const stable=(v:unknown):string=>Array.isArray(v)?`[${v.map(stable).join(",")}]`:v&&typeof v==="object"?`{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${stable((v as Record<string,unknown>)[k])}`).join(",")}}`:JSON.stringify(v);
	snapshot=stable(value);
	let a = 2166136261, b = 3339675911;
	for (let i = 0; i < snapshot.length; i++) { a = Math.imul(a ^ snapshot.charCodeAt(i), 16777619); b = Math.imul(b ^ snapshot.charCodeAt(i), 2246822519); }
	return `${snapshot.length}:${a >>> 0}:${b >>> 0}`;
}
export function validOcrBox(value: unknown): value is NormalizedRect {
	if (!value || typeof value !== "object") return false;
	const b = value as NormalizedRect;
	return [b.left,b.top,b.right,b.bottom].every(Number.isFinite) && b.left >= 0 && b.top >= 0 && b.right <= 1 && b.bottom <= 1 && b.right > b.left && b.bottom > b.top;
}
export function normalizeOcrGroups(value: unknown): OcrGroup[] {
	if (!Array.isArray(value)) return [];
	const ids = new Set<string>();
	return value.slice(0,2000).filter((g): g is OcrGroup => {
		if (!g || typeof g !== "object" || typeof g.id !== "string" || ids.has(g.id) || !Number.isInteger(g.page) || g.page < 1 ||
			!Array.isArray(g.strokeIds) || !g.strokeIds.length || g.strokeIds.length > 2000 || !g.strokeIds.every((id:unknown) => typeof id === "string") || new Set(g.strokeIds).size !== g.strokeIds.length ||
			typeof g.sourceFingerprint !== "string" || typeof g.text !== "string" || g.text.length > 50000 || !Array.isArray(g.lines) || !g.lines.length || g.lines.length > 500 ||
			!g.lines.every((line: OcrLine) => line && typeof line.text === "string" && line.text.length <= 5000 && validOcrBox(line.box)) || (g.mode !== "ink" && g.mode !== "text")) return false;
		ids.add(g.id); return true;
	}).map(g => ({ id:g.id,page:g.page,strokeIds:[...g.strokeIds],sourceFingerprint:g.sourceFingerprint,text:g.text,lines:g.lines.map(l => ({text:l.text,box:{...l.box}})),mode:g.mode,provider:typeof g.provider === "string" ? g.provider.slice(0,150) : "Imported",createdAt:typeof g.createdAt === "string" ? g.createdAt : "" }));
}
/** Accepted recognition remains usable independently of its visible ink/text mode. */
export function getValidOcrGroups(document: AnnotationDocument, page: number, pageStrokes?: readonly StrokeAnnotation[], mode?: "ink" | "text"): OcrGroup[] {
	const candidates = (document.ocrGroups ?? []).filter(group => group.page === page && (!mode || group.mode === mode));
	if (!candidates.length) return [];
	const strokes = new Map((pageStrokes??document.strokes.filter(s => s.page === page)).map(s => [s.id,s]));
	return candidates.filter(group => {
		const source = group.strokeIds.map(id => strokes.get(id));
		return !source.some(stroke => !stroke || stroke.page !== page || stroke.tool !== "pen") && ocrFingerprint(ocrSourceSnapshot(source as StrokeAnnotation[])) === group.sourceFingerprint;
	});
}
export function getOcrPageView(document: AnnotationDocument, page: number, pageStrokes?:readonly StrokeAnnotation[]): { groups: OcrGroup[]; hiddenStrokeIds: Set<string> } {
	const groups = getValidOcrGroups(document, page, pageStrokes, "text"), hiddenStrokeIds = new Set<string>();
	for (const group of groups) for (const id of group.strokeIds) hiddenStrokeIds.add(id);
	return {groups,hiddenStrokeIds};
}
