import { App, Notice, TFile } from "obsidian";
import { ANNOTATION_FILE_SUFFIX } from "../config";
import { getAnnotationRenderables } from "../annotation/renderOrder";
import { migrateLegacyEraserPaths, migrateStrokeEraseMasks } from "../annotation/eraser";
import { generateId } from "../utils/general";
import type { AnnotationDocument, AnnotationLoadInfo, EraserPathAnnotation, ShapeAnnotation, StrokeAnnotation, TextAnnotation } from "../types";

const DEFAULT_STROKE_REFERENCE_WIDTH = 1524;
const MAX_STROKE_WIDTH_SCALE = 0.08;
const MAX_TEXT_FONT_SCALE = 0.08;
const SCALE_DRIFT_TOLERANCE = 2.25;

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

export function getPdfIdentity(file: TFile): AnnotationDocument["sourcePdf"] {
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
	const pages = new Set<number>([
		...document.strokes.map((stroke) => stroke.page),
		...document.textItems.map((item) => item.page),
		...document.shapes.map((shape) => shape.page),
		...(document.eraserPaths ?? []).map((eraserPath) => eraserPath.page)
	]);
	let changed = false;
	for (const page of pages) {
		const pageChanged = normalizeAnnotationZIndexes(
			document.strokes.filter((stroke) => stroke.page === page),
			document.textItems.filter((item) => item.page === page),
			document.shapes.filter((shape) => shape.page === page),
			(document.eraserPaths ?? []).filter((eraserPath) => eraserPath.page === page)
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
	constructor(private readonly app: App) {}

	getSidecarPath(file: TFile): string {
		return `${file.path}${ANNOTATION_FILE_SUFFIX}`;
	}

	async load(file: TFile): Promise<AnnotationDocument> {
		return (await this.loadWithInfo(file)).document;
	}

	async loadWithInfo(file: TFile): Promise<AnnotationLoadInfo> {
		const expectedSidecarPath = this.getSidecarPath(file);
		let path = this.getSidecarPath(file);
		let exists = await this.app.vault.adapter.exists(path);
		if (!exists) {
			const candidatePath = await this.findRenameCandidateSidecarPath(file);
			if (candidatePath) {
				path = candidatePath;
				exists = true;
				new Notice(`Found annotation data for ${file.name}; using ${candidatePath}.`);
			}
		}
		if (!exists) {
			return {
				document: createEmptyDocument(file),
				sidecarPath: null,
				expectedSidecarPath,
				recoveredFromDifferentPath: false,
				sourcePathMismatch: false
			};
		}

		try {
			const raw = await this.app.vault.adapter.read(path);
			const parsed = JSON.parse(raw) as Partial<AnnotationDocument>;
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
			let migratedStrokeMasks = migrateStrokeEraseMasks(document.strokes, () => generateId("stroke"));
			for (const removedPage of document.removedPages ?? []) {
				migratedStrokeMasks = migrateStrokeEraseMasks(removedPage.annotations.strokes, () => generateId("stroke")) || migratedStrokeMasks;
			}
			const migratedLegacyErasers = migrateLegacyEraserPaths(document) || migratedStrokeMasks;
			return {
				document,
				sidecarPath: path,
				expectedSidecarPath,
				recoveredFromDifferentPath: path !== expectedSidecarPath,
				sourcePathMismatch: !!sourcePdfPath && sourcePdfPath !== file.path,
				sourcePdfPath,
				migratedLegacyErasers
			};
		} catch (error) {
			console.error("freedraw-pdf: failed to load sidecar", error);
			new Notice("Could not load annotation sidecar. Starting with a blank layer.");
			return {
				document: createEmptyDocument(file),
				sidecarPath: null,
				expectedSidecarPath,
				recoveredFromDifferentPath: false,
				sourcePathMismatch: false
			};
		}
	}

	async save(file: TFile, document: AnnotationDocument): Promise<void> {
		const path = this.getSidecarPath(file);
		const payload = JSON.stringify(
			{
				...document,
				sourceFile: file.path,
				sourcePdf: getPdfIdentity(file),
				updatedAt: new Date().toISOString()
			},
			null,
			2
		);
		await this.app.vault.adapter.write(path, payload);
	}

	async relinkSidecarToFile(file: TFile, document: AnnotationDocument, sourceSidecarPath: string | null): Promise<string> {
		const expectedSidecarPath = this.getSidecarPath(file);
		await this.save(file, document);
		if (sourceSidecarPath && sourceSidecarPath !== expectedSidecarPath && await this.app.vault.adapter.exists(sourceSidecarPath)) {
			await this.app.vault.adapter.remove(sourceSidecarPath);
		}
		return expectedSidecarPath;
	}

	async migrateForRename(file: TFile, oldPath: string): Promise<void> {
		const oldSidecarPath = `${oldPath}${ANNOTATION_FILE_SUFFIX}`;
		const newSidecarPath = this.getSidecarPath(file);
		const exists = await this.app.vault.adapter.exists(oldSidecarPath);
		if (!exists) {
			return;
		}
		const raw = await this.app.vault.adapter.read(oldSidecarPath);
		const parsed = JSON.parse(raw) as AnnotationDocument;
		const payload = JSON.stringify(
			{
				...parsed,
				sourceFile: file.path,
				sourcePdf: getPdfIdentity(file),
				updatedAt: new Date().toISOString()
			},
			null,
			2
		);
		await this.app.vault.adapter.write(newSidecarPath, payload);
		if (oldSidecarPath !== newSidecarPath && await this.app.vault.adapter.exists(oldSidecarPath)) {
			await this.app.vault.adapter.remove(oldSidecarPath);
		}
	}

	async deleteForPdfPath(pdfPath: string): Promise<boolean> {
		const sidecarPath = `${pdfPath}${ANNOTATION_FILE_SUFFIX}`;
		if (!await this.app.vault.adapter.exists(sidecarPath)) {
			return false;
		}
		await this.app.vault.adapter.remove(sidecarPath);
		return true;
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
		const folderPath = file.parent?.path ?? "";
		try {
			const listed = await this.app.vault.adapter.list(folderPath);
			const candidates: string[] = [];
			for (const candidatePath of listed.files) {
				if (!candidatePath.endsWith(ANNOTATION_FILE_SUFFIX) || candidatePath === this.getSidecarPath(file)) {
					continue;
				}
				try {
					const raw = await this.app.vault.adapter.read(candidatePath);
					const parsed = JSON.parse(raw) as Partial<AnnotationDocument>;
					if (parsed.sourcePdf?.size === file.stat.size) {
						candidates.push(candidatePath);
					}
				} catch {
					// Ignore unrelated or broken sidecar files.
				}
			}
			return candidates.length === 1 ? candidates[0] : null;
		} catch (error) {
			console.warn("freedraw-pdf: failed to scan for renamed sidecar", error);
			return null;
		}
	}
}
