import { App, Notice, TFile } from "obsidian";
import { ANNOTATION_FILE_SUFFIX, DEFAULT_SETTINGS } from "../config";
import { normalizeInkRenderSettings } from "../settings/settingsController";
import { getAnnotationRenderables } from "../annotation/renderOrder";
import { migrateLegacyEraserPaths, migrateStrokeEraseMasks } from "../annotation/eraser";
import { generateId } from "../utils/general";
import { chooseAnnotationFile, confirmAnnotationAction } from "./annotationFileDialogs";
import type { AnnotationCleanupScope, AnnotationFileResult } from "./annotationFileDialogs";
import type { AnnotationDocument, AnnotationLoadInfo, EraserPathAnnotation, InkRenderSettings, ShapeAnnotation, StrokeAnnotation, TextAnnotation } from "../types";

const DEFAULT_STROKE_REFERENCE_WIDTH = 1524;
const MAX_STROKE_WIDTH_SCALE = 0.08;
const MAX_TEXT_FONT_SCALE = 0.08;
const SCALE_DRIFT_TOLERANCE = 2.25;

function isAnnotationJson(path:string):boolean { return /\.annot(?: \(conflict [^)]+\))?\.json$/i.test(path); }
function filenamePdfPath(path:string):string { return path.replace(/\.annot(?: \(conflict [^)]+\))?\.json$/i, "").replace(/\.recovery-[^/]+$/, ""); }

function inCleanupScope(path: string, source: string, scope: AnnotationCleanupScope): boolean {
	if (scope.kind === "vault") return true;
	if (scope.kind === "folder") return !scope.path || path.startsWith(`${scope.path}/`);
	return source === scope.path || path === `${scope.path}${ANNOTATION_FILE_SUFFIX}` || path.startsWith(`${scope.path}.recovery-`);
}

function comparableStroke(stroke: StrokeAnnotation): string {
	// Loading legacy data normalizes ink settings; stacking indices are assigned
	// by the session and are not an edit to the handwriting itself.
	const value = { ...stroke } as Partial<StrokeAnnotation>;
	delete value.zIndex;
	delete value.id;
	delete value.createdAt;
	return canonicalValue(value);
}

function variantStrokeId(stroke: StrokeAnnotation): string {
	let hash = 2166136261;
	for (const character of comparableStroke(stroke)) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619) >>> 0;
	return `${stroke.id}--variant-${hash.toString(16)}`;
}

function pathHash(value: string): string {
	let hash = 2166136261;
	for (const character of value) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619) >>> 0;
	return hash.toString(16);
}

