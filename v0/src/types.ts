import type { TFile, WorkspaceLeaf } from "obsidian";
import type { RenderableAnnotation as OrderedRenderableAnnotation } from "./annotation/renderOrder";

export type ShapeTool = "rectangle" | "ellipse" | "line";
export type AnnotationTool = "select" | "region" | "pen" | "highlighter" | "eraser" | "text" | ShapeTool;
export type EraserMode = "object" | "segment";
export type SelectionMode = "single" | "box" | "lasso";
export type ToolPresetKind = "pen" | "highlighter" | "eraser";
export type InkInputPolicy = "pen-mouse-stylus-touch" | "pen-mouse-only" | "allow-touch";
export type LivePreviewMode = "accurate" | "balanced" | "smooth";
export type InkPressureMode = "auto" | "simulate" | "stylus";
export type InkEasingMode = "linear" | "ease-in" | "ease-out" | "ease-in-out";
export type TextFontWeight = "normal" | "bold";
export type TextFontStyle = "normal" | "italic";
export type TextAlignment = "left" | "center" | "right";
export type TextVerticalAlignment = "top" | "middle" | "bottom";

export interface InkRenderSettings {
	thinning: number;
	streamline: number;
	smoothing: number;
	easing: InkEasingMode;
	taperStart: number;
	taperEnd: number;
	pressureMode: InkPressureMode;
}

export interface ToolPreset {
	id: string;
	label: string;
	kind: ToolPresetKind;
	color: string;
	width: number;
	opacity: number;
}

export interface ToolStateSnapshot {
	activeTool: AnnotationTool;
	activeColor: string;
	activeOpacity: number;
	eraserMode: EraserMode;
	selectionMode: SelectionMode;
	selectedPresetId: string | null;
	selectedPresetIds?: Partial<Record<ToolPresetKind, string | null>>;
	widths: {
		pen: number;
		highlighter: number;
		eraser: number;
	};
}

export interface PreviewStateSnapshot {
	clientX: number | null;
	clientY: number | null;
	visible: boolean;
	active: boolean;
	radius: number;
}

export interface PDFAnnotatorSettings {
	pressureCaptureVersion: number;
	toolDefaults: ToolStateSnapshot;
	presets: ToolPreset[];
	textColor: string;
	preferInlineToolbar: boolean;
	showRegionToolbarButton: boolean;
	showCopyEmbedToolbarButton: boolean;
	autoCopyRegionEmbed: boolean;
	showAnnotatedEmbedHeader: boolean;
	showDrawingNotices: boolean;
	showRenderTelemetry: boolean;
	inkInputPolicy: InkInputPolicy;
	livePreviewMode: LivePreviewMode;
	inkRenderSettings: InkRenderSettings;
	autosaveDelayMs: number;
}

export interface AnnotationPoint {
	x: number;
	y: number;
	pressure: number;
	t?: number;
}

export interface StrokeAnnotation {
	id: string;
	page: number;
	tool: "pen" | "highlighter";
	color: string;
	width: number;
	widthScale?: number;
	zIndex?: number;
	points: AnnotationPoint[];
	cutStart?: boolean;
	cutEnd?: boolean;
	createdAt: string;
}

export interface EraserPathAnnotation {
	id: string;
	page: number;
	points: AnnotationPoint[];
	radiusScale: number;
	zIndex?: number;
	createdAt: string;
}

export interface TextAnnotation {
	id: string;
	page: number;
	text: string;
	x: number;
	y: number;
	color: string;
	fontSize: number;
	fontFamily?: string;
	fontScale?: number;
	fontWeight?: TextFontWeight;
	fontStyle?: TextFontStyle;
	textAlign?: TextAlignment;
	verticalAlign?: TextVerticalAlignment;
	lineSpacing?: number;
	wordWrap?: boolean;
	autoFit?: boolean;
	manualBoxSize?: boolean;
	boxWidthScale?: number;
	boxHeightScale?: number;
	zIndex?: number;
	createdAt: string;
}

export interface ShapeAnnotation {
	id: string;
	page: number;
	tool: ShapeTool;
	color: string;
	width: number;
	widthScale?: number;
	start: AnnotationPoint;
	end: AnnotationPoint;
	zIndex?: number;
	createdAt: string;
}

export interface ImageAnnotation {
	id: string;
	page: number;
	name: string;
	dataUrl: string;
	x: number;
	y: number;
	widthScale: number;
	heightScale: number;
	zIndex?: number;
	createdAt: string;
}

export interface AnnotationClipboardPayload {
	strokes: StrokeAnnotation[];
	textItems: TextAnnotation[];
	shapes: ShapeAnnotation[];
	imageItems?: ImageAnnotation[];
}

export type NotebookTemplate = "blank" | "ruled" | "grid" | "dot";
export type NotebookPageSize = "a4" | "letter" | "compact" | "long";
export type NotebookPageKind = "template" | "pdf";

export interface NotebookPdfSource {
	filePath: string;
	page: number;
}

export interface NotebookPage {
	id: string;
	title: string;
	kind: NotebookPageKind;
	sourceLabel?: string;
	pdfSource?: NotebookPdfSource;
	insertAfterPdfPage?: number | null;
	template: NotebookTemplate;
	paperColor: string;
	pageSize: NotebookPageSize;
	strokes: StrokeAnnotation[];
	textItems: TextAnnotation[];
	shapes: ShapeAnnotation[];
	imageItems?: ImageAnnotation[];
}

export interface PdfPageTemplate {
	page: number;
	template: NotebookTemplate;
	paperColor: string;
	pageSize: NotebookPageSize;
}

export interface NotebookDocument {
	version: 1;
	title: string;
	createdAt: string;
	updatedAt: string;
	pages: NotebookPage[];
}

export interface RemovedNotebookPage {
	page: NotebookPage;
	originalIndex: number;
	removedAt: string;
	annotations: {
		strokes: StrokeAnnotation[];
		eraserPaths: EraserPathAnnotation[];
		textItems: TextAnnotation[];
		shapes: ShapeAnnotation[];
		imageItems: ImageAnnotation[];
	};
}

export interface NotebookHistoryState {
	document: NotebookDocument;
	activePageId: string | null;
}

export interface MixedPageEntry {
	pageNumber: number;
	label: string;
	detail: string;
	isAdded: boolean;
	annotationCount: number;
	pageId?: string;
	template?: NotebookTemplate;
	pageSize?: NotebookPageSize;
	paperColor?: string;
	isRemoved?: boolean;
	removedKind?: "pdf" | "added";
}

export interface NormalizedRect {
	left: number;
	top: number;
	right: number;
	bottom: number;
}

export interface AnnotatedMarkdownEmbedInstance {
	id: string;
	filePath: string;
	sidecarPath: string;
	el: HTMLElement;
	render: (forceRefresh?: boolean) => void;
}

export type RenderableAnnotation = OrderedRenderableAnnotation<StrokeAnnotation, TextAnnotation, ShapeAnnotation>;

export interface RegionReference {
	filePath: string;
	page: number;
	rect: {
		left: number;
		top: number;
		right: number;
		bottom: number;
	};
}

export interface AnnotationDocument {
	version: number;
	sourceFile: string;
	sourcePdf?: {
		path: string;
		name: string;
		basename: string;
		size: number;
		ctime: number;
		mtime: number;
	};
	updatedAt: string;
	strokes: StrokeAnnotation[];
	eraserPaths?: EraserPathAnnotation[];
	textItems: TextAnnotation[];
	shapes: ShapeAnnotation[];
	imageItems?: ImageAnnotation[];
	pdfPageTemplates?: PdfPageTemplate[];
	nativePageTemplatesEditable?: boolean;
	appendedPages?: NotebookPage[];
	deletedPdfPages?: number[];
	permanentlyDeletedPdfPages?: number[];
	removedPages?: RemovedNotebookPage[];
}

export interface AnnotationLoadInfo {
	document: AnnotationDocument;
	sidecarPath: string | null;
	expectedSidecarPath: string;
	recoveredFromDifferentPath: boolean;
	sourcePathMismatch: boolean;
	sourcePdfPath?: string;
	migratedLegacyErasers?: boolean;
}

export interface PageSurface {
	pageNumber: number;
	pageEl: HTMLElement;
	hostEl: HTMLElement;
	overlayEl: HTMLCanvasElement;
	transientEl: HTMLCanvasElement;
	lastWidth: number;
	lastHeight: number;
	pendingWidth: number;
	pendingHeight: number;
}

export interface SelectedTarget {
	kind: "stroke" | "text" | "shape" | "image";
	id: string;
	page: number;
}

export interface LassoSelection {
	page: number;
	points: AnnotationPoint[];
}

export interface HitCandidate extends SelectedTarget {
	score: number;
}

export interface PageAnnotationBucket {
	strokes: StrokeAnnotation[];
	eraserPaths: EraserPathAnnotation[];
	textItems: TextAnnotation[];
	shapes: ShapeAnnotation[];
	imageItems: ImageAnnotation[];
}

export type ResizeHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

export type PdfLikeView = WorkspaceLeaf["view"] & {
	file?: TFile | null;
	contentEl?: HTMLElement;
	containerEl: HTMLElement;
};