function canonicalValue(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonicalValue).join(",")}]`;
	if (value && typeof value === "object") {
		const record = value as Record<string, unknown>;
		return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonicalValue(record[key])}`).join(",")}}`;
	}
	return JSON.stringify(value) ?? "null";
}

function annotationContent(raw: string): string | null {
	try {
		const value = JSON.parse(raw) as Record<string, unknown>;
		if (!value || Array.isArray(value) || !Array.isArray(value.strokes)) return null;
		delete value.updatedAt;
		// Local filesystem timestamps can differ across synced devices. Preserve
		// source path/name/size checks while ignoring those device-local timestamps.
		if (value.sourcePdf && typeof value.sourcePdf === "object" && !Array.isArray(value.sourcePdf)) {
			const source = { ...value.sourcePdf as Record<string, unknown> };
			delete source.ctime;
			delete source.mtime;
			value.sourcePdf = source;
		}
		return canonicalValue(value);
	} catch { return null; }
}

function sameAnnotationContent(first: string | null, second: string | null): boolean {
	if (first === second) return true;
	if (first === null || second === null) return false;
	const content = annotationContent(first);
	return content !== null && content === annotationContent(second);
}

/** Merge only independent stroke additions; edits, deletions and other changes stay protected. */
function mergeStrokeAdditions(baseRaw: string, remoteRaw: string, localRaw: string): { payload: string; additions: StrokeAnnotation[] } | null {
	try {
		const base = JSON.parse(baseRaw) as AnnotationDocument;
		const remote = JSON.parse(remoteRaw) as AnnotationDocument;
		const local = JSON.parse(localRaw) as AnnotationDocument;
		if (![base, remote, local].every(doc => doc && Array.isArray(doc.strokes))) return null;
		const withoutStrokes = (doc: AnnotationDocument) => annotationContent(JSON.stringify({ ...doc, strokes: [] }));
		const baseline = withoutStrokes(base);
		if (baseline === null || baseline !== withoutStrokes(remote) || baseline !== withoutStrokes(local)) return null;
		const index = (strokes: StrokeAnnotation[]) => new Map(strokes.map(stroke => [stroke.id, stroke]));
		const baseIndex = index(base.strokes), remoteIndex = index(remote.strokes), localIndex = index(local.strokes);
		for (const [doc, map] of [[base, baseIndex], [remote, remoteIndex], [local, localIndex]] as const) {
			if (map.size !== doc.strokes.length || doc.strokes.some(stroke => typeof stroke.id !== "string" || !stroke.id)) return null;
		}
		for (const [id, stroke] of baseIndex) {
			if (canonicalValue(stroke) !== canonicalValue(remoteIndex.get(id)) || canonicalValue(stroke) !== canonicalValue(localIndex.get(id))) return null;
		}
		const additions: StrokeAnnotation[] = [];
		for (const [id, stroke] of remoteIndex) {
			const ours = localIndex.get(id);
			if (ours && canonicalValue(ours) !== canonicalValue(stroke)) return null;
			if (!ours) additions.push(stroke);
		}
		local.strokes.push(...additions);
		return { payload: JSON.stringify(local, null, 2), additions };
	} catch { return null; }
}

function getStableScale(width: number, maxScale: number, minScale: number): number {
	return Math.min(maxScale, Math.max(minScale, width / DEFAULT_STROKE_REFERENCE_WIDTH));
}

function isUsableStoredScale(width: number, scale: number | undefined, maxScale: number, minScale: number): boolean {
	if (scale === undefined || !Number.isFinite(scale) || scale <= 0 || scale > maxScale) {
		return false;
	}
	const fallback = getStableScale(width, maxScale, minScale);
	return scale <= fallback * SCALE_DRIFT_TOLERANCE;
}

export function getPdfIdentity(file: TFile): NonNullable<AnnotationDocument["sourcePdf"]> {
	return {
		path: file.path,
		name: file.name,
		basename: file.basename,
		size: file.stat.size,
		ctime: file.stat.ctime,
		mtime: file.stat.mtime
	};
}

export function createEmptyDocument(file: TFile): AnnotationDocument {
	return {
		version: 8,
		sourceFile: file.path,
		sourcePdf: getPdfIdentity(file),
		updatedAt: new Date().toISOString(),
		strokes: [],
		eraserPaths: [],
		textItems: [],
		shapes: [],
		imageItems: [],
		pdfPageTemplates: [],
		nativePageTemplatesEditable: false,
		appendedPages: [],
		deletedPdfPages: [],
		permanentlyDeletedPdfPages: [],
		removedPages: []
	};
}

export function cloneDocument(document: AnnotationDocument): AnnotationDocument {
	return JSON.parse(JSON.stringify(document)) as AnnotationDocument;
}

export function normalizeAnnotationZIndexes(
	strokes: StrokeAnnotation[],
	textItems: TextAnnotation[],
	shapes: ShapeAnnotation[],
	eraserPaths: EraserPathAnnotation[] = []
): boolean {
	let changed = false;
	const renderables = [
		...getAnnotationRenderables(strokes, textItems, shapes),
		...eraserPaths.map((annotation, index) => ({
			kind: "eraser" as const,
			annotation,
			fallbackOrder: 300000 + index
		}))
	].sort((left, right) =>
		(left.annotation.zIndex ?? left.fallbackOrder) - (right.annotation.zIndex ?? right.fallbackOrder)
	);
	renderables.forEach((renderable, index) => {
		if (renderable.annotation.zIndex !== index) {
			renderable.annotation.zIndex = index;
			changed = true;
		}
	});
	return changed;
}

export function normalizeDocumentZIndexes(document: AnnotationDocument): boolean {
	const pages = new Map<number, { strokes: StrokeAnnotation[]; textItems: TextAnnotation[]; shapes: ShapeAnnotation[]; eraserPaths: EraserPathAnnotation[] }>();
	const getPage = (page: number) => {
		let bucket = pages.get(page);
		if (!bucket) {
			bucket = { strokes: [], textItems: [], shapes: [], eraserPaths: [] };
			pages.set(page, bucket);
		}
		return bucket;
	};
	// Group once rather than scanning the entire document again for each page.
	for (const stroke of document.strokes) { getPage(stroke.page).strokes.push(stroke); }
	for (const item of document.textItems) { getPage(item.page).textItems.push(item); }
	for (const shape of document.shapes) { getPage(shape.page).shapes.push(shape); }
	for (const path of document.eraserPaths ?? []) { getPage(path.page).eraserPaths.push(path); }
	let changed = false;
	for (const page of pages.values()) {
		const pageChanged = normalizeAnnotationZIndexes(
			page.strokes, page.textItems, page.shapes, page.eraserPaths
		);
		changed = changed || pageChanged;
	}
	return changed;
}

export function normalizeDocumentStrokeScales(document: AnnotationDocument): boolean {
	let changed = false;
	for (const stroke of document.strokes) {
		if (!isUsableStoredScale(stroke.width, stroke.widthScale, MAX_STROKE_WIDTH_SCALE, 0.0005)) {
			stroke.widthScale = getStableScale(stroke.width, MAX_STROKE_WIDTH_SCALE, 0.0005);
			changed = true;
		}
	}
	for (const shape of document.shapes) {
		if (!isUsableStoredScale(shape.width, shape.widthScale, MAX_STROKE_WIDTH_SCALE, 0.0005)) {
			shape.widthScale = getStableScale(shape.width, MAX_STROKE_WIDTH_SCALE, 0.0005);
			changed = true;
		}
	}
	for (const textItem of document.textItems) {
		if (!isUsableStoredScale(textItem.fontSize, textItem.fontScale, MAX_TEXT_FONT_SCALE, 0.004)) {
			textItem.fontScale = getStableScale(textItem.fontSize, MAX_TEXT_FONT_SCALE, 0.004);
			changed = true;
		}
	}
	return changed;
}

export class AnnotationStore {
	private readonly baselines = new WeakMap<AnnotationDocument, { path: string; raw: string | null }>();
	private readonly writes = new Map<string, Promise<void>>();
	private readonly recoveryCopies = new WeakMap<AnnotationDocument, { payload: string; path: string }>();
	private readonly renames = new Map<string, { to: string; before: string; after: string }>();
	private readonly deletedPdfs = new Set<string>();
	private readonly checkpointRoot: string | null;
	private readonly checkpointDevice: string;
	private readonly legacyInkSettings: InkRenderSettings;
	constructor(private readonly app: App, legacyInkSettings = DEFAULT_SETTINGS.inkRenderSettings) {
		this.legacyInkSettings = normalizeInkRenderSettings(legacyInkSettings);
		this.checkpointRoot = app.vault.configDir ? `${app.vault.configDir}/plugins/freedraw-pdf/annotation-checkpoints` : null;
		let device = "local";
		try {
			const key = "freedraw-pdf-checkpoint-device";
			device = globalThis.localStorage.getItem(key) || generateId("device");
			globalThis.localStorage.setItem(key, device);
		} catch { /* Checkpoints remain available when device storage is unavailable. */ }
		this.checkpointDevice = pathHash(device);
	}

	private checkpointPath(file: Pick<TFile, "path">): string | null {
		return this.checkpointRoot ? `${this.checkpointRoot}/${this.checkpointDevice}-${pathHash(file.path)}.json` : null;
	}

	private async writeCheckpoint(file: TFile, payload: string): Promise<void> {
		const path = this.checkpointPath(file);
		if (!path || !this.checkpointRoot) return;
		if (!await this.app.vault.adapter.exists(this.checkpointRoot)) {
			try { await this.app.vault.adapter.mkdir(this.checkpointRoot); }
			catch (error) { if (!await this.app.vault.adapter.exists(this.checkpointRoot)) throw error; }
		}
		await this.app.vault.adapter.write(path, payload);
	}

	private async recoverSyncedSidecar(file: TFile): Promise<void> {
		if (!this.checkpointRoot || !await this.app.vault.adapter.exists(this.checkpointRoot)) return;
		const listed = await this.app.vault.adapter.list(this.checkpointRoot);
		let savedRaw: string | null = null;
		let savedAt = -Infinity;
		for (const candidate of listed.files) {
			if (!candidate.endsWith(`-${pathHash(file.path)}.json`)) continue;
			try {
				const raw = await this.app.vault.adapter.read(candidate);
				if (!annotationContent(raw)) continue;
				const data = JSON.parse(raw) as AnnotationDocument;
				const timestamp = Date.parse(data.updatedAt);
				if (data.sourceFile === file.path && timestamp > savedAt) { savedRaw = raw; savedAt = timestamp; }
			} catch { /* Another device may still be syncing this checkpoint. */ }
		}
		if (savedRaw === null) return;
		const saved = JSON.parse(savedRaw) as AnnotationDocument;
		if (saved.sourceFile !== file.path) return;
		const path = this.getSidecarPath(file);
		const current = await this.app.vault.adapter.exists(path) ? await this.app.vault.adapter.read(path) : null;
		if (sameAnnotationContent(savedRaw, current)) return;
		let older = current === null || !annotationContent(current);
		if (current && !older) {
			const remote = JSON.parse(current) as AnnotationDocument;
			const missing = saved.strokes.some(stroke => !remote.strokes.some(other => other.id === stroke.id));
			older = Date.parse(saved.updatedAt) > Date.parse(remote.updatedAt) || (missing && Date.parse(saved.updatedAt) === Date.parse(remote.updatedAt));
		}
		if (!older) return;
		const restore = await confirmAnnotationAction(this.app, "Saved handwriting is missing",
			`${file.name}'s annotation JSON ${current === null ? "is missing" : "is older or incomplete"}. This device has a saved checkpoint with ${saved.strokes.length} strokes. Restore that checkpoint? The current JSON is preserved if it contains different data.`, "Restore saved handwriting");
		if (!restore) {
			if (current === null || !annotationContent(current)) throw new Error("Annotation JSON is unavailable. A saved checkpoint is preserved; restore it before opening a blank layer.");
			return;
		}
		const latest = await this.app.vault.adapter.exists(path) ? await this.app.vault.adapter.read(path) : null;
		if (latest !== current) throw new Error("Annotation JSON changed during recovery. Reopen the PDF when sync finishes.");
		if (current !== null) await this.app.vault.adapter.write(`${file.path}.${generateId("recovery")}${ANNOTATION_FILE_SUFFIX}`, current);
		const indexed = this.app.vault.getAbstractFileByPath?.(path);
		if (indexed instanceof TFile && current !== null) await this.app.vault.process(indexed, raw => {
			if (raw !== current) throw new Error("Annotation JSON changed during recovery. Both versions were kept.");
			return savedRaw;
		});
		else await this.app.vault.adapter.write(path, savedRaw);
	}

	inheritBaseline(previous: AnnotationDocument | null, next: AnnotationDocument): void {
		const baseline = previous ? this.baselines.get(previous) : undefined;
		if (baseline) { this.baselines.set(next, baseline); }
		const recovery = previous ? this.recoveryCopies.get(previous) : undefined;
		if (recovery) this.recoveryCopies.set(next, recovery);
	}

	getSidecarPath(file: TFile): string {
		return `${file.path}${ANNOTATION_FILE_SUFFIX}`;
	}

	async getRestoreCandidates(file: TFile): Promise<string[]> {
		const folder = file.parent?.path ?? "";
		const aliases = new Set([file.path]);
		for (const [oldPath, migration] of this.renames) if (migration.to === this.getSidecarPath(file)) aliases.add(oldPath.slice(0, -ANNOTATION_FILE_SUFFIX.length));
		const listed = await this.app.vault.adapter.list(folder);
		const candidates: string[] = [];
		for (const path of listed.files) {
			if (!isAnnotationJson(path) || path === this.getSidecarPath(file)) continue;
			const nameSource = filenamePdfPath(path);
			let matches = aliases.has(nameSource);
			if (!matches) try {
				const data = JSON.parse(await this.app.vault.adapter.read(path)) as Partial<AnnotationDocument>;
				matches = aliases.has(data.sourcePdf?.path ?? "") || aliases.has(data.sourceFile ?? "");
			} catch { continue; }
			if (matches) candidates.push(path);
		}
		return candidates.sort();
	}

	async load(file: TFile): Promise<AnnotationDocument> {
		return (await this.loadWithInfo(file)).document;
	}

	async loadWithInfo(file: TFile, selectedSidecarPath?: string): Promise<AnnotationLoadInfo> {
		if (await this.app.vault.adapter.exists(file.path)) this.deletedPdfs.delete(file.path);
		const expectedSidecarPath = this.getSidecarPath(file);
		await this.writes.get(expectedSidecarPath);
		if (!selectedSidecarPath) await this.recoverSyncedSidecar(file);
		let path = selectedSidecarPath ?? this.getSidecarPath(file);
		let exists = await this.app.vault.adapter.exists(path);
		if (!exists && !selectedSidecarPath) {
			const candidatePath = await this.findRenameCandidateSidecarPath(file);
			if (candidatePath) {
				path = candidatePath;
				exists = true;
				new Notice(`Found annotation data for ${file.name}; using ${candidatePath}.`);
			}
		}
		if (!exists) {
			const document = createEmptyDocument(file);
			this.baselines.set(document, { path: expectedSidecarPath, raw: null });
			return {
				document,
				sidecarPath: null,
				expectedSidecarPath,
				recoveredFromDifferentPath: false,
				sourcePathMismatch: false
			};
		}

		try {
			const raw = await this.app.vault.adapter.read(path);
			const parsed = JSON.parse(raw) as Partial<AnnotationDocument>;
			if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.strokes)) {
				throw new Error("Invalid annotation document structure.");
			}
			const sourcePdfPath = typeof parsed.sourcePdf?.path === "string" ? parsed.sourcePdf.path : parsed.sourceFile;
			const document: AnnotationDocument = {
				version: Math.max(8, parsed.version ?? 4),
				sourceFile: parsed.sourceFile ?? file.path,
				sourcePdf: this.normalizeSourcePdf(parsed.sourcePdf, file),
				updatedAt: parsed.updatedAt ?? new Date().toISOString(),
				strokes: Array.isArray(parsed.strokes)
					? parsed.strokes.map((stroke) => ({
							...stroke,
							page: stroke.page ?? 1
						}))
					: [],
				eraserPaths: Array.isArray(parsed.eraserPaths)
					? parsed.eraserPaths
						.filter((eraserPath) => Array.isArray(eraserPath.points) && eraserPath.points.length > 0)
						.map((eraserPath) => ({
							...eraserPath,
							page: eraserPath.page ?? 1,
							radiusScale: Math.max(0.0005, Number(eraserPath.radiusScale) || 0.004)
						}))
					: [],
				textItems: Array.isArray(parsed.textItems)
					? parsed.textItems.map((item) => ({
							...item,
							page: item.page ?? 1
						}))
					: [],
				shapes: Array.isArray(parsed.shapes)
					? parsed.shapes.map((shape) => ({
							...shape,
							page: shape.page ?? 1
						}))
					: [],
				imageItems: Array.isArray(parsed.imageItems)
					? parsed.imageItems.map((image) => ({
							...image,
							page: image.page ?? 1,
							x: Number.isFinite(image.x) ? image.x : 0.32,
							y: Number.isFinite(image.y) ? image.y : 0.32,
							widthScale: Number.isFinite(image.widthScale) ? image.widthScale : 0.36,
							heightScale: Number.isFinite(image.heightScale) ? image.heightScale : 0.24
						}))
					: [],
				pdfPageTemplates: Array.isArray(parsed.pdfPageTemplates)
					? parsed.pdfPageTemplates.map((pageTemplate) => ({
						page: Math.max(1, Math.round(Number(pageTemplate.page) || 1)),
						template: pageTemplate.template ?? "ruled",
						paperColor: pageTemplate.paperColor ?? "#fffdf7",
						pageSize: pageTemplate.pageSize ?? "a4"
					}))
					: [],
				nativePageTemplatesEditable: typeof parsed.nativePageTemplatesEditable === "boolean"
					? parsed.nativePageTemplatesEditable
					: undefined,
				appendedPages: Array.isArray(parsed.appendedPages)
					? parsed.appendedPages.map((page, index) => ({
						id: page.id ?? generateId("page"),
						title: page.title ?? `Template ${index + 1}`,
						kind: "template",
						sourceLabel: "Template page",
						insertAfterPdfPage: typeof page.insertAfterPdfPage === "number" ? page.insertAfterPdfPage : null,
						template: page.template ?? "ruled",
						paperColor: page.paperColor ?? "#fffdf7",
						pageSize: page.pageSize ?? "a4",
						strokes: [],
						textItems: [],
						shapes: [],
						imageItems: []
					}))
					: [],
				deletedPdfPages: Array.isArray(parsed.deletedPdfPages)
					? Array.from(new Set(parsed.deletedPdfPages
						.map((page) => Math.round(Number(page)))
						.filter((page) => Number.isFinite(page) && page > 0)))
						.sort((a, b) => a - b)
					: [],
				permanentlyDeletedPdfPages: Array.isArray(parsed.permanentlyDeletedPdfPages)
					? Array.from(new Set(parsed.permanentlyDeletedPdfPages
						.map((page) => Math.round(Number(page)))
						.filter((page) => Number.isFinite(page) && page > 0)))
						.sort((a, b) => a - b)
					: [],
				removedPages: Array.isArray(parsed.removedPages)
					? parsed.removedPages
						.filter((entry) => !!entry?.page?.id)
						.map((entry, index) => ({
							page: {
								...entry.page,
								id: entry.page.id ?? generateId("page"),
								title: entry.page.title ?? `Removed page ${index + 1}`,
								kind: "template" as const,
								sourceLabel: "Template page",
								insertAfterPdfPage: typeof entry.page.insertAfterPdfPage === "number"
									? entry.page.insertAfterPdfPage
									: null,
								template: entry.page.template ?? "ruled",
								paperColor: entry.page.paperColor ?? "#fffdf7",
								pageSize: entry.page.pageSize ?? "a4",
								strokes: [],
								textItems: [],
								shapes: [],
								imageItems: []
							},
							originalIndex: Math.max(0, Math.round(Number(entry.originalIndex) || 0)),
							removedAt: entry.removedAt ?? new Date().toISOString(),
							annotations: {
								strokes: Array.isArray(entry.annotations?.strokes)
									? entry.annotations.strokes.map((stroke) => ({ ...stroke, page: stroke.page ?? 1 }))
									: [],
								eraserPaths: Array.isArray(entry.annotations?.eraserPaths)
									? entry.annotations.eraserPaths.map((eraserPath) => ({
										...eraserPath,
										page: eraserPath.page ?? 1,
										radiusScale: Math.max(0.0005, Number(eraserPath.radiusScale) || 0.004)
									}))
									: [],
								textItems: Array.isArray(entry.annotations?.textItems)
									? entry.annotations.textItems.map((item) => ({ ...item, page: item.page ?? 1 }))
									: [],
								shapes: Array.isArray(entry.annotations?.shapes)
									? entry.annotations.shapes.map((shape) => ({ ...shape, page: shape.page ?? 1 }))
									: [],
								imageItems: Array.isArray(entry.annotations?.imageItems)
									? entry.annotations.imageItems.map((image) => ({
										...image,
										page: image.page ?? 1,
										x: Number.isFinite(image.x) ? image.x : 0.32,
										y: Number.isFinite(image.y) ? image.y : 0.32,
										widthScale: Number.isFinite(image.widthScale) ? image.widthScale : 0.36,
										heightScale: Number.isFinite(image.heightScale) ? image.heightScale : 0.24
									}))
									: []
							}
						}))
					: []
			};
			let migratedInkSettings = false;
			const allStrokes = [...document.strokes, ...(document.removedPages ?? []).flatMap(page => page.annotations.strokes)];
			for (const stroke of allStrokes) {
				if (!stroke.inkSettings) { migratedInkSettings = true; }
				stroke.inkSettings = normalizeInkRenderSettings(stroke.inkSettings ?? this.legacyInkSettings);
			}
			let migratedStrokeMasks = migrateStrokeEraseMasks(document.strokes, () => generateId("stroke"));
			for (const removedPage of document.removedPages ?? []) {
				migratedStrokeMasks = migrateStrokeEraseMasks(removedPage.annotations.strokes, () => generateId("stroke")) || migratedStrokeMasks;
			}
			const migratedLegacyErasers = migrateLegacyEraserPaths(document) || migratedStrokeMasks;
			this.baselines.set(document, { path, raw });
			return {
				document,
				sidecarPath: path,
				expectedSidecarPath,
				recoveredFromDifferentPath: path !== expectedSidecarPath,
				sourcePathMismatch: !!sourcePdfPath && sourcePdfPath !== file.path,
				sourcePdfPath,
				migratedLegacyErasers,
				migratedInkSettings
			};
		} catch (error) {
			console.error("freedraw-pdf: failed to load sidecar", error);
			throw new Error("Could not read annotation data. The original sidecar is preserved; repair it or restore a backup before editing.");
		}
	}

	async save(file: TFile, document: AnnotationDocument): Promise<StrokeAnnotation[]> {
		const mergedStrokes: StrokeAnnotation[] = [];
		const path = this.getSidecarPath(file);
		const savedAt = new Date().toISOString();
		let payload = JSON.stringify(
			{
				...document,
				sourceFile: file.path,
				sourcePdf: getPdfIdentity(file),
				updatedAt: savedAt
			},
			null,
			2
		);
		const previous = this.writes.get(path) ?? Promise.resolve();
		const write = previous.catch(() => undefined).then(async () => {
			if (this.deletedPdfs.has(file.path)) return;
			const baseline = this.baselines.get(document);
			const existing = await this.app.vault.adapter.exists(path) ? await this.app.vault.adapter.read(path) : null;
			let expectedPath = baseline?.path;
			let expectedRaw = baseline?.raw;
			const visited = new Set<string>();
			while (expectedPath && expectedPath !== path && !visited.has(expectedPath)) {
				visited.add(expectedPath);
				const rename = this.renames.get(expectedPath);
				if (!rename || rename.before !== expectedRaw) { break; }
				expectedPath = rename.to;
				expectedRaw = rename.after;
			}
			const expected = expectedPath === path ? expectedRaw : null;
			let remoteAdditions: StrokeAnnotation[] = [];
			if (!sameAnnotationContent(existing, expected ?? null)) {
				const merged = existing === null ? null : mergeStrokeAdditions(expected ?? JSON.stringify(createEmptyDocument(file)), existing, payload);
				if (!merged) throw new Error("Annotation data changed in another view or device. Your edits remain in this view; reopen after resolving the conflict.");
				payload = merged.payload;
				remoteAdditions = merged.additions;
			}
			const indexedFile = this.app.vault.getAbstractFileByPath?.(path);
			await this.writeCheckpoint(file, payload);
			this.announceFileWrite(path, savedAt);
			if (indexedFile instanceof TFile) {
				await this.app.vault.process(indexedFile, current => {
					if (!sameAnnotationContent(current, existing)) { throw new Error("Annotation data changed during saving. Both versions must be kept."); }
					return payload;
				});
			} else {
				await this.app.vault.adapter.write(path, payload);
			}
			const verified = await this.app.vault.adapter.exists(path) ? await this.app.vault.adapter.read(path) : null;
			if (!sameAnnotationContent(verified, payload)) throw new Error("Annotation JSON changed or disappeared immediately after saving. This view and its checkpoint retain your handwriting.");
			// Incorporate remote additions without replacing new input received while
			// this write was in flight. The session's revision loop saves that input next.
			const currentIds = new Set(document.strokes.map(stroke => stroke.id));
			for (const stroke of remoteAdditions) if (!currentIds.has(stroke.id)) {
				document.strokes.push(stroke);
				mergedStrokes.push(stroke);
			}
			if (baseline) {
				// Undo snapshots share their view's baseline, including writes already in flight.
				baseline.path = path;
				baseline.raw = payload;
			} else {
				this.baselines.set(document, { path, raw: payload });
			}
		});
		this.writes.set(path, write);
		try { await write; } finally { if (this.writes.get(path) === write) this.writes.delete(path); }
		return mergedStrokes;
	}

	async saveRecoveryCopy(file: TFile, document: AnnotationDocument): Promise<string> {
		if (this.deletedPdfs.has(file.path)) return "";
		const payload = JSON.stringify({ ...document, sourceFile: file.path, sourcePdf: getPdfIdentity(file) }, null, 2);
		const previous = this.recoveryCopies.get(document);
		if (previous?.payload === payload && await this.app.vault.adapter.exists(previous.path)) {
			return previous.path;
		}
		// Update the same session's recovery instead of creating a file per edit.
		const previousPath = previous ? this.renames.get(previous.path)?.to ?? previous.path : undefined;
		const path = previousPath ?? `${file.path}.${generateId("recovery")}${ANNOTATION_FILE_SUFFIX}`;
		const write = (this.writes.get(path) ?? Promise.resolve()).catch(() => undefined).then(async () => {
			if (!this.deletedPdfs.has(file.path)) await this.app.vault.adapter.write(path, payload);
		});
		this.writes.set(path, write);
		try { await write; } finally { if (this.writes.get(path) === write) this.writes.delete(path); }
		this.recoveryCopies.set(document, { payload, path });
		return path;
	}

	async resolveSaveConflict(file: TFile, document: AnnotationDocument): Promise<boolean> {
		if (this.deletedPdfs.has(file.path)) return false;
		const path = this.getSidecarPath(file);
		const current = await this.app.vault.adapter.exists(path) ? await this.app.vault.adapter.read(path) : null;
		const replace = await confirmAnnotationAction(this.app, "Annotation save clash",
			`The saved JSON for ${file.name} differs from this view. Your edits have a recovery copy. Keep both versions, or save this view and preserve the other version in another recovery JSON?`, "Save this view");
		if (!replace || this.deletedPdfs.has(file.path)) return false;
		const latest = await this.app.vault.adapter.exists(path) ? await this.app.vault.adapter.read(path) : null;
		if (latest !== current) throw new Error("Annotation data changed while choosing. Both versions were kept.");
		if (current !== null) await this.app.vault.adapter.write(`${file.path}.${generateId("recovery")}${ANNOTATION_FILE_SUFFIX}`, current);
		this.baselines.set(document, {path, raw: current});
		await this.save(file, document);
		return true;
	}

	async relinkSidecarToFile(file: TFile, document: AnnotationDocument, sourceSidecarPath: string | null): Promise<string> {
		const expectedSidecarPath = this.getSidecarPath(file);
		const baseline = this.baselines.get(document);
		if (baseline && baseline.path !== expectedSidecarPath) {
			const current = await this.app.vault.adapter.exists(expectedSidecarPath) ? await this.app.vault.adapter.read(expectedSidecarPath) : null;
			if (current && !sameAnnotationContent(current, baseline.raw)) {
				const replace = await confirmAnnotationAction(this.app, "Annotation file clash",
					`${expectedSidecarPath} already contains different annotations. Keep both files, or use the selected data and preserve the existing data in a recovery JSON?`, "Use selected data");
				if (!replace) throw new Error("Relinking cancelled. Both annotation files were kept.");
				if (await this.app.vault.adapter.read(expectedSidecarPath) !== current) throw new Error("Annotation data changed while choosing. Both files were kept.");
				await this.app.vault.adapter.write(`${file.path}.${generateId("recovery")}${ANNOTATION_FILE_SUFFIX}`, current);
			}
			this.baselines.set(document, { path: expectedSidecarPath, raw: current });
		}
		await this.save(file, document);
		if (sourceSidecarPath && sourceSidecarPath !== expectedSidecarPath && await this.app.vault.adapter.exists(sourceSidecarPath)) {
			const sourcePdf = filenamePdfPath(sourceSidecarPath);
			if (!await this.app.vault.adapter.exists(sourcePdf) || sourcePdf === file.path) {
				const remove = await confirmAnnotationAction(this.app, "Remove previous annotation JSON?",
					`The annotations are now saved in ${expectedSidecarPath}. Move ${sourceSidecarPath} to trash?`, "Move to trash");
				if (remove) await this.trashSidecar(sourceSidecarPath);
			}
		}
		return expectedSidecarPath;
	}

	async migrateForRename(file: TFile, oldPath: string): Promise<void> {
		const oldSidecarPath = `${oldPath}${ANNOTATION_FILE_SUFFIX}`;
		const newSidecarPath = this.getSidecarPath(file);
		if (oldSidecarPath === newSidecarPath) { return; }
		const identity = getPdfIdentity(file);
		const previous = Promise.all([this.writes.get(oldSidecarPath), this.writes.get(newSidecarPath)]);
		const migration = previous.then(async () => {
			const folder = oldPath.slice(0, Math.max(0, oldPath.lastIndexOf("/")));
			const listed = await this.app.vault.adapter.list(folder);
			const paths = new Set(listed.files.filter(path => path === oldSidecarPath ||
				(path.startsWith(`${oldPath}.recovery-`) && path.endsWith(ANNOTATION_FILE_SUFFIX))));
			if (await this.app.vault.adapter.exists(oldSidecarPath)) paths.add(oldSidecarPath);
			for (const sourcePath of paths) {
			const destinationPath = `${file.path}${sourcePath.slice(oldPath.length)}`;
			await this.writes.get(sourcePath)?.catch(() => undefined);
			const raw = await this.app.vault.adapter.read(sourcePath);
			const parsed = JSON.parse(raw) as AnnotationDocument;
			const payload = JSON.stringify({ ...parsed, sourceFile: identity.path, sourcePdf: identity, updatedAt: new Date().toISOString() }, null, 2);
			if (await this.app.vault.adapter.exists(destinationPath) && !sameAnnotationContent(await this.app.vault.adapter.read(destinationPath), payload)) {
				const destinationRaw = await this.app.vault.adapter.read(destinationPath);
				const replace = await confirmAnnotationAction(this.app, "Annotation file clash",
					`The renamed PDF already has different data in ${destinationPath}. Keep both files, or move the original annotations here and preserve the destination in a recovery JSON?`, "Use original data");
				if (!replace) throw new Error("Annotation destination already exists. Both sidecars were preserved.");
				if (await this.app.vault.adapter.read(destinationPath) !== destinationRaw || await this.app.vault.adapter.read(sourcePath) !== raw) throw new Error("Annotation files changed while choosing. Both were preserved.");
				await this.app.vault.adapter.write(`${file.path}.${generateId("recovery")}${ANNOTATION_FILE_SUFFIX}`, destinationRaw);
			}
			await this.app.vault.adapter.write(destinationPath, payload);
			if (sourcePath === oldSidecarPath) {
				await this.writeCheckpoint(file, payload);
				const previousCheckpoint = this.checkpointPath({path:oldPath});
				if (previousCheckpoint && await this.app.vault.adapter.exists(previousCheckpoint)) await this.trashSidecar(previousCheckpoint);
			}
			this.renames.set(sourcePath, { to: destinationPath, before: raw, after: payload });
			await this.trashSidecar(sourcePath);
			}
		});
		this.writes.set(newSidecarPath, migration);
		try { await migration; } finally { if (this.writes.get(newSidecarPath) === migration) this.writes.delete(newSidecarPath); }
	}

	private announceFileWrite(path:string, updatedAt:string):void {
		if (typeof CustomEvent !== "undefined") this.app.workspace?.containerEl?.ownerDocument?.dispatchEvent(new CustomEvent("freedraw-pdf-file-action",{
			detail:{path,action:"write",updatedAt}
		}));
	}

	private async trashSidecar(path: string): Promise<void> {
		if (typeof CustomEvent !== "undefined") this.app.workspace?.containerEl?.ownerDocument?.dispatchEvent(new CustomEvent("freedraw-pdf-file-action",{
			detail:{path,action:"trash",reason:"Freedraw file management"}
		}));
		const indexed = this.app.vault.getAbstractFileByPath(path);
		if (indexed instanceof TFile) await this.app.fileManager.trashFile(indexed);
		else if (await this.app.vault.adapter.exists(path)) await this.app.vault.adapter.trashLocal(path);
	}

	markPdfDeleted(pdfPath: string): void { this.deletedPdfs.add(pdfPath); }

	async getRelatedSidecarPaths(pdfPath: string): Promise<string[]> {
		const sidecarPath = `${pdfPath}${ANNOTATION_FILE_SUFFIX}`;
		const folder = pdfPath.slice(0, Math.max(0, pdfPath.lastIndexOf("/")));
		const listed = await this.app.vault.adapter.list(folder);
		const paths = new Set(listed.files.filter(path => path === sidecarPath ||
			(path.startsWith(`${pdfPath}.recovery-`) && path.endsWith(ANNOTATION_FILE_SUFFIX))));
		if (await this.app.vault.adapter.exists(sidecarPath)) paths.add(sidecarPath);
		return Array.from(paths);
	}

	async deleteForPdfPath(pdfPath: string): Promise<boolean> {
		this.deletedPdfs.add(pdfPath);
		const sidecarPath = `${pdfPath}${ANNOTATION_FILE_SUFFIX}`;
		await this.writes.get(sidecarPath)?.catch(() => undefined);
		const paths = await this.getRelatedSidecarPaths(pdfPath);
		for (const path of paths) {
			await this.writes.get(path)?.catch(() => undefined);
			await this.trashSidecar(path);
		}
		const checkpoint = this.checkpointPath({path:pdfPath});
		if (checkpoint && await this.app.vault.adapter.exists(checkpoint)) {
			const saved = JSON.parse(await this.app.vault.adapter.read(checkpoint)) as AnnotationDocument;
			if (saved.sourceFile === pdfPath) await this.trashSidecar(checkpoint);
		}
		return paths.length > 0;
	}

	async cleanAnnotationFiles(removeOrphans: boolean, scope: AnnotationCleanupScope): Promise<{ removed: number; rows: AnnotationFileResult[] }> {
		let removed = 0;
		const rows: AnnotationFileResult[] = [];
		const seen = new Map<string, string>();
		const files = this.app.vault.getFiles().filter(file => isAnnotationJson(file.path))
			.sort((a, b) => Number(a.path.includes(".recovery-")) - Number(b.path.includes(".recovery-")) || b.stat.mtime - a.stat.mtime);
		for (const file of files) {
			if (this.writes.has(file.path)) continue;
			const raw = await this.app.vault.read(file);
			const content = annotationContent(raw);
			if (!content) continue; // Keep damaged files available for repair.
			const data = JSON.parse(raw) as Partial<AnnotationDocument>;
			const nameSource = filenamePdfPath(file.path);
			const source = data.sourcePdf?.path || data.sourceFile || nameSource;
			if (!inCleanupScope(file.path, source, scope)) continue;
			const sourceExists = await this.app.vault.adapter.exists(source) || await this.app.vault.adapter.exists(nameSource);
			const duplicate = file.path.includes(".recovery-") && seen.has(content);
			if ((removeOrphans && !sourceExists) || (!removeOrphans && duplicate)) {
				// Recheck before trashing: sync may have replaced this version.
				if (await this.app.vault.read(file) !== raw) continue;
				await this.trashSidecar(file.path);
				removed++;
				rows.push({path:file.path, reason:`Moved to trash: source PDF ${source} no longer exists.`});
			} else seen.set(content, file.path);
		}
		return {removed, rows};
	}

	async combineAnnotationFiles(scope: AnnotationCleanupScope): Promise<{ added: number; variants: number; removed: number; kept: number; pdfs: string[]; rows: AnnotationFileResult[] }> {
		const result = { added: 0, variants: 0, removed: 0, kept: 0, pdfs: [] as string[], rows: [] as AnnotationFileResult[] };
		const keep = (path: string, reason: string) => { result.kept++; result.rows.push({path, reason:`Kept: ${reason}`}); };
		const groups = new Map<string, { path: string; raw: string; document: AnnotationDocument }[]>();
		for (const file of this.app.vault.getFiles()) {
			if (!isAnnotationJson(file.path) || this.writes.has(file.path)) continue;
			try {
				const raw = await this.app.vault.read(file);
				if (!annotationContent(raw)) { if (inCleanupScope(file.path, "", scope)) keep(file.path, "invalid JSON or missing strokes array."); continue; }
				const document = JSON.parse(raw) as AnnotationDocument;
				const source = document.sourcePdf?.path || document.sourceFile;
				if (!inCleanupScope(file.path, source ?? "", scope)) continue;
				if (!source || (document.sourceFile && document.sourceFile !== source)) { keep(file.path, "sourceFile and sourcePdf.path do not agree about the PDF."); continue; }
				const pdf = this.app.vault.getAbstractFileByPath(source);
				if (!(pdf instanceof TFile) || pdf.extension.toLowerCase() !== "pdf") { keep(file.path, `source PDF ${source} was not found. Use deleted-PDF cleanup to remove this data.`); continue; }
				const normalized = await this.loadWithInfo(pdf, file.path);
				const group = groups.get(source) ?? [];
				group.push({ path: file.path, raw, document:normalized.document });
				groups.set(source, group);
			} catch { if (inCleanupScope(file.path, "", scope)) keep(file.path, "JSON could not be read or has an invalid annotation structure."); }
		}
		// Recovery snapshots have no common edit baseline. Preserve different
		// versions as separately selectable strokes rather than choosing a winner.
		const structure = (document: AnnotationDocument) => {
			const value = { ...document, strokes: [] } as Partial<AnnotationDocument>;
			delete value.sourceFile; delete value.sourcePdf; delete value.updatedAt;
			return canonicalValue(value);
		};
		for (const [source, entries] of groups) {
			if (entries.length < 2) continue;
			const canonicalPath = `${source}${ANNOTATION_FILE_SUFFIX}`;
			const primary = entries.find(entry => entry.path === canonicalPath);
			if (!primary && await this.app.vault.adapter.exists(canonicalPath)) { for (const entry of entries) keep(entry.path, "main JSON exists but could not be loaded; it must be repaired before combining."); continue; }
			const base = primary ?? entries[0];
			const merged = cloneDocument(base.document);
			const index = new Map(merged.strokes.map(stroke => [stroke.id, stroke]));
			const signatures = new Set(merged.strokes.map(comparableStroke));
			if (index.size !== merged.strokes.length || merged.strokes.some(stroke => !stroke.id)) { for (const entry of entries) keep(entry.path, "main JSON contains missing or repeated stroke IDs."); continue; }
			const consumed: typeof entries = [];
			let added = 0;
			let variants = 0;
			let nextZIndex = merged.strokes.reduce((highest, stroke) => Math.max(highest, stroke.zIndex ?? 0), 0);
			for (const entry of entries) {
				if (entry === primary) continue;
				const strokes = entry.document.strokes;
				if (structure(entry.document) !== structure(base.document)) {
					const keys = new Set([...Object.keys(entry.document), ...Object.keys(base.document)]);
					const differing = [...keys].filter(key => !["strokes","sourceFile","sourcePdf","updatedAt"].includes(key) &&
						canonicalValue((entry.document as unknown as Record<string,unknown>)[key]) !== canonicalValue((base.document as unknown as Record<string,unknown>)[key]));
					keep(entry.path, `differs from ${base.path} in ${differing.join(", ")}. Those page/annotation changes cannot be combined by adding strokes.`); continue;
				}
				if (new Set(strokes.map(stroke => stroke.id)).size !== strokes.length || strokes.some(stroke => !stroke.id)) { keep(entry.path, "contains missing or repeated stroke IDs."); continue; }
				for (const stroke of strokes) {
					const signature = comparableStroke(stroke);
					if (signatures.has(signature)) continue;
					const existing = index.get(stroke.id);
					if (existing && comparableStroke(existing) === comparableStroke(stroke)) continue;
					let id = stroke.id;
					if (existing) {
						const variantId = variantStrokeId(stroke);
						id = variantId;
						let collision = 0;
						while (index.has(id) && comparableStroke(index.get(id)!) !== comparableStroke(stroke)) id = `${variantId}-${++collision}`;
						if (index.has(id)) continue;
						variants++;
					}
					const included = { ...stroke, id, zIndex: ++nextZIndex };
					merged.strokes.push(included); index.set(id, included); added++;
					signatures.add(signature);
				}
				consumed.push(entry);
			}
			if (!consumed.length && !added) continue;
			const previous = this.writes.get(canonicalPath) ?? Promise.resolve();
			const operation = previous.catch(() => undefined).then(async () => {
				if (this.deletedPdfs.has(source)) return;
				const pdf = this.app.vault.getAbstractFileByPath(source);
				if (!(pdf instanceof TFile)) return;
				const expected = primary?.raw ?? null;
				const current = await this.app.vault.adapter.exists(canonicalPath) ? await this.app.vault.adapter.read(canonicalPath) : null;
				if (current !== expected) { for (const entry of consumed) keep(entry.path, "main JSON changed during combining; run again after saving or sync finishes."); return; }
				merged.sourceFile = source; merged.sourcePdf = getPdfIdentity(pdf); merged.updatedAt = new Date().toISOString();
				const payload = JSON.stringify(merged, null, 2);
				// Preserve the previous primary for rollback before changing it.
				const backupPath = current === null ? null : `${source}.${generateId("recovery")}${ANNOTATION_FILE_SUFFIX}`;
				if (backupPath) await this.app.vault.adapter.write(backupPath, current!);
				const indexed = this.app.vault.getAbstractFileByPath(canonicalPath);
				await this.writeCheckpoint(pdf, payload);
				this.announceFileWrite(canonicalPath, merged.updatedAt);
				if (indexed instanceof TFile) await this.app.vault.process(indexed, raw => {
					if (raw !== expected) throw new Error("Annotation data changed during combining. Source JSON files were kept.");
					return payload;
				});
				else await this.app.vault.create(canonicalPath, payload);
				if (await this.app.vault.adapter.read(canonicalPath) !== payload) throw new Error("Combined JSON could not be confirmed. Source files were kept.");
				result.added += added; result.variants += variants; result.pdfs.push(source);
				let removed = 0;
				for (const entry of consumed) {
					if (entry.path === canonicalPath) continue;
					if (await this.app.vault.adapter.read(entry.path) !== entry.raw) {
						keep(entry.path, "changed after combining, so its newer data was not removed."); continue;
					}
					await this.trashSidecar(entry.path); result.removed++; removed++;
				}
				if (backupPath) await this.trashSidecar(backupPath);
				result.rows.push({path:source, reason:`Added ${added} strokes${variants ? `, including ${variants} different versions kept as separate strokes` : ""}. Removed ${removed} recovery copies. Saved in ${canonicalPath.slice(canonicalPath.lastIndexOf("/") + 1)}.`});
			});
			this.writes.set(canonicalPath, operation);
			try { await operation; } finally { if (this.writes.get(canonicalPath) === operation) this.writes.delete(canonicalPath); }
		}
		return result;
	}

	private normalizeSourcePdf(sourcePdf: Partial<NonNullable<AnnotationDocument["sourcePdf"]>> | undefined, file: TFile): NonNullable<AnnotationDocument["sourcePdf"]> {
		return {
			path: typeof sourcePdf?.path === "string" ? sourcePdf.path : file.path,
			name: typeof sourcePdf?.name === "string" ? sourcePdf.name : file.name,
			basename: typeof sourcePdf?.basename === "string" ? sourcePdf.basename : file.basename,
			size: typeof sourcePdf?.size === "number" ? sourcePdf.size : file.stat.size,
			ctime: typeof sourcePdf?.ctime === "number" ? sourcePdf.ctime : file.stat.ctime,
			mtime: typeof sourcePdf?.mtime === "number" ? sourcePdf.mtime : file.stat.mtime
		};
	}

	private async findRenameCandidateSidecarPath(file: TFile): Promise<string | null> {
		const listed = await this.app.vault.adapter.list(file.parent?.path ?? "");
		const candidates: string[] = [];
		for (const path of listed.files) {
			if (!path.endsWith(ANNOTATION_FILE_SUFFIX) || path.includes(".recovery-")) continue;
			try {
				const data = JSON.parse(await this.app.vault.adapter.read(path)) as Partial<AnnotationDocument>;
				const source = data.sourcePdf?.path || data.sourceFile || path.slice(0, -ANNOTATION_FILE_SUFFIX.length);
				if (Array.isArray(data.strokes) && data.sourcePdf?.size === file.stat.size && !await this.app.vault.adapter.exists(source)) candidates.push(path);
			} catch { /* Keep unreadable data available for manual repair. */ }
		}
		return chooseAnnotationFile(this.app, "Found annotation data", `These orphan JSON files may belong to ${file.name}. Matching file size does not prove they belong to this PDF. Choose the correct file, or cancel to start an empty layer.`, candidates);
	}
}
