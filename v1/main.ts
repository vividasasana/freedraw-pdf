import { App, FileView, MarkdownView, Menu, Modal, Notice, Plugin, Setting, TAbstractFile, TFile, WorkspaceLeaf, setIcon } from "obsidian";
import { appendStrokePoints, drawSmoothInkStroke, fillInkStrokeOutline, getSmoothInkStrokeOutline, setInkRenderSettings, type InkStrokeOutline } from "./src/ink/inkEngine";
import { boundsOverlap, distanceBetween, distanceToSegment, getPolygonBounds, segmentsIntersect } from "./src/annotation/geometry";
import { getAnnotationRenderables, getRenderableOrder, reorderRenderables } from "./src/annotation/renderOrder";
import type { AnnotationReorderDirection } from "./src/annotation/renderOrder";
import { getNormalizedStrokePadding, getShapeBounds, getStrokeBounds, getTextBounds } from "./src/annotation/bounds";
import { eraseStrokeSegmentsAlongPath } from "./src/annotation/eraser";
import { cloneAnnotationsForPage, distanceBetweenSegments, distanceToBounds, distanceToRectEdge, distanceToShape, distanceToStroke, getClipboardPasteOffset, getSelectionBoxPoints, normalizeRect, parseRegionReference, pointInBounds, segmentIntersectsExpandedBounds } from "./src/annotation/interaction";
import { PAPER_TEMPLATE_DOT_COLOR, PAPER_TEMPLATE_GRID_COLOR, PAPER_TEMPLATE_LINE_COLOR, getPaperTemplateMetrics } from "./src/notebook/paperTemplates";
import {
	MAX_HISTORY,
	OVERLAY_CLASS,
	PAGE_SELECTORS,
	PAGE_VIRTUALIZATION_MARGIN,
	PAPER_COLOR_PRESETS,
	SESSION_ROOT_CLASS,
	TEXT_COLOR_PRESETS,
	TEXT_FONT_FAMILIES,
	TOOL_WIDTH_RANGES,
	TOOLBAR_SELECTORS,
	ZOOM_SETTLE_DELAY_MS
} from "./src/config";
import { AnnotationStore, cloneDocument, createEmptyDocument, normalizeDocumentStrokeScales, normalizeDocumentZIndexes } from "./src/stores/annotationStore";
import { AnnotatedEmbedController } from "./src/markdown/annotatedEmbedController";
import { findScrollParent, getOverlayHost, resolvePdfPageContentWidth } from "./src/pdf/pdfDom";
import { captureZoomPageAnchor, isTrackpadPinchWheel, resolveZoomPageScrollTop, type ZoomPageAnchor } from "./src/pdf/zoomAnchor";
import { dataUrlToArrayBuffer, clamp, generateId, getBaseName } from "./src/utils/general";
import { readClipboardText, writeClipboardText } from "./src/utils/clipboard";
import { isTabletWebKitTouchDevice } from "./src/utils/deviceUtils";
import { NOTEBOOK_PAGE_SIZES, NOTEBOOK_TEMPLATES, createTemplateNotebookPage, getNotebookPageRenderDimensions, getNotebookPageSizeDimensions, getNotebookPageSizeLabel, getNotebookTemplateLabel, hasEditableNativePageTemplates } from "./src/notebook/pageModel";
import {
	hidePdfPage,
	insertSyntheticPage,
	permanentlyDeleteHiddenPdfPage,
	permanentlyDeleteRemovedPage,
	removeSyntheticPageToTrash,
	restorePdfPage,
	restoreSyntheticPageFromTrash
} from "./src/notebook/pageLifecycle";
import { drawTemplatePageBackground } from "./src/notebook/templateCanvas";
import { getCoalescedPointerEvents, isInkDrawingTool, isWebKitStylusTouch, resolvePointerPressure, shouldCaptureInkPointerEvent, shouldIgnoreInkPointerEvent, shouldPanInkPointerEvent } from "./src/pointer/pointerInput";
import { PDFAnnotatorSettingsController } from "./src/settings/settingsController";
import { PDFAnnotatorSettingTab } from "./src/settings/settingTab";
import { createNativeMixedWorkingPdf, exportAnnotatedMixedDocumentPdf } from "./src/export/mixedDocumentExport";
import { buildPdfFromJpegPages } from "./src/export/simplePdfWriter";
import {
	INLINE_TEXT_LINE_HEIGHT,
	applyCanvasTextStyle,
	getAlignedTextX,
	getCanvasTextLines,
	getHorizontalTextCaretIndex,
	getInlineTextEditorLayout,
	getRenderedTextFontSize,
	getRenderedTextLayoutMetrics,
	getTextBlockHeight,
	getTextBlockTop,
	getZoomStableTextFrameLayout,
	measureAutoFitTextBox,
	resolveTextAlignment,
	resolveTextFontStyle,
	resolveTextLineSpacing,
	resolveTextFontWeight,
	resolveTextVerticalAlignment,
	resolveTextWordWrap,
	resizeInlineTextEditor
} from "./src/text/textLayout";
import { PreviewStateController, ToolStateController, isShapeTool } from "./src/tools/toolState";
import { resolveOverlayModeCursor } from "./src/interaction/cursorState";
import { resolveAnchoredPopoverPlacement } from "./src/ui/popoverPlacement";
import { TransientPopoverRegistry, createTransientPopoverEnvironment } from "./src/ui/transientPopoverRegistry";
import { addMenuDescriptors, menuSeparator, type MenuDescriptor } from "./src/ui/menuDescriptors";
import { registerSessionCommands } from "./src/commands/sessionCommands";
import { prioritizeRenderPages, runCooperativeRenderSlice } from "./src/render/cooperativeRender";
import type { CooperativeRenderStep } from "./src/render/cooperativeRender";
import { RenderTelemetryBroadcaster } from "./src/debug/renderTelemetry";
import type {
	AnnotationClipboardPayload,
	AnnotationDocument,
	AnnotationLoadInfo,
	AnnotationPoint,
	AnnotationTool,
	EraserPathAnnotation,
	EraserMode,
	HitCandidate,
	ImageAnnotation,
	InkInputPolicy,
	InkRenderSettings,
	LivePreviewMode,
	LassoSelection,
	MixedPageEntry,
	NormalizedRect,
	NotebookPage,
	NotebookPageSize,
	NotebookTemplate,
	PDFAnnotatorSettings,
	PageAnnotationBucket,
	PageSurface,
	PdfPageTemplate,
	PdfLikeView,
	RegionReference,
	ResizeHandle,
	SelectedTarget,
	SelectionMode,
	ShapeAnnotation,
	ShapeTool,
	StrokeAnnotation,
	TextAnnotation,
	TextAlignment,
	TextFontStyle,
	TextFontWeight,
	TextVerticalAlignment,
	ToolPreset,
	ToolPresetKind,
	ToolStateSnapshot
} from "./src/types";

const DEFAULT_STROKE_REFERENCE_WIDTH = 1524;
const MAX_STROKE_WIDTH_SCALE = 0.08;
const MAX_TEXT_FONT_SCALE = 0.08;
const SCALE_DRIFT_TOLERANCE = 2.25;
const BLANK_PDF_EXPORT_WIDTH_PX = 1600;
const SELECTION_OUTLINE_COLOR = "#6b6b6b";
const SELECTION_FILL_COLOR = "rgba(107, 107, 107, 0.04)";
const SELECTION_HANDLE_FILL_COLOR = "#ffffff";
const SELECTION_LINE_DASH = [2, 2];

function isDomNode(value: unknown): value is Node {
	const candidate = value as { instanceOf?: <T>(type: { new (): T }) => boolean } | null;
	return typeof candidate?.instanceOf === "function" && candidate.instanceOf(Node);
}

function isDomElement(value: unknown): value is Element {
	return isDomNode(value) && value.instanceOf(Element);
}

function isHtmlElement(value: unknown): value is HTMLElement {
	return isDomNode(value) && value.instanceOf(HTMLElement);
}

function isHtmlCanvasElement(value: unknown): value is HTMLCanvasElement {
	return isDomNode(value) && value.instanceOf(HTMLCanvasElement);
}

interface BlankAnnotatablePdfOptions {
	title: string;
	pageCount: number;
	template: NotebookTemplate;
	pageSize: NotebookPageSize;
	paperColor: string;
}

interface NativeInsertPageOptions {
	title: string;
	template: NotebookTemplate;
	pageSize: NotebookPageSize;
	paperColor: string;
}

type HistoryEntry =
	| { kind: "document"; document: AnnotationDocument }
	| { kind: "stroke-add"; stroke: StrokeAnnotation };

interface NativeInsertPageLocation {
	insertIndex: number;
	anchor: number;
	anchorLabel: string;
}

interface PageRenderSlotPool {
	canvases: HTMLCanvasElement[];
	nextIndex: number;
}

interface PageRenderJob {
	pageNumber: number;
	canvas: HTMLCanvasElement;
	steps: CooperativeRenderStep[];
	nextStep: number;
	lastProgressAt: number;
	width: number;
	height: number;
	version: number;
	inputEpoch: number;
}

interface CanvasSnapshot {
	image: ImageBitmap | HTMLImageElement;
	dispose: () => void;
}

class BlankAnnotatablePdfModal extends Modal {
	private options: BlankAnnotatablePdfOptions = {
		title: "New annotatable PDF",
		pageCount: 1,
		template: "ruled",
		pageSize: "a4",
		paperColor: "#fffdf7"
	};

	constructor(app: App, private readonly onSubmit: (options: BlankAnnotatablePdfOptions) => void) {
		super(app);
		this.titleEl.setText("Create annotatable PDF");
		this.modalEl.addClass("pdf-native-annotator-native-modal");
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("p", {
			text: "Creates a real PDF in the vault and opens it in Obsidian's native PDF viewer.",
			cls: "setting-item-description"
		});

		new Setting(contentEl)
			.setName("Title")
			.setDesc("The PDF filename.")
			.addText((text) => {
				text.setValue(this.options.title);
				text.onChange((value) => {
					this.options.title = value.trim() || "New annotatable PDF";
				});
			});

		new Setting(contentEl)
			.setName("Pages")
			.setDesc("Number of template pages to create.")
			.addText((text) => {
				text.inputEl.type = "number";
				text.inputEl.min = "1";
				text.inputEl.max = "200";
				text.setValue(String(this.options.pageCount));
				text.onChange((value) => {
					const next = Math.round(Number(value));
					this.options.pageCount = clamp(Number.isFinite(next) ? next : 1, 1, 200);
				});
			});

		new Setting(contentEl)
			.setName("Template")
			.addDropdown((dropdown) => {
				NOTEBOOK_TEMPLATES.forEach((template) => {
					dropdown.addOption(template, getNotebookTemplateLabel(template));
				});
				dropdown.setValue(this.options.template);
				dropdown.onChange((value) => {
					this.options.template = value as NotebookTemplate;
				});
			});

		new Setting(contentEl)
			.setName("Paper size")
			.addDropdown((dropdown) => {
				NOTEBOOK_PAGE_SIZES.forEach((pageSize) => {
					dropdown.addOption(pageSize, getNotebookPageSizeLabel(pageSize));
				});
				dropdown.setValue(this.options.pageSize);
				dropdown.onChange((value) => {
					this.options.pageSize = value as NotebookPageSize;
				});
			});

		new Setting(contentEl)
			.setName("Paper color")
			.addDropdown((dropdown) => {
				PAPER_COLOR_PRESETS.forEach((preset) => {
					dropdown.addOption(preset.color, preset.label);
				});
				dropdown.setValue(this.options.paperColor);
				dropdown.onChange((value) => {
					this.options.paperColor = value;
				});
			});

		contentEl.createDiv("modal-button-container", (buttonContainer) => {
			buttonContainer.createEl("button", { cls: "mod-cta", text: "Create PDF" }, (button) => {
				button.addEventListener("click", () => {
					const options = { ...this.options };
					this.close();
					this.onSubmit(options);
				});
			});
			buttonContainer.createEl("button", { text: "Cancel" }, (button) => {
				button.addEventListener("click", () => this.close());
			});
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

class NativeInsertPageModal extends Modal {
	private options: NativeInsertPageOptions;

	constructor(
		app: App,
		private readonly position: "before" | "after",
		private readonly anchorLabel: string,
		defaults: NativeInsertPageOptions,
		private readonly onSubmit: (options: NativeInsertPageOptions) => void,
		private readonly mode: "temporary" | "native" = "native"
	) {
		super(app);
		this.options = { ...defaults };
		this.titleEl.setText(this.mode === "temporary" ? "Add template page" : "Insert native template page");
		this.modalEl.addClass("pdf-native-annotator-native-modal");
	}

	onOpen(): void {
		const { contentEl } = this;
		this.titleEl.setText(this.mode === "temporary" ? "Add template page" : "Insert native template page");
		contentEl.empty();
		contentEl.createEl("p", {
			text: this.mode === "temporary"
				? `Adds a temporary template page ${this.position} ${this.anchorLabel}. It stays editable and is included when you export the finished PDF.`
				: `Creates a new native working PDF with this template page inserted ${this.position} ${this.anchorLabel}. Existing annotations are remapped and remain editable.`,
			cls: "setting-item-description"
		});

		new Setting(contentEl)
			.setName("Page title")
			.addText((text) => {
				text.setValue(this.options.title);
				text.onChange((value) => {
					this.options.title = value.trim() || "Inserted page";
				});
			});

		new Setting(contentEl)
			.setName("Template")
			.addDropdown((dropdown) => {
				NOTEBOOK_TEMPLATES.forEach((template) => {
					dropdown.addOption(template, getNotebookTemplateLabel(template));
				});
				dropdown.setValue(this.options.template);
				dropdown.onChange((value) => {
					this.options.template = value as NotebookTemplate;
				});
			});

		new Setting(contentEl)
			.setName("Paper size")
			.addDropdown((dropdown) => {
				NOTEBOOK_PAGE_SIZES.forEach((pageSize) => {
					dropdown.addOption(pageSize, getNotebookPageSizeLabel(pageSize));
				});
				dropdown.setValue(this.options.pageSize);
				dropdown.onChange((value) => {
					this.options.pageSize = value as NotebookPageSize;
				});
			});

		new Setting(contentEl)
			.setName("Paper color")
			.addDropdown((dropdown) => {
				PAPER_COLOR_PRESETS.forEach((preset) => {
					dropdown.addOption(preset.color, preset.label);
				});
				dropdown.setValue(this.options.paperColor);
				dropdown.onChange((value) => {
					this.options.paperColor = value;
				});
			});

		contentEl.createDiv("modal-button-container", (buttonContainer) => {
			buttonContainer.createEl("button", { cls: "mod-cta", text: "Insert page" }, (button) => {
				button.addEventListener("click", () => {
					const options = { ...this.options };
					this.close();
					this.onSubmit(options);
				});
			});
			buttonContainer.createEl("button", { text: "Cancel" }, (button) => {
				button.addEventListener("click", () => this.close());
			});
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

class ImageInsertModal extends Modal {
	private selectedFile: File | null = null;
	private insertButtonEl: HTMLButtonElement | null = null;
	private statusEl: HTMLElement | null = null;

	constructor(app: App, private readonly onSubmit: (file: File) => void) {
		super(app);
		this.titleEl.setText("Insert photo");
		this.modalEl.addClass("pdf-native-annotator-native-modal");
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("p", {
			text: "Choose an image file to place on the current PDF or template page.",
			cls: "setting-item-description"
		});

		const fileSetting = new Setting(contentEl)
			.setName("Photo")
			.setDesc("PNG, JPEG, WebP, GIF, or any image format supported by Obsidian.");
		const input = fileSetting.controlEl.createEl("input", { type: "file" });
		input.accept = "image/*";
		input.addEventListener("change", () => {
			this.selectedFile = input.files?.[0] ?? null;
			this.statusEl?.setText(this.selectedFile ? this.selectedFile.name : "No image selected");
			if (this.insertButtonEl) {
				this.insertButtonEl.disabled = !this.selectedFile;
			}
		});

		this.statusEl = contentEl.createEl("p", {
			text: "No image selected",
			cls: "setting-item-description"
		});

		contentEl.createDiv("modal-button-container", (buttonContainer) => {
			this.insertButtonEl = buttonContainer.createEl("button", { cls: "mod-cta", text: "Insert" }, (button) => {
				button.disabled = true;
				button.addEventListener("click", () => {
					if (!this.selectedFile) {
						return;
					}
					const file = this.selectedFile;
					this.close();
					this.onSubmit(file);
				});
			});
			buttonContainer.createEl("button", { text: "Cancel" }, (button) => {
				button.addEventListener("click", () => this.close());
			});
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

type TransientPopoverKey = "stroke" | "color" | "font" | "paper-color" | "confirm" | "rename" | "go-to-page" | "page-list";

class NativePdfAnnotatorSession {
	private file: TFile | null = null;
	private annotationDocument: AnnotationDocument | null = null;
	private annotationLoadInfo: AnnotationLoadInfo | null = null;
	private rootEl: HTMLDivElement | null = null;
	private toolbarEl: HTMLDivElement | null = null;
	private statusEl: HTMLDivElement | null = null;
	private readonly transientPopovers: TransientPopoverRegistry<TransientPopoverKey>;
	private activeNativeMenu: Menu | null = null;
	private pageListFilter: "all" | "added" | "removed" = "all";
	private pageListQuery = "";
	private nativeMixedPageInputEl: HTMLInputElement | null = null;
	private nativeMixedPageCountEl: HTMLElement | null = null;
	private inlineTextEditorEl: HTMLTextAreaElement | null = null;
	private inlineTextEditorFrameEl: HTMLDivElement | null = null;
	private inlineTextCaretMirrorEl: HTMLDivElement | null = null;
	private inlineTextTargetId: string | null = null;
	private inlineTextPoint: AnnotationPoint | null = null;
	private inlineTextPageNumber: number | null = null;
	private inlineTextAutoFit = false;
	private toolPreviewEl: HTMLDivElement | null = null;
	private mutationObserver: MutationObserver | null = null;
	private viewResizeObserver: ResizeObserver | null = null;
	private syncHandle: number | null = null;
	private scrollHandle: number | null = null;
	private scrollIdleHandle: number | null = null;
	private redrawHandle: number | null = null;
	private interactionRedrawHandle: number | null = null;
	private committedRedrawHandle: number | null = null;
	private popoverRepositionHandle: number | null = null;
	private toolbarScrollRestoreHandle: number | null = null;
	private thumbnailScrollRestoreHandle: number | null = null;
	private keyboardAvoidanceHandle: number | null = null;
	private pendingWebKitTouchHandle: number | null = null;
	private fingerPanFrameHandle: number | null = null;
	private fingerPanInertiaHandle: number | null = null;
	private visualViewportBaselineHeight = 0;
	private layoutRefreshHandles: number[] = [];
	private zoomSettleHandle: number | null = null;
	private autosaveHandle: number | null = null;
	private statusResetHandle: number | null = null;
	private pointerPage: number | null = null;
	private activePdfPointerId: number | null = null;
	private activePdfPointerCanvas: HTMLCanvasElement | null = null;
	private activePdfPointerRect: DOMRect | null = null;
	private pendingWebKitTouchPointer: PointerEvent | null = null;
	private webKitStylusPointerId: number | null = null;
	private fingerPanPointerId: number | null = null;
	private fingerPanCanvas: HTMLCanvasElement | null = null;
	private fingerPanScrollEl: HTMLElement | null = null;
	private fingerPanLastPoint: { clientX: number; clientY: number; time: number } | null = null;
	private fingerPanPendingDelta = { x: 0, y: 0 };
	private fingerPanVelocity = { x: 0, y: 0 };
	private zoomScrollAnchor: (ZoomPageAnchor & { viewportY: number }) | null = null;
	private zoomAnchorRestoreHandle: number | null = null;
	private syntheticZoomPreviewHandle: number | null = null;
	private currentStroke: StrokeAnnotation | null = null;
	private currentStrokeRenderedPointCount = 0;
	private currentShape: ShapeAnnotation | null = null;
	private selectedTarget: SelectedTarget | null = null;
	private selectedTargets: SelectedTarget[] = [];
	private currentLasso: LassoSelection | null = null;
	private lastSelectionRegion: { page: number; rect: NormalizedRect } | null = null;
	private dragAnchor: AnnotationPoint | null = null;
	private dragMoved = false;
	private activeResizeHandle: ResizeHandle | null = null;
	private erasingSession = false;
	private lastEraserPoint: AnnotationPoint | null = null;
	private eraserSessionPoints: AnnotationPoint[] = [];
	private objectErasePreviewTargets = new Map<string, SelectedTarget>();
	private scrollParent: HTMLElement | null = null;
	private nativeEventBus: { on?: (name: string, callback: (data?: unknown) => void) => void; off?: (name: string, callback: (data?: unknown) => void) => void } | null = null;
	private nativeEventHandlers: { name: string; callback: (data?: unknown) => void }[] = [];
	private currentPage = 1;
	private visiblePageRange: { start: number; end: number } | null = null;
	private readonly toolState: ToolStateController;
	private readonly previewState = new PreviewStateController();
	private annotationMode = false;
	private isDirty = false;
	private undoStack: HistoryEntry[] = [];
	private redoStack: HistoryEntry[] = [];
	private pageSurfaces = new Map<number, PageSurface>();
	private pageResizeObservers = new Map<number, ResizeObserver>();
	private pendingRedrawPages = new Set<number>();
	private pendingInteractionRedrawPages = new Set<number>();
	private pendingCommittedRedrawPages = new Set<number>();
	private strokePathCache = new Map<string, { signature: string; outline: InkStrokeOutline }>();
	private pageRenderSlots = new Map<number, PageRenderSlotPool>();
	private pageRenderJobs = new Map<number, PageRenderJob>();
	private pageRenderVersions = new Map<number, number>();
	private pageRenderPublications = new Map<number, number>();
	private renderInputEpoch = 0;
	private pageRenderTaskHandle: number | null = null;
	private readonly renderTelemetry = new RenderTelemetryBroadcaster();
	private imageElementCache = new Map<string, HTMLImageElement>();
	private zoomingPages = new Set<number>();
	private annotationPageCache: Map<number, PageAnnotationBucket> | null = null;
	private nextPageZIndexCache = new Map<number, number>();
	private realPdfPageCount = 0;
	private syntheticPageContainer: HTMLElement | null = null;
	private nativeMixedThumbnailViewEl: HTMLElement | null = null;
	private nativeMixedThumbnailSignature = "";
	private isSyncingSyntheticPages = false;
	private isPdfScrolling = false;
	private needsToolbarRefreshAfterScroll = false;
	private startupErrorShown = false;
	private focusedRegion: RegionReference["rect"] | null = null;
	private focusedRegionPage: number | null = null;
	private focusedRegionHandle: number | null = null;
	private lastPdfPoint: { clientX: number; clientY: number } | null = null;
	private lastPdfPointTime: number = 0;
	private lastInkInputTimestamp = 0;
	private floatingToolbarOffset: { right: number; top: number } = { right: 12, top: 8 };
	private floatingToolbarDrag: { startX: number; startY: number; startRight: number; startTop: number } | null = null;
	private currentTextFontFamily = TEXT_FONT_FAMILIES[0];
	private currentTextFontSize = 18;
	private currentTextColor = TEXT_COLOR_PRESETS[0].color;
	private currentTextFontWeight: TextFontWeight = "normal";
	private currentTextFontStyle: TextFontStyle = "normal";
	private currentTextAlignment: TextAlignment = "left";
	private currentTextVerticalAlignment: TextVerticalAlignment = "middle";
	private currentTextLineSpacing = INLINE_TEXT_LINE_HEIGHT;
	private currentTextWordWrap = true;
	private sessionKeyListenerBound = false;
	private keyboardNudgeHistoryOpen = false;

	constructor(
		private readonly plugin: PDFAnnotatorPlugin,
		private readonly leaf: WorkspaceLeaf,
		private readonly store: AnnotationStore
	) {
		this.toolState = new ToolStateController(this.plugin.getStoredPresets(), this.plugin.getToolDefaults());
		this.transientPopovers = new TransientPopoverRegistry(
			createTransientPopoverEnvironment(this.leaf.view.containerEl.ownerDocument)
		);
		this.currentTextColor = this.plugin.getTextColor();
	}

	get currentFile(): TFile | null {
		return this.file;
	}

	get activePage(): number {
		return this.currentPage;
	}

	isForLeaf(leaf: WorkspaceLeaf): boolean {
		return leaf === this.leaf;
	}

	isActive(): boolean {
		return !!this.file;
	}

	refreshUiState(): void {
		this.refreshToolbar();
	}

	refreshSettings(): void {
		this.mountUi();
		this.applyOverlayMode();
		this.syncRenderTelemetry();
		this.refreshToolbar();
	}

	refreshLayout(): void {
		this.commitActiveInkBeforeLayoutRefresh();
		this.scheduleLayoutRefresh();
	}

	async refreshLayoutAndFlush(): Promise<void> {
		this.commitActiveInkBeforeLayoutRefresh();
		await this.flushSave();
		this.scheduleLayoutRefresh();
	}

	focusRegion(page: number, rect: RegionReference["rect"]): void {
		this.focusedRegionPage = page;
		this.focusedRegion = rect;
		const surface = this.pageSurfaces.get(page);
		if (surface) {
			this.scrollPageElementIntoView(surface.pageEl);
			this.currentPage = page;
			this.drawPageAnnotations(page);
		} else {
			this.scheduleSyncPages();
		}
		if (this.focusedRegionHandle !== null) {
			window.clearTimeout(this.focusedRegionHandle);
		}
		this.focusedRegionHandle = window.setTimeout(() => {
			this.focusedRegionHandle = null;
			this.focusedRegion = null;
			this.focusedRegionPage = null;
			this.drawAllAnnotations();
		}, 5000);
		this.refreshStatus(`Focused region on page ${page}`);
	}

	focusPage(page: number): void {
		this.goToMixedPage(page);
	}

	async attach(): Promise<void> {
		try {
			const nextFile = this.getPdfFile();
			if (!nextFile) {
				this.detach();
				return;
			}

			this.bindSessionKeyListener();
			const fileChanged = !this.file || this.file.path !== nextFile.path;
			this.file = nextFile;
			this.ensureUi();

			if (fileChanged) {
				const loadInfo = await this.store.loadWithInfo(nextFile);
				this.annotationDocument = loadInfo.document;
				this.nextPageZIndexCache.clear();
				this.annotationLoadInfo = loadInfo;
				this.isDirty = false;
				const zIndexesChanged = normalizeDocumentZIndexes(this.annotationDocument);
				const strokeScalesChanged = normalizeDocumentStrokeScales(this.annotationDocument);
				if (loadInfo.migratedLegacyErasers) {
					this.isDirty = true;
					try {
						await this.store.save(nextFile, this.annotationDocument);
						this.isDirty = false;
					} catch (error) {
						console.warn("freedraw-pdf: could not persist legacy eraser migration immediately", error);
						this.scheduleSave();
					}
				} else if (zIndexesChanged || strokeScalesChanged) {
					this.isDirty = true;
					this.scheduleSave();
				}
				this.invalidateAnnotationPageCache();
				this.undoStack = [];
				this.redoStack = [];
				this.currentPage = 1;
				this.realPdfPageCount = 0;
				this.startupErrorShown = false;
				const temporaryPageCount = this.getTemporarySidecarPageCount();
				this.refreshStatus(
					temporaryPageCount > 0
						? `${temporaryPageCount} temporary template page${temporaryPageCount === 1 ? "" : "s"} found. Export when you want a finished PDF.`
						: `Attached to native PDF viewer: ${nextFile.name}`,
					temporaryPageCount > 0 ? 8000 : 2500
				);
			}

			this.observePdfDom();
			this.bindNativePdfEvents();
			this.syncPages();
			this.refreshToolbar();
		} catch (error) {
			console.error("freedraw-pdf: failed to attach to PDF view", error);
			this.showStartupError("freedraw-pdf could not attach safely to this PDF view.");
		}
	}

	async flushSave(): Promise<void> {
		if (!this.file || !this.annotationDocument || !this.isDirty) {
			return;
		}

		if (this.autosaveHandle !== null) {
			window.clearTimeout(this.autosaveHandle);
			this.autosaveHandle = null;
		}

		try {
			await this.store.save(this.file, this.annotationDocument);
			this.isDirty = false;
			this.refreshStatus(`Saved ${this.store.getSidecarPath(this.file)}`);
		} catch (error) {
			console.error("freedraw-pdf: failed to save", error);
			new Notice("Could not save PDF annotations.");
			this.refreshStatus("Save failed");
		}
	}

	detach(): void {
		this.commitActiveInkBeforeLayoutRefresh();
		void this.flushSave();
		this.finishSessionInlineTextEditor(false);
		this.detachNativeMixedPageNavigator();
		this.file = null;
		this.annotationDocument = null;
		this.nextPageZIndexCache.clear();
		this.annotationLoadInfo = null;
		this.invalidateAnnotationPageCache();
		this.currentStroke = null;
		this.currentShape = null;
		this.selectedTarget = null;
		this.selectedTargets = [];
		this.currentLasso = null;
		this.dragAnchor = null;
		this.dragMoved = false;
		this.activeResizeHandle = null;
		this.erasingSession = false;
		this.lastEraserPoint = null;
		this.eraserSessionPoints = [];
		this.objectErasePreviewTargets.clear();
		this.previewState.hide();
		this.pointerPage = null;
		this.visiblePageRange = null;
		this.realPdfPageCount = 0;
		this.cleanupNativeMixedPageThumbnails();
		this.syntheticPageContainer?.remove();
		this.syntheticPageContainer = null;
		this.undoStack = [];
		this.redoStack = [];
		if (this.focusedRegionHandle !== null) {
			window.clearTimeout(this.focusedRegionHandle);
			this.focusedRegionHandle = null;
		}
		this.focusedRegion = null;
		this.focusedRegionPage = null;
		this.destroyObservers();
		this.unbindNativePdfEvents();
		this.destroyPageSurfaces();
		this.renderTelemetry.dispose();
		this.rootEl?.remove();
		this.rootEl = null;
		this.toolbarEl = null;
		this.statusEl = null;
		this.closeActiveNativeMenu();
		this.transientPopovers.dispose();
		this.unbindSessionKeyListener();
	}

	private bindSessionKeyListener(): void {
		if (this.sessionKeyListenerBound) {
			return;
		}
		window.addEventListener("keydown", this.handleSessionKeyDown, { capture: true });
		window.addEventListener("keyup", this.handleSessionKeyUp);
		window.addEventListener("blur", this.handleSessionWindowBlur);
		this.sessionKeyListenerBound = true;
	}

	private unbindSessionKeyListener(): void {
		if (!this.sessionKeyListenerBound) {
			return;
		}
		window.removeEventListener("keydown", this.handleSessionKeyDown, { capture: true });
		window.removeEventListener("keyup", this.handleSessionKeyUp);
		window.removeEventListener("blur", this.handleSessionWindowBlur);
		this.keyboardNudgeHistoryOpen = false;
		this.sessionKeyListenerBound = false;
	}

	toggleAnnotationMode(): void {
		this.annotationMode = !this.annotationMode;
		if (!this.annotationMode) {
			this.finishSessionInlineTextEditor(true);
			this.flushPendingCommittedPageRedraws();
		}
		if (this.annotationMode && this.currentTool === "select") {
			this.setActiveTool("pen");
		}
		this.applyOverlayMode();
		this.refreshToolbar();
		this.syncPages();
		this.forceRedrawVisibleAnnotations();
		this.scheduleLayoutRefresh();
		this.refreshStatus(this.annotationMode ? "Annotation mode enabled" : "Annotation mode disabled");
	}

	async copyCurrentPageLink(): Promise<void> {
		this.syncCurrentPageForPageAction();
		await this.copyPageLink(this.currentPage);
	}

	private async copyPageLink(pageNumber: number): Promise<void> {
		if (!this.file) {
			new Notice("Open a PDF first.");
			return;
		}
		const link = this.buildPageLink(pageNumber);
		try {
			await writeClipboardText(link);
			new Notice(`Copied page ${pageNumber} link.`);
			this.refreshStatus(`Copied ${link}`);
		} catch (error) {
			console.error("freedraw-pdf: failed to copy link", error);
			new Notice(`Copy failed. Link: ${link}`);
		}
	}

	async copyCurrentPageEmbedBlock(): Promise<void> {
		if (!this.file) {
			new Notice("Open a PDF first.");
			return;
		}
		this.syncCurrentPageForPageAction();
		await this.plugin.copyAnnotatedPdfEmbedBlock(this.file, this.currentPage);
		this.refreshStatus(`Copied annotated embed for page ${this.currentPage}`);
	}

	async openAnnotationDataJson(): Promise<void> {
		if (!this.file) {
			new Notice("Open a PDF first.");
			return;
		}
		await this.flushSave();
		const sidecarPath = this.annotationLoadInfo?.sidecarPath ?? this.store.getSidecarPath(this.file);
		const sidecar = this.plugin.app.vault.getAbstractFileByPath(sidecarPath);
		if (sidecar instanceof TFile) {
			await this.plugin.app.workspace.getLeaf(true).openFile(sidecar);
			this.refreshStatus(`Opened ${sidecar.name}`);
			return;
		}
		if (await this.plugin.app.vault.adapter.exists(sidecarPath)) {
			await this.plugin.app.workspace.openLinkText(sidecarPath, "", true);
			this.refreshStatus(`Opened ${sidecarPath}`);
			return;
		}
		new Notice("Annotation data JSON does not exist yet.");
	}

	private shouldShowRelinkAnnotationDataAction(): boolean {
		return !!(
			this.annotationLoadInfo &&
			(this.annotationLoadInfo.recoveredFromDifferentPath || this.annotationLoadInfo.sourcePathMismatch)
		);
	}

	async relinkAnnotationDataToCurrentPdf(): Promise<void> {
		if (!this.file || !this.annotationDocument) {
			new Notice("Open a PDF first.");
			return;
		}
		const previousSidecarPath = this.annotationLoadInfo?.sidecarPath ?? null;
		try {
			const expectedSidecarPath = await this.store.relinkSidecarToFile(this.file, this.annotationDocument, previousSidecarPath);
			this.annotationLoadInfo = {
				document: this.annotationDocument,
				sidecarPath: expectedSidecarPath,
				expectedSidecarPath,
				recoveredFromDifferentPath: false,
				sourcePathMismatch: false,
				sourcePdfPath: this.file.path
			};
			this.isDirty = false;
			this.refreshStatus(`Relinked annotations to ${this.file.name}`);
			new Notice("Annotation data relinked to the current PDF.");
			this.plugin.refreshAnnotatedEmbedsForPath(this.file.path);
			if (previousSidecarPath) {
				this.plugin.refreshAnnotatedEmbedsForPath(previousSidecarPath);
			}
		} catch (error) {
			console.error("freedraw-pdf: failed to relink annotation data", error);
			new Notice("Could not relink annotation data JSON.");
		}
	}

	async exportCurrentPageSnapshot(): Promise<TFile | null> {
		this.syncCurrentPageForPageAction();
		return this.exportPageSnapshot(this.currentPage);
	}

	private insertPhotoOnCurrentPage(): void {
		if (!this.annotationDocument) {
			new Notice("Open an annotated PDF first.");
			return;
		}
		this.syncCurrentPageForPageAction();
		new ImageInsertModal(this.plugin.app, (file) => {
			void this.insertPhotoFileOnCurrentPage(file);
		}).open();
	}

	private async insertPhotoFileOnCurrentPage(file: File, placementPoint?: AnnotationPoint | null): Promise<void> {
		if (!this.annotationDocument) {
			new Notice("Open an annotated PDF first.");
			return;
		}
		try {
			const dataUrl = await this.readFileAsDataUrl(file);
			await this.insertImageDataUrlOnCurrentPage(dataUrl, file.name, placementPoint);
		} catch (error) {
			console.error("freedraw-pdf: failed to insert photo", error);
			new Notice("Could not insert the selected image.");
		}
	}

	private async insertImageDataUrlOnCurrentPage(dataUrl: string, name: string, placementPoint?: AnnotationPoint | null): Promise<void> {
		if (!this.annotationDocument) {
			new Notice("Open an annotated PDF first.");
			return;
		}
		try {
			const dimensions = await this.getImageDataUrlDimensions(dataUrl);
			const surface = this.pageSurfaces.get(this.currentPage);
			const pageAspect = surface && surface.lastWidth > 0 && surface.lastHeight > 0
				? surface.lastWidth / surface.lastHeight
				: 0.72;
			const imageAspect = dimensions.width / Math.max(1, dimensions.height);
			const widthScale = 0.38;
			const heightScale = Math.min(0.42, Math.max(0.08, (widthScale / imageAspect) * pageAspect));
			const point = placementPoint ?? this.getRecentPdfPastePoint(this.currentPage) ?? { x: 0.5, y: 0.5, pressure: 0.5 };
			const imageItem: ImageAnnotation = {
				id: generateId("image"),
				page: this.currentPage,
				name,
				dataUrl,
				x: clamp(point.x - (widthScale / 2), 0.02, 0.98 - widthScale),
				y: clamp(point.y - (heightScale / 2), 0.02, 0.98 - heightScale),
				widthScale,
				heightScale,
				zIndex: this.getNextPageZIndex(this.currentPage),
				createdAt: new Date().toISOString()
			};
			this.pushHistory();
			if (!Array.isArray(this.annotationDocument.imageItems)) {
				this.annotationDocument.imageItems = [];
			}
			this.annotationDocument.imageItems.push(imageItem);
			this.toolState.setActiveTool("select");
			this.selectedTarget = { kind: "image", id: imageItem.id, page: imageItem.page };
			this.selectedTargets = [this.selectedTarget];
			this.markDirtyAndRedraw(`Inserted ${name}`);
		} catch (error) {
			console.error("freedraw-pdf: failed to insert photo", error);
			new Notice("Could not insert the selected image.");
		}
	}

	private readFileAsDataUrl(file: File): Promise<string> {
		return new Promise((resolve, reject) => {
			const reader = new FileReader();
			reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Could not read image file."));
			reader.onerror = () => reject(reader.error ?? new Error("Could not read image file."));
			reader.readAsDataURL(file);
		});
	}

	private getImageDataUrlDimensions(dataUrl: string): Promise<{ width: number; height: number }> {
		return new Promise((resolve, reject) => {
			const image = new Image();
			image.onload = () => resolve({ width: image.naturalWidth || 1, height: image.naturalHeight || 1 });
			image.onerror = () => reject(new Error("Could not load selected image."));
			image.src = dataUrl;
		});
	}

	async exportAnnotatedMixedDocumentPdf(): Promise<TFile | null> {
		if (!this.file || !this.annotationDocument) {
			new Notice("Open a PDF first.");
			return null;
		}
		if (this.realPdfPageCount <= 0) {
			this.syncPages();
		}
		const entries = this.getMixedPageEntries();
		if (entries.length === 0) {
			new Notice("No pages available to export.");
			return null;
		}
		await this.flushSave();
		this.refreshStatus("Exporting annotated mixed PDF...", 6000);
		const outputFile = await exportAnnotatedMixedDocumentPdf(
			this.plugin.app,
			this.file,
			this.annotationDocument,
			entries,
			this.realPdfPageCount
		);
		if (outputFile) {
			this.refreshStatus(`Exported ${outputFile.name}`);
			await this.plugin.openPdfFileAtPage(outputFile, 1);
		}
		return outputFile;
	}

	async materializeNativeMixedWorkingPdf(): Promise<TFile | null> {
		if (!this.file || !this.annotationDocument) {
			new Notice("Open a PDF first.");
			return null;
		}
		if (this.realPdfPageCount <= 0) {
			this.syncPages();
		}
		const entries = this.getMixedPageEntries();
		if (entries.length === 0) {
			new Notice("No pages available to materialize.");
			return null;
		}
		await this.flushSave();
		this.refreshStatus("Creating native mixed working PDF...", 8000);
		return this.createNativeWorkingPdfFromDocument(this.annotationDocument, entries, this.currentPage);
	}

	openNativeTemplatePageInsertModal(position: "before" | "after"): void {
		if (!this.file || !this.annotationDocument) {
			new Notice("Open a PDF first.");
			return;
		}
		if (this.realPdfPageCount <= 0) {
			this.syncPages();
		}
		this.syncCurrentPageForPageAction();
		const location = this.getNativeInsertPageLocation(position);
		this.openNativeTemplatePageInsertModalAtLocation(position, location);
	}

	openTemplatePageInsertModal(position: "before" | "after"): void {
		if (!this.file || !this.annotationDocument) {
			new Notice("Open a PDF first.");
			return;
		}
		if (this.realPdfPageCount <= 0) {
			this.syncPages();
		}
		this.syncCurrentPageForPageAction();
		const location = this.getNativeInsertPageLocation(position);
		this.openTemplatePageInsertModalAtLocation(position, location);
	}

	private openNativeTemplatePageInsertModalAtLocation(position: "before" | "after", location: NativeInsertPageLocation, defaultsOverride?: NativeInsertPageOptions): void {
		if (!this.file || !this.annotationDocument) {
			new Notice("Open a PDF first.");
			return;
		}
		const defaults = defaultsOverride ?? this.getNativeInsertPageDefaults(position, location);
		new NativeInsertPageModal(
			this.plugin.app,
			position,
			location.anchorLabel,
			defaults,
			(options) => {
				void this.insertNativeTemplatePageAtLocation(location, options);
			}
		).open();
	}

	private openTemplatePageInsertModalAtLocation(position: "before" | "after", location: NativeInsertPageLocation, defaultsOverride?: NativeInsertPageOptions): void {
		if (!this.file || !this.annotationDocument) {
			new Notice("Open a PDF first.");
			return;
		}
		const defaults = defaultsOverride ?? this.getNativeInsertPageDefaults(position, location);
		new NativeInsertPageModal(
			this.plugin.app,
			position,
			location.anchorLabel,
			defaults,
			(options) => {
				this.insertTemplatePageAtLocation(location, options);
			},
			"temporary"
		).open();
	}

	async insertNativeTemplatePageAfterCurrent(options?: NativeInsertPageOptions): Promise<TFile | null> {
		return this.insertNativeTemplatePageNearCurrent("after", options);
	}

	async insertNativeTemplatePageBeforeCurrent(options?: NativeInsertPageOptions): Promise<TFile | null> {
		return this.insertNativeTemplatePageNearCurrent("before", options);
	}

	private getNativeInsertPageDefaults(position: "before" | "after", location = this.getNativeInsertPageLocation(position)): NativeInsertPageOptions {
		const currentSyntheticPage = this.getCurrentSyntheticPage();
		return {
			title: `Inserted page ${position} ${location.anchorLabel}`,
			template: currentSyntheticPage?.template ?? "ruled",
			pageSize: currentSyntheticPage?.pageSize ?? "a4",
			paperColor: currentSyntheticPage?.paperColor ?? "#fffdf7"
		};
	}

	private getNativeInsertPageLocation(position: "before" | "after"): NativeInsertPageLocation {
		const currentSyntheticIndex = this.getSyntheticPageIndex();
		if (currentSyntheticIndex >= 0) {
			const currentSyntheticPage = this.getAppendedPages()[currentSyntheticIndex];
			const anchor = this.getSyntheticPageInsertAfterPdfPage(currentSyntheticPage);
			return {
				insertIndex: position === "before" ? currentSyntheticIndex : currentSyntheticIndex + 1,
				anchor,
				anchorLabel: currentSyntheticPage.title.trim() || `added page ${this.currentPage}`
			};
		}
		if (position === "before") {
			const anchor = clamp(this.currentPage - 1, 0, Math.max(0, this.realPdfPageCount));
			return {
				insertIndex: this.findSyntheticInsertIndexAfterPdfPage(anchor),
				anchor,
				anchorLabel: `PDF page ${this.currentPage}`
			};
		}
		const anchor = clamp(this.currentPage, 0, Math.max(0, this.realPdfPageCount));
		return {
			insertIndex: this.findFirstSyntheticInsertIndexAfterPdfPage(anchor),
			anchor,
			anchorLabel: `PDF page ${this.currentPage}`
		};
	}

	private async insertNativeTemplatePageNearCurrent(position: "before" | "after", options?: NativeInsertPageOptions): Promise<TFile | null> {
		return this.insertNativeTemplatePageAtLocation(this.getNativeInsertPageLocation(position), options ?? this.getNativeInsertPageDefaults(position));
	}

	private async insertNativeTemplatePageAtLocation(location: NativeInsertPageLocation, options?: NativeInsertPageOptions): Promise<TFile | null> {
		if (!this.file || !this.annotationDocument) {
			new Notice("Open a PDF first.");
			return null;
		}
		if (this.realPdfPageCount <= 0) {
			this.syncPages();
		}
		const sourceDocument = cloneDocument(this.annotationDocument);
		if (!Array.isArray(sourceDocument.appendedPages)) {
			sourceDocument.appendedPages = [];
		}
		const fallbackOptions: NativeInsertPageOptions = {
			title: `Inserted page after ${location.anchorLabel}`,
			template: this.getCurrentSyntheticPage()?.template ?? "ruled",
			pageSize: this.getCurrentSyntheticPage()?.pageSize ?? "a4",
			paperColor: this.getCurrentSyntheticPage()?.paperColor ?? "#fffdf7"
		};
		const pageOptions = options ?? fallbackOptions;
		const insertIndex = clamp(location.insertIndex, 0, sourceDocument.appendedPages.length);
		const templatePage = createTemplateNotebookPage(
			pageOptions.title.trim() || fallbackOptions.title,
			pageOptions.template,
			pageOptions.pageSize,
			pageOptions.paperColor
		);
		templatePage.insertAfterPdfPage = location.anchor;
		const insertedPageNumber = insertSyntheticPage(
			sourceDocument,
			this.realPdfPageCount,
			insertIndex,
			templatePage
		);
		const entries = this.getMixedPageEntries(sourceDocument);
		await this.flushSave();
		this.refreshStatus("Creating native PDF with inserted page...", 8000);
		return this.createNativeWorkingPdfFromDocument(sourceDocument, entries, insertedPageNumber);
	}

	private async createNativeWorkingPdfFromDocument(
		document: AnnotationDocument,
		entries: MixedPageEntry[],
		targetPage: number
	): Promise<TFile | null> {
		if (!this.file) {
			new Notice("Open a PDF first.");
			return null;
		}
		const result = await createNativeMixedWorkingPdf(
			this.plugin.app,
			this.file,
			document,
			entries,
			this.realPdfPageCount
		);
		if (!result) {
			return null;
		}
		const nextDocument = cloneDocument(document);
		const activePageNumbers = new Set(entries.map((entry) => entry.pageNumber));
		const mapPage = (pageNumber: number): number => result.pageMap.get(pageNumber) ?? pageNumber;
		nextDocument.strokes = nextDocument.strokes.filter((stroke) => activePageNumbers.has(stroke.page)).map((stroke) => ({ ...stroke, page: mapPage(stroke.page) }));
		nextDocument.eraserPaths = (nextDocument.eraserPaths ?? []).filter((eraserPath) => activePageNumbers.has(eraserPath.page)).map((eraserPath) => ({ ...eraserPath, page: mapPage(eraserPath.page) }));
		nextDocument.textItems = nextDocument.textItems.filter((item) => activePageNumbers.has(item.page)).map((item) => ({ ...item, page: mapPage(item.page) }));
		nextDocument.shapes = nextDocument.shapes.filter((shape) => activePageNumbers.has(shape.page)).map((shape) => ({ ...shape, page: mapPage(shape.page) }));
		nextDocument.imageItems = (nextDocument.imageItems ?? []).filter((image) => activePageNumbers.has(image.page)).map((image) => ({ ...image, page: mapPage(image.page) }));
		nextDocument.appendedPages = [];
		nextDocument.pdfPageTemplates = [];
		nextDocument.nativePageTemplatesEditable = false;
		nextDocument.deletedPdfPages = [];
		nextDocument.permanentlyDeletedPdfPages = [];
		nextDocument.removedPages = [];
		nextDocument.sourceFile = result.file.path;
		nextDocument.updatedAt = new Date().toISOString();
		await this.store.save(result.file, nextDocument);
		const mappedTargetPage = mapPage(targetPage);
		this.refreshStatus(`Created ${result.file.name}`);
		await this.plugin.openPdfFileAtPage(result.file, mappedTargetPage);
		return result.file;
	}

	private async exportPageSnapshot(pageNumber: number): Promise<TFile | null> {
		if (!this.file) {
			new Notice("Open a PDF first.");
			return null;
		}

		const surface = this.pageSurfaces.get(pageNumber);
		if (!surface) {
			new Notice("That page is not ready to export yet.");
			return null;
		}

		const pdfCanvas = surface.hostEl.querySelector("canvas");
		const syntheticPage = this.getSyntheticPageIndex(pageNumber) >= 0
			? this.getAppendedPages()[this.getSyntheticPageIndex(pageNumber)] ?? null
			: null;
		if (!isHtmlCanvasElement(pdfCanvas) && !syntheticPage) {
			new Notice("Could not find the native PDF page canvas for export.");
			return null;
		}

		const exportCanvas = createEl("canvas");
		const ratio = window.devicePixelRatio || 1;
		const exportWidth = isHtmlCanvasElement(pdfCanvas) ? pdfCanvas.width : Math.max(1, Math.floor(surface.lastWidth * ratio));
		const exportHeight = isHtmlCanvasElement(pdfCanvas) ? pdfCanvas.height : Math.max(1, Math.floor(surface.lastHeight * ratio));
		exportCanvas.width = exportWidth;
		exportCanvas.height = exportHeight;
		const context = exportCanvas.getContext("2d");
		if (!context) {
			new Notice("Could not create export canvas.");
			return null;
		}

		if (isHtmlCanvasElement(pdfCanvas)) {
			context.drawImage(pdfCanvas, 0, 0);
		} else if (syntheticPage) {
			this.drawSyntheticSnapshotBackground(context, exportWidth, exportHeight, syntheticPage);
		}
		context.drawImage(surface.overlayEl, 0, 0, exportCanvas.width, exportCanvas.height);

		const folderPrefix = this.file.parent?.path ? `${this.file.parent.path}/` : "";
		const baseName = `${getBaseName(this.file)} page ${pageNumber} annotated`;
		let imagePath = `${folderPrefix}${baseName}.png`;
		let counter = 2;
		while (this.plugin.app.vault.getAbstractFileByPath(imagePath)) {
			imagePath = `${folderPrefix}${baseName} ${counter}.png`;
			counter += 1;
		}

		const buffer = dataUrlToArrayBuffer(exportCanvas.toDataURL("image/png"));
		const imageFile = await this.plugin.app.vault.createBinary(imagePath, buffer);
		this.refreshStatus(`Exported ${imageFile.name}`);
		new Notice(`Exported ${imageFile.name}`);
		return imageFile;
	}

	private drawSyntheticSnapshotBackground(context: CanvasRenderingContext2D, width: number, height: number, page: NotebookPage): void {
		drawTemplatePageBackground(context, width, height, page);
	}

	async exportSelectionSnapshot(): Promise<TFile | null> {
		const region = this.getSelectionRegion();
		if (!region) {
			new Notice("Drag a box region first.");
			return null;
		}

		const selectionPage = region.page;
		const bounds = region.rect;
		const surface = this.pageSurfaces.get(selectionPage);
		if (!surface) {
			new Notice("Selection snapshot is not ready yet.");
			return null;
		}

		const pdfCanvas = surface.hostEl.querySelector("canvas");
		if (!isHtmlCanvasElement(pdfCanvas)) {
			new Notice("Could not find the native PDF page canvas for selection export.");
			return null;
		}

		const cropLeft = Math.max(0, Math.floor(bounds.left * pdfCanvas.width) - 20);
		const cropTop = Math.max(0, Math.floor(bounds.top * pdfCanvas.height) - 20);
		const cropRight = Math.min(pdfCanvas.width, Math.ceil(bounds.right * pdfCanvas.width) + 20);
		const cropBottom = Math.min(pdfCanvas.height, Math.ceil(bounds.bottom * pdfCanvas.height) + 20);
		const cropWidth = Math.max(1, cropRight - cropLeft);
		const cropHeight = Math.max(1, cropBottom - cropTop);

		const exportCanvas = createEl("canvas");
		exportCanvas.width = cropWidth;
		exportCanvas.height = cropHeight;
		const context = exportCanvas.getContext("2d");
		if (!context) {
			new Notice("Could not create selection export canvas.");
			return null;
		}

		context.drawImage(pdfCanvas, cropLeft, cropTop, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);
		context.drawImage(surface.overlayEl, cropLeft, cropTop, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);

		const file = this.file;
		if (!file) {
			new Notice("Open a PDF before exporting a selection snapshot.");
			return null;
		}
		const folderPrefix = file.parent?.path ? `${file.parent.path}/` : "";
		const baseName = `${getBaseName(file)} page ${selectionPage} selection`;
		let imagePath = `${folderPrefix}${baseName}.png`;
		let counter = 2;
		while (this.plugin.app.vault.getAbstractFileByPath(imagePath)) {
			imagePath = `${folderPrefix}${baseName} ${counter}.png`;
			counter += 1;
		}

		const buffer = dataUrlToArrayBuffer(exportCanvas.toDataURL("image/png"));
		const imageFile = await this.plugin.app.vault.createBinary(imagePath, buffer);
		this.refreshStatus(`Exported ${imageFile.name}`);
		new Notice(`Exported ${imageFile.name}`);
		return imageFile;
	}

	async copySelectionRegionReference(): Promise<void> {
		const reference = this.buildSelectionRegionReference();
		if (!reference) {
			new Notice("Drag a box region on one page first.");
			return;
		}
		try {
			await this.plugin.writeClipboardText(reference);
			new Notice("Copied selection region reference.");
			this.refreshStatus(`Copied ${reference}`);
		} catch (error) {
			console.error("freedraw-pdf: failed to copy selection region reference", error);
			new Notice(`Copy failed. Region: ${reference}`);
		}
	}

	async copySelectionAnnotatedEmbedBlock(): Promise<void> {
		const region = this.getSelectionRegion();
		if (!region) {
			new Notice("Drag a box region on one page first.");
			return;
		}
		await this.plugin.copyAnnotatedPdfEmbedBlock(region.file, region.page, region.rect);
		this.refreshStatus(`Copied region embed for page ${region.page}`);
	}

	getActiveRegionEmbedSource(): { file: TFile; page: number; rect: NormalizedRect } | null {
		return this.getSelectionRegion();
	}

	copySelectedTargets(): void {
		if (!this.annotationDocument || this.selectedTargets.length === 0) {
			this.refreshStatus("Nothing selected");
			return;
		}

		const strokeIds = new Set(this.selectedTargets.filter((target) => target.kind === "stroke").map((target) => target.id));
		const textIds = new Set(this.selectedTargets.filter((target) => target.kind === "text").map((target) => target.id));
		const shapeIds = new Set(this.selectedTargets.filter((target) => target.kind === "shape").map((target) => target.id));
		const imageIds = new Set(this.selectedTargets.filter((target) => target.kind === "image").map((target) => target.id));

		const payload: AnnotationClipboardPayload = {
			strokes: this.annotationDocument.strokes
				.filter((stroke) => strokeIds.has(stroke.id))
				.map((stroke) => cloneDocument({
					version: 4,
					sourceFile: "",
					updatedAt: "",
					strokes: [stroke],
					textItems: [],
					shapes: []
				}).strokes[0]),
			textItems: this.annotationDocument.textItems
				.filter((item) => textIds.has(item.id))
				.map((item) => cloneDocument({
					version: 4,
					sourceFile: "",
					updatedAt: "",
					strokes: [],
					textItems: [item],
					shapes: []
				}).textItems[0]),
			shapes: this.annotationDocument.shapes
				.filter((shape) => shapeIds.has(shape.id))
				.map((shape) => cloneDocument({
					version: 4,
					sourceFile: "",
					updatedAt: "",
					strokes: [],
					textItems: [],
					shapes: [shape]
				}).shapes[0]),
			imageItems: (this.annotationDocument.imageItems ?? [])
				.filter((image) => imageIds.has(image.id))
				.map((image) => JSON.parse(JSON.stringify(image)) as ImageAnnotation)
		};

		this.plugin.setClipboard(payload);
		const total = payload.strokes.length + payload.textItems.length + payload.shapes.length + (payload.imageItems?.length ?? 0);
		this.refreshStatus(total === 1 ? "Copied selection" : `Copied ${total} selections`);
	}

	cutSelectedTargets(): void {
		if (!this.annotationDocument || this.selectedTargets.length === 0) {
			this.refreshStatus("Nothing selected");
			return;
		}
		const strokeIds = new Set(this.selectedTargets.filter((target) => target.kind === "stroke").map((target) => target.id));
		const textIds = new Set(this.selectedTargets.filter((target) => target.kind === "text").map((target) => target.id));
		const shapeIds = new Set(this.selectedTargets.filter((target) => target.kind === "shape").map((target) => target.id));
		const imageIds = new Set(this.selectedTargets.filter((target) => target.kind === "image").map((target) => target.id));
		const payload: AnnotationClipboardPayload = {
			strokes: this.annotationDocument.strokes
				.filter((stroke) => strokeIds.has(stroke.id))
				.map((stroke) => cloneDocument({
					version: 4,
					sourceFile: "",
					updatedAt: "",
					strokes: [stroke],
					textItems: [],
					shapes: []
				}).strokes[0]),
			textItems: this.annotationDocument.textItems
				.filter((item) => textIds.has(item.id))
				.map((item) => cloneDocument({
					version: 4,
					sourceFile: "",
					updatedAt: "",
					strokes: [],
					textItems: [item],
					shapes: []
				}).textItems[0]),
			shapes: this.annotationDocument.shapes
				.filter((shape) => shapeIds.has(shape.id))
				.map((shape) => cloneDocument({
					version: 4,
					sourceFile: "",
					updatedAt: "",
					strokes: [],
					textItems: [],
					shapes: [shape]
				}).shapes[0]),
			imageItems: (this.annotationDocument.imageItems ?? [])
				.filter((image) => imageIds.has(image.id))
				.map((image) => JSON.parse(JSON.stringify(image)) as ImageAnnotation)
		};
		const total = payload.strokes.length + payload.textItems.length + payload.shapes.length + (payload.imageItems?.length ?? 0);
		if (total === 0) {
			this.refreshStatus("Nothing selected");
			return;
		}
		this.plugin.setClipboard(payload);
		this.pushHistory();
		this.annotationDocument.strokes = this.annotationDocument.strokes.filter((stroke) => !strokeIds.has(stroke.id));
		this.annotationDocument.textItems = this.annotationDocument.textItems.filter((item) => !textIds.has(item.id));
		this.annotationDocument.shapes = this.annotationDocument.shapes.filter((shape) => !shapeIds.has(shape.id));
		this.annotationDocument.imageItems = (this.annotationDocument.imageItems ?? []).filter((image) => !imageIds.has(image.id));
		this.selectedTarget = null;
		this.selectedTargets = [];
		this.lastSelectionRegion = null;
		this.markDirtyAndRedraw(total === 1 ? "Cut selection" : `Cut ${total} selections`);
		this.refreshToolbar();
	}

	pasteClipboard(pasteInPlace = false): void {
		if (!this.annotationDocument) {
			this.refreshStatus("Open a PDF first.");
			return;
		}
		const clipboard = this.plugin.getClipboard();
		if (!clipboard) {
			this.refreshStatus("Clipboard is empty");
			return;
		}

		const pastePoint = pasteInPlace ? null : this.getRecentPdfPastePoint(this.currentPage);
		const pasteOffset = pasteInPlace ? { x: 0, y: 0 } : getClipboardPasteOffset(clipboard, pastePoint);
		const nextSelections: SelectedTarget[] = [];
		this.pushHistory();

		for (const stroke of clipboard.strokes) {
			const nextStroke: StrokeAnnotation = {
				...stroke,
				id: generateId("stroke"),
				page: this.currentPage,
				points: stroke.points.map((point) => ({
					...point,
					x: clamp(point.x + pasteOffset.x, 0, 1),
					y: clamp(point.y + pasteOffset.y, 0, 1)
				})),
				zIndex: this.getNextPageZIndex(this.currentPage),
				createdAt: new Date().toISOString()
			};
			this.annotationDocument.strokes.push(nextStroke);
			nextSelections.push({ kind: "stroke", id: nextStroke.id, page: nextStroke.page });
		}

		for (const item of clipboard.textItems) {
			const nextItem: TextAnnotation = {
				...item,
				id: generateId("text"),
				page: this.currentPage,
				x: clamp(item.x + pasteOffset.x, 0, 1),
				y: clamp(item.y + pasteOffset.y, 0, 1),
				zIndex: this.getNextPageZIndex(this.currentPage),
				createdAt: new Date().toISOString()
			};
			this.annotationDocument.textItems.push(nextItem);
			nextSelections.push({ kind: "text", id: nextItem.id, page: nextItem.page });
		}

		for (const shape of clipboard.shapes) {
			const nextShape: ShapeAnnotation = {
				...shape,
				id: generateId("shape"),
				page: this.currentPage,
				start: {
					...shape.start,
					x: clamp(shape.start.x + pasteOffset.x, 0, 1),
					y: clamp(shape.start.y + pasteOffset.y, 0, 1)
				},
				end: {
					...shape.end,
					x: clamp(shape.end.x + pasteOffset.x, 0, 1),
					y: clamp(shape.end.y + pasteOffset.y, 0, 1)
				},
				zIndex: this.getNextPageZIndex(this.currentPage),
				createdAt: new Date().toISOString()
			};
			this.annotationDocument.shapes.push(nextShape);
			nextSelections.push({ kind: "shape", id: nextShape.id, page: nextShape.page });
		}

		for (const image of clipboard.imageItems ?? []) {
			const nextImage: ImageAnnotation = {
				...image,
				id: generateId("image"),
				page: this.currentPage,
				x: clamp(image.x + pasteOffset.x, 0, Math.max(0, 1 - image.widthScale)),
				y: clamp(image.y + pasteOffset.y, 0, Math.max(0, 1 - image.heightScale)),
				zIndex: this.getNextPageZIndex(this.currentPage),
				createdAt: new Date().toISOString()
			};
			if (!Array.isArray(this.annotationDocument.imageItems)) {
				this.annotationDocument.imageItems = [];
			}
			this.annotationDocument.imageItems.push(nextImage);
			nextSelections.push({ kind: "image", id: nextImage.id, page: nextImage.page });
		}

		if (nextSelections.length === 0) {
			if (this.undoStack.length > 0) {
				this.undoStack.pop();
			}
			this.refreshStatus("Clipboard is empty");
			return;
		}

		this.selectedTargets = nextSelections;
		this.selectedTarget = nextSelections[0] ?? null;
		this.lastSelectionRegion = null;
		this.markDirtyAndRedraw(nextSelections.length === 1 ? "Pasted selection" : `Pasted ${nextSelections.length} selections`);
		this.refreshToolbar();
	}

	private getRecentPdfPastePoint(pageNumber: number): AnnotationPoint | null {
		const surface = this.pageSurfaces.get(pageNumber);
		if (!surface || !this.lastPdfPoint) {
			return null;
		}
		if (performance.now() - this.lastPdfPointTime > 8000) {
			return null;
		}
		const rect = surface.overlayEl.getBoundingClientRect();
		if (
			this.lastPdfPoint.clientX < rect.left ||
			this.lastPdfPoint.clientX > rect.right ||
			this.lastPdfPoint.clientY < rect.top ||
			this.lastPdfPoint.clientY > rect.bottom
		) {
			return null;
		}
		return {
			x: clamp((this.lastPdfPoint.clientX - rect.left) / Math.max(rect.width, 1), 0, 1),
			y: clamp((this.lastPdfPoint.clientY - rect.top) / Math.max(rect.height, 1), 0, 1),
			pressure: 0.5
		};
	}

	deleteSelectedTargets(): void {
		if (!this.annotationDocument || this.selectedTargets.length === 0) {
			this.refreshStatus("Nothing selected");
			return;
		}

		this.pushHistory();
		const selectedStrokeIds = new Set(this.selectedTargets.filter((target) => target.kind === "stroke").map((target) => target.id));
		const selectedTextIds = new Set(this.selectedTargets.filter((target) => target.kind === "text").map((target) => target.id));
		const selectedShapeIds = new Set(this.selectedTargets.filter((target) => target.kind === "shape").map((target) => target.id));
		const selectedImageIds = new Set(this.selectedTargets.filter((target) => target.kind === "image").map((target) => target.id));
		const removedCount = selectedStrokeIds.size + selectedTextIds.size + selectedShapeIds.size + selectedImageIds.size;

		this.annotationDocument.strokes = this.annotationDocument.strokes.filter((stroke) => !selectedStrokeIds.has(stroke.id));
		this.annotationDocument.textItems = this.annotationDocument.textItems.filter((item) => !selectedTextIds.has(item.id));
		this.annotationDocument.shapes = this.annotationDocument.shapes.filter((shape) => !selectedShapeIds.has(shape.id));
		this.annotationDocument.imageItems = (this.annotationDocument.imageItems ?? []).filter((image) => !selectedImageIds.has(image.id));
		this.selectedTarget = null;
		this.selectedTargets = [];
		this.lastSelectionRegion = null;
		this.markDirtyAndRedraw(removedCount === 1 ? "Deleted selection" : `Deleted ${removedCount} selections`);
		this.refreshToolbar();
	}

	selectAllCurrentPageAnnotations(): void {
		if (!this.annotationDocument) {
			return;
		}
		const bucket = this.getPageAnnotationBucket(this.currentPage);
		const nextSelections: SelectedTarget[] = [
			...bucket.strokes.map((stroke): SelectedTarget => ({ kind: "stroke", id: stroke.id, page: stroke.page })),
			...bucket.textItems.map((item): SelectedTarget => ({ kind: "text", id: item.id, page: item.page })),
			...bucket.shapes.map((shape): SelectedTarget => ({ kind: "shape", id: shape.id, page: shape.page })),
			...bucket.imageItems.map((image): SelectedTarget => ({ kind: "image", id: image.id, page: image.page }))
		];
		this.selectedTargets = nextSelections;
		this.selectedTarget = nextSelections[0] ?? null;
		this.activeResizeHandle = null;
		this.dragAnchor = null;
		this.drawPageAnnotations(this.currentPage);
		this.refreshToolbar();
		this.refreshStatus(nextSelections.length === 0 ? "No annotations on current page" : `Selected ${nextSelections.length} annotations on page ${this.currentPage}`);
	}

	private clearSelection(message = "Selection cleared"): void {
		if (this.selectedTargets.length === 0 && !this.selectedTarget && !this.lastSelectionRegion) {
			return;
		}
		const pages = new Set(this.selectedTargets.map((target) => target.page));
		if (this.lastSelectionRegion) {
			pages.add(this.lastSelectionRegion.page);
		}
		this.selectedTarget = null;
		this.selectedTargets = [];
		this.lastSelectionRegion = null;
		this.activeResizeHandle = null;
		this.dragAnchor = null;
		if (pages.size > 0) {
			for (const page of pages) {
				this.drawPageAnnotations(page);
			}
		} else {
			this.drawAllAnnotations();
		}
		this.refreshToolbar();
		this.refreshStatus(message);
	}

	private clearRegion(): void {
		if (!this.lastSelectionRegion) {
			return;
		}
		const page = this.lastSelectionRegion.page;
		this.lastSelectionRegion = null;
		this.drawPageAnnotations(page);
		this.refreshToolbar();
		this.refreshStatus("Region cleared");
	}

	private cancelActiveSessionInteraction(): boolean {
		this.unbindPdfPointerDocumentTracking();
		const hasActiveInteraction =
			this.currentStroke !== null ||
			this.currentShape !== null ||
			this.currentLasso !== null ||
			this.dragAnchor !== null ||
			this.activeResizeHandle !== null ||
			this.erasingSession;
		if (!hasActiveInteraction) {
			return false;
		}
		const shouldRestoreHistory =
			this.erasingSession ||
			(this.currentTool === "select" && this.dragAnchor !== null && this.currentLasso === null);
		const previousEntry = shouldRestoreHistory ? this.undoStack.pop() : null;
		const affectedPage = this.pointerPage ?? this.currentStroke?.page ?? this.currentShape?.page ?? this.currentLasso?.page ?? this.currentPage;
		this.currentStroke = null;
		this.currentShape = null;
		this.currentLasso = null;
		this.dragAnchor = null;
		this.activeResizeHandle = null;
		this.dragMoved = false;
		this.erasingSession = false;
		this.lastEraserPoint = null;
		this.eraserSessionPoints = [];
		this.objectErasePreviewTargets.clear();
		this.pointerPage = null;
		if (previousEntry?.kind === "document") {
			this.annotationDocument = previousEntry.document;
			this.nextPageZIndexCache.clear();
			this.invalidateAnnotationPageCache();
			this.isDirty = true;
			this.scheduleSave();
			this.drawAllAnnotations();
		} else {
			if (previousEntry) {
				this.undoStack.push(previousEntry);
			}
			if (isShapeTool(this.currentTool) && this.undoStack.length > 0) {
				this.undoStack.pop();
			}
			this.drawPageAnnotations(affectedPage);
		}
		this.refreshStatus("Cancelled interaction");
		this.refreshToolPreviewFromLastPointer(false);
		return true;
	}

	private nudgeSelectedTargets(deltaX: number, deltaY: number, pushHistory = true): void {
		if (!this.annotationDocument || this.selectedTargets.length === 0) {
			return;
		}
		if (pushHistory) {
			this.pushHistory();
		}
		const pages = new Set(this.selectedTargets.map((target) => target.page));
		this.moveSelectedTargetsWithinPage(this.selectedTargets, deltaX, deltaY);
		this.invalidateAnnotationPageCache();
		this.isDirty = true;
		this.scheduleSave();
		for (const page of pages) {
			this.drawPageAnnotations(page);
		}
		this.refreshStatus(this.selectedTargets.length === 1 ? "Selection nudged" : `Nudged ${this.selectedTargets.length} selections`);
	}

	reorderSelectedTargets(direction: AnnotationReorderDirection): void {
		if (!this.annotationDocument || this.selectedTargets.length === 0) {
			this.refreshStatus("Nothing selected");
			return;
		}
		const selectedByPage = new Map<number, Set<string>>();
		for (const target of this.selectedTargets) {
			let keys = selectedByPage.get(target.page);
			if (!keys) {
				keys = new Set<string>();
				selectedByPage.set(target.page, keys);
			}
			keys.add(`${target.kind}:${target.id}`);
		}
		this.pushHistory();
		let changed = false;
		for (const [pageNumber, selectedKeys] of selectedByPage.entries()) {
			const bucket = this.getPageAnnotationBucket(pageNumber);
			const renderables = getAnnotationRenderables(bucket.strokes, bucket.textItems, bucket.shapes);
			if (reorderRenderables(renderables, selectedKeys, direction)) {
				changed = true;
			}
		}
		if (!changed) {
			if (this.undoStack.length > 0) {
				this.undoStack.pop();
			}
			this.refreshStatus("Nothing selected");
			return;
		}
		const message = direction === "front"
			? "Brought selection to front"
			: direction === "back"
				? "Sent selection to back"
				: direction === "forward"
					? "Brought selection forward"
					: "Sent selection backward";
		this.markDirtyAndRedraw(message);
		this.refreshToolbar();
	}

	private getNextPageZIndex(pageNumber: number): number {
		const cached = this.nextPageZIndexCache.get(pageNumber);
		if (cached !== undefined) {
			this.nextPageZIndexCache.set(pageNumber, cached + 1);
			return cached;
		}
		const bucket = this.getPageAnnotationBucket(pageNumber);
		const renderables = getAnnotationRenderables(bucket.strokes, bucket.textItems, bucket.shapes);
		const imageOrders = bucket.imageItems.map((image) => image.zIndex ?? 0);
		const eraserOrders = bucket.eraserPaths.map((eraserPath) => eraserPath.zIndex ?? 0);
		if (renderables.length === 0 && imageOrders.length === 0 && eraserOrders.length === 0) {
			this.nextPageZIndexCache.set(pageNumber, 1);
			return 0;
		}
		const next = Math.max(...renderables.map((renderable) => getRenderableOrder(renderable)), ...imageOrders, ...eraserOrders) + 1;
		this.nextPageZIndexCache.set(pageNumber, next + 1);
		return next;
	}

	duplicateSelectedTargets(): void {
		if (!this.annotationDocument || this.selectedTargets.length === 0) {
			this.refreshStatus("Nothing selected");
			return;
		}

		const offsetX = 0.018;
		const offsetY = 0.018;
		const nextSelections: SelectedTarget[] = [];
		this.pushHistory();

		for (const target of this.selectedTargets) {
			if (target.kind === "stroke") {
				const stroke = this.annotationDocument.strokes.find((entry) => entry.id === target.id);
				if (!stroke) {
					continue;
				}
				const nextStroke: StrokeAnnotation = {
					...stroke,
					id: generateId("stroke"),
					points: stroke.points.map((point) => ({
						...point,
						x: clamp(point.x + offsetX, 0, 1),
						y: clamp(point.y + offsetY, 0, 1)
					})),
					zIndex: this.getNextPageZIndex(stroke.page),
					createdAt: new Date().toISOString()
				};
				this.annotationDocument.strokes.push(nextStroke);
				nextSelections.push({ kind: "stroke", id: nextStroke.id, page: nextStroke.page });
				continue;
			}

			if (target.kind === "text") {
				const item = this.annotationDocument.textItems.find((entry) => entry.id === target.id);
				if (!item) {
					continue;
				}
				const nextItem: TextAnnotation = {
					...item,
					id: generateId("text"),
					x: clamp(item.x + offsetX, 0, 1),
					y: clamp(item.y + offsetY, 0, 1),
					zIndex: this.getNextPageZIndex(item.page),
					createdAt: new Date().toISOString()
				};
				this.annotationDocument.textItems.push(nextItem);
				nextSelections.push({ kind: "text", id: nextItem.id, page: nextItem.page });
				continue;
			}

			const shape = this.annotationDocument.shapes.find((entry) => entry.id === target.id);
			if (!shape) {
				continue;
			}
			const nextShape: ShapeAnnotation = {
				...shape,
				id: generateId("shape"),
				start: {
					...shape.start,
					x: clamp(shape.start.x + offsetX, 0, 1),
					y: clamp(shape.start.y + offsetY, 0, 1)
				},
				end: {
					...shape.end,
					x: clamp(shape.end.x + offsetX, 0, 1),
					y: clamp(shape.end.y + offsetY, 0, 1)
				},
				zIndex: this.getNextPageZIndex(shape.page),
				createdAt: new Date().toISOString()
			};
			this.annotationDocument.shapes.push(nextShape);
			nextSelections.push({ kind: "shape", id: nextShape.id, page: nextShape.page });
		}

		if (nextSelections.length === 0) {
			if (this.undoStack.length > 0) {
				this.undoStack.pop();
			}
			this.refreshStatus("Nothing duplicated");
			return;
		}

		this.selectedTargets = nextSelections;
		this.selectedTarget = nextSelections[0] ?? null;
		this.lastSelectionRegion = null;
		this.markDirtyAndRedraw(nextSelections.length === 1 ? "Duplicated selection" : `Duplicated ${nextSelections.length} selections`);
		this.refreshToolbar();
	}

	undo(): void {
		if (!this.annotationDocument || this.undoStack.length === 0) {
			this.showDrawingNotice("Nothing to undo", 1200);
			this.refreshStatus("Nothing to undo");
			return;
		}
		const entry = this.undoStack.pop();
		if (!entry) {
			return;
		}
		const affectedPage = entry.kind === "stroke-add" ? entry.stroke.page : this.currentPage;
		if (entry.kind === "document") {
			this.redoStack.push({ kind: "document", document: cloneDocument(this.annotationDocument) });
			this.annotationDocument = entry.document;
			this.nextPageZIndexCache.clear();
		} else {
			const strokeIndex = this.annotationDocument.strokes.findIndex((stroke) => stroke.id === entry.stroke.id);
			if (strokeIndex >= 0) {
				this.annotationDocument.strokes.splice(strokeIndex, 1);
			}
			this.redoStack.push({ kind: "stroke-add", stroke: this.cloneStroke(entry.stroke) });
		}
		this.lastSelectionRegion = null;
		this.invalidateAnnotationPageCache();
		this.isDirty = true;
		this.scheduleSave();
		this.scheduleSyncPages();
		this.redrawHistoryChangeImmediately(affectedPage);
		this.refreshToolbar();
		this.showDrawingNotice(`Undo applied (${this.annotationDocument.strokes.length} strokes)`, 1600);
		this.refreshStatus("Undo applied");
	}

	redo(): void {
		if (!this.annotationDocument || this.redoStack.length === 0) {
			this.showDrawingNotice("Nothing to redo", 1200);
			this.refreshStatus("Nothing to redo");
			return;
		}
		const entry = this.redoStack.pop();
		if (!entry) {
			return;
		}
		const affectedPage = entry.kind === "stroke-add" ? entry.stroke.page : this.currentPage;
		if (entry.kind === "document") {
			this.undoStack.push({ kind: "document", document: cloneDocument(this.annotationDocument) });
			this.annotationDocument = entry.document;
			this.nextPageZIndexCache.clear();
		} else {
			this.undoStack.push({ kind: "stroke-add", stroke: this.cloneStroke(entry.stroke) });
			if (!this.annotationDocument.strokes.some((stroke) => stroke.id === entry.stroke.id)) {
				this.annotationDocument.strokes.push(this.cloneStroke(entry.stroke));
			}
		}
		this.lastSelectionRegion = null;
		this.invalidateAnnotationPageCache();
		this.isDirty = true;
		this.scheduleSave();
		this.scheduleSyncPages();
		this.redrawHistoryChangeImmediately(affectedPage);
		this.refreshToolbar();
		this.showDrawingNotice(`Redo applied (${this.annotationDocument.strokes.length} strokes)`, 1600);
		this.refreshStatus("Redo applied");
	}

	private undoFromToolbar(): void {
		this.finishSessionInlineTextEditor(true);
		this.forceFinishStalePdfInteraction("Finished active annotation before undo");
		this.undo();
	}

	private redoFromToolbar(): void {
		this.finishSessionInlineTextEditor(true);
		this.forceFinishStalePdfInteraction("Finished active annotation before redo");
		this.redo();
	}

	private redrawHistoryChangeImmediately(affectedPage: number): void {
		this.cancelPageRenderJobs("history changed");
		this.cancelPendingInteractionRedraw();
		if (this.redrawHandle !== null) {
			window.cancelAnimationFrame(this.redrawHandle);
			this.redrawHandle = null;
		}
		this.pendingRedrawPages.clear();
		this.retainCommittedPagePixels(affectedPage);
		this.drawPageAnnotations(affectedPage);
		for (const pageNumber of this.pageSurfaces.keys()) {
			if (pageNumber !== affectedPage) {
				this.schedulePageRedraw(pageNumber);
			}
		}
	}

	private getPdfFile(): TFile | null {
		const view = this.leaf.view as PdfLikeView;
		const file = view.file;
		return file && file.extension.toLowerCase() === "pdf" ? file : null;
	}

	private getViewContentEl(): HTMLElement | null {
		const view = this.leaf.view as PdfLikeView;
		return view.contentEl ?? view.containerEl.querySelector(".view-content") ?? view.containerEl;
	}

	private getNativeToolbarEl(): HTMLElement | null {
		if (!this.plugin.shouldPreferInlineToolbar()) {
			return null;
		}
		const viewContentEl = this.getViewContentEl();
		if (!viewContentEl) {
			return null;
		}

		return viewContentEl.querySelector<HTMLElement>(TOOLBAR_SELECTORS);
	}

	private getCurrentMixedPageOrdinal(entries = this.getMixedPageEntries()): number {
		const index = entries.findIndex((entry) => entry.pageNumber === this.currentPage);
		return index >= 0 ? index + 1 : 1;
	}

	private commitNativeMixedPageInput(): void {
		const input = this.nativeMixedPageInputEl;
		const entries = this.getMixedPageEntries();
		if (!input || entries.length === 0) {
			return;
		}
		const requestedOrdinal = clamp(Math.round(Number(input.value) || 1), 1, entries.length);
		input.value = String(requestedOrdinal);
		const entry = entries[requestedOrdinal - 1];
		if (entry) {
			this.goToMixedPage(entry.pageNumber);
		}
	}

	private readonly handleNativeMixedPageInputEvent = (event: Event): void => {
		const input = this.nativeMixedPageInputEl;
		if (!input || event.target !== input) {
			return;
		}
		event.stopImmediatePropagation();
		if (event.type === "focus") {
			input.dataset.freedrawEditing = "true";
			input.value = String(this.getCurrentMixedPageOrdinal());
			input.select();
			return;
		}
		if (event.type === "input") {
			return;
		}
		if (event.type === "change") {
			event.preventDefault();
			this.commitNativeMixedPageInput();
			return;
		}
		if (event.type === "blur") {
			delete input.dataset.freedrawEditing;
			this.commitNativeMixedPageInput();
		}
	};

	private readonly handleNativeMixedPageInputKeyDown = (event: KeyboardEvent): void => {
		const input = this.nativeMixedPageInputEl;
		if (!input || event.target !== input) {
			return;
		}
		event.stopImmediatePropagation();
		const entries = this.getMixedPageEntries();
		if (entries.length === 0) {
			return;
		}
		if (event.key === "Enter") {
			event.preventDefault();
			this.commitNativeMixedPageInput();
			input.blur();
			return;
		}
		if (event.key === "Escape") {
			event.preventDefault();
			input.value = String(this.getCurrentMixedPageOrdinal(entries));
			input.blur();
			return;
		}
		if (event.key === "ArrowUp" || event.key === "ArrowDown" || event.key === "PageUp" || event.key === "PageDown") {
			event.preventDefault();
			const direction = event.key === "ArrowUp" || event.key === "PageUp" ? -1 : 1;
			const currentOrdinal = clamp(Math.round(Number(input.value) || this.getCurrentMixedPageOrdinal(entries)), 1, entries.length);
			input.value = String(clamp(currentOrdinal + direction, 1, entries.length));
			this.commitNativeMixedPageInput();
		}
	};

	private detachNativeMixedPageNavigator(): void {
		const input = this.nativeMixedPageInputEl;
		if (input) {
			input.removeEventListener("focus", this.handleNativeMixedPageInputEvent, true);
			input.removeEventListener("input", this.handleNativeMixedPageInputEvent, true);
			input.removeEventListener("change", this.handleNativeMixedPageInputEvent, true);
			input.removeEventListener("blur", this.handleNativeMixedPageInputEvent, true);
			input.removeEventListener("keydown", this.handleNativeMixedPageInputKeyDown, true);
			input.classList.remove("pdf-native-annotator-native-mixed-page-input");
			const nativePage = this.getNativePdfCurrentPageNumber() ?? 1;
			input.value = String(nativePage);
			input.min = input.dataset.freedrawOriginalMin ?? "1";
			input.max = input.dataset.freedrawOriginalMax ?? String(Math.max(1, this.realPdfPageCount));
			const originalLabel = input.dataset.freedrawOriginalAriaLabel;
			if (originalLabel) {
				input.setAttribute("aria-label", originalLabel);
			} else {
				input.removeAttribute("aria-label");
			}
			delete input.dataset.freedrawOriginalMin;
			delete input.dataset.freedrawOriginalMax;
			delete input.dataset.freedrawOriginalAriaLabel;
			delete input.dataset.freedrawEditing;
			input.removeAttribute("aria-valuetext");
		}
		const countEl = this.nativeMixedPageCountEl;
		if (countEl) {
			countEl.textContent = countEl.dataset.freedrawOriginalText ?? `of ${Math.max(1, this.realPdfPageCount)}`;
			countEl.classList.remove("pdf-native-annotator-native-mixed-page-count");
			delete countEl.dataset.freedrawOriginalText;
		}
		this.nativeMixedPageInputEl = null;
		this.nativeMixedPageCountEl = null;
	}

	private syncNativeMixedPageNavigator(): void {
		const hasMixedPages = this.getAppendedPages().length > 0 || (this.annotationDocument?.deletedPdfPages?.length ?? 0) > 0;
		if (!hasMixedPages) {
			this.detachNativeMixedPageNavigator();
			return;
		}
		const view = this.leaf.view as PdfLikeView;
		const nativeToolbar = view.containerEl.querySelector<HTMLElement>(TOOLBAR_SELECTORS)
			?? this.getViewContentEl()?.querySelector<HTMLElement>(TOOLBAR_SELECTORS)
			?? null;
		const input = Array.from(nativeToolbar?.querySelectorAll<HTMLInputElement>('input[type="number"], input') ?? [])
			.find((candidate) => !candidate.closest(`.${SESSION_ROOT_CLASS}`) && candidate.offsetParent !== null) ?? null;
		if (!input) {
			return;
		}
		if (this.nativeMixedPageInputEl && this.nativeMixedPageInputEl !== input) {
			this.detachNativeMixedPageNavigator();
		}
		if (!this.nativeMixedPageInputEl) {
			this.nativeMixedPageInputEl = input;
			input.dataset.freedrawOriginalMin = input.getAttribute("min") ?? "";
			input.dataset.freedrawOriginalMax = input.getAttribute("max") ?? "";
			input.dataset.freedrawOriginalAriaLabel = input.getAttribute("aria-label") ?? "";
			input.addEventListener("focus", this.handleNativeMixedPageInputEvent, true);
			input.addEventListener("input", this.handleNativeMixedPageInputEvent, true);
			input.addEventListener("change", this.handleNativeMixedPageInputEvent, true);
			input.addEventListener("blur", this.handleNativeMixedPageInputEvent, true);
			input.addEventListener("keydown", this.handleNativeMixedPageInputKeyDown, true);
			input.classList.add("pdf-native-annotator-native-mixed-page-input");
		}
		const entries = this.getMixedPageEntries();
		const ordinal = this.getCurrentMixedPageOrdinal(entries);
		input.min = "1";
		input.max = String(Math.max(1, entries.length));
		input.setAttribute("aria-label", "Mixed page");
		input.setAttribute("aria-valuetext", `Page ${ordinal} of ${entries.length}`);
		if (input.dataset.freedrawEditing !== "true") {
			input.value = String(ordinal);
		}

		if (!this.nativeMixedPageCountEl?.isConnected) {
			const scope = input.parentElement?.parentElement ?? nativeToolbar;
			const inputRect = input.getBoundingClientRect();
			const candidates = Array.from(scope?.querySelectorAll<HTMLElement>("span, div") ?? [])
				.filter((candidate) => candidate !== input.parentElement && /^of\s+\d+$/i.test(candidate.textContent?.trim() ?? ""))
				.sort((first, second) => {
					const firstRect = first.getBoundingClientRect();
					const secondRect = second.getBoundingClientRect();
					return Math.abs(firstRect.left - inputRect.right) - Math.abs(secondRect.left - inputRect.right);
				});
			this.nativeMixedPageCountEl = candidates[0] ?? null;
			if (this.nativeMixedPageCountEl) {
				this.nativeMixedPageCountEl.dataset.freedrawOriginalText = this.nativeMixedPageCountEl.textContent ?? "";
				this.nativeMixedPageCountEl.classList.add("pdf-native-annotator-native-mixed-page-count");
			}
		}
		if (this.nativeMixedPageCountEl) {
			this.nativeMixedPageCountEl.textContent = `of ${entries.length}`;
		}
	}

	private getNativePdfEventBus(): { on?: (name: string, callback: (data?: unknown) => void) => void; off?: (name: string, callback: (data?: unknown) => void) => void } | null {
		const view = this.leaf.view as PdfLikeView & {
			viewer?: {
				child?: {
					pdfViewer?: {
						eventBus?: { on?: (name: string, callback: (data?: unknown) => void) => void; off?: (name: string, callback: (data?: unknown) => void) => void };
						pdfViewer?: { eventBus?: { on?: (name: string, callback: (data?: unknown) => void) => void; off?: (name: string, callback: (data?: unknown) => void) => void } };
					};
				};
			};
		};
		return view.viewer?.child?.pdfViewer?.eventBus ?? view.viewer?.child?.pdfViewer?.pdfViewer?.eventBus ?? null;
	}

	private getNativePdfCurrentPageNumber(): number | null {
		const view = this.leaf.view as PdfLikeView & {
			viewer?: {
				child?: {
					pdfViewer?: {
						currentPageNumber?: unknown;
						pdfViewer?: { currentPageNumber?: unknown };
					};
				};
			};
		};
		const wrapper = view.viewer?.child?.pdfViewer;
		const candidates = [
			wrapper?.pdfViewer?.currentPageNumber,
			wrapper?.currentPageNumber
		];
		for (const candidate of candidates) {
			const pageNumber = Number(candidate);
			if (Number.isFinite(pageNumber) && pageNumber >= 1 && pageNumber <= this.realPdfPageCount) {
				return Math.round(pageNumber);
			}
		}

		const toolbar = this.getNativeToolbarEl();
		const pageInput = toolbar?.querySelector<HTMLInputElement>(
			'input[type="number"], input.pdf-page-input, input.toolbarField.pageNumber'
		);
		const inputPage = Number(pageInput?.value);
		return Number.isFinite(inputPage) && inputPage >= 1 && inputPage <= this.realPdfPageCount
			? Math.round(inputPage)
			: null;
	}

	private syncCurrentPageForPageAction(): void {
		this.updateCurrentPageFromScroll();
		if (this.currentPage > this.realPdfPageCount) {
			return;
		}
		const nativePageNumber = this.getNativePdfCurrentPageNumber();
		if (nativePageNumber !== null) {
			this.currentPage = nativePageNumber;
		}
	}

	private bindNativePdfEvents(): void {
		const eventBus = this.getNativePdfEventBus();
		if (!eventBus || eventBus === this.nativeEventBus || typeof eventBus.on !== "function") {
			return;
		}
		this.unbindNativePdfEvents();
		this.nativeEventBus = eventBus;
		const addHandler = (name: string, callback: (data?: unknown) => void): void => {
			eventBus.on?.(name, callback);
			this.nativeEventHandlers.push({ name, callback });
		};
		addHandler("pagerendered", () => this.scheduleLayoutRefresh());
		addHandler("pagesloaded", () => this.scheduleLayoutRefresh());
		addHandler("pagechanging", (data?: unknown) => {
			const pageNumber = typeof data === "object" && data !== null && "pageNumber" in data
				? Number((data as { pageNumber?: unknown }).pageNumber)
				: NaN;
			if (Number.isFinite(pageNumber) && pageNumber > 0) {
				this.currentPage = pageNumber;
				this.updateNativeMixedPageThumbnailSelection();
				this.syncNativeMixedPageNavigator();
			}
		});
		addHandler("scalechanging", () => {
			this.captureZoomScrollAnchor();
			this.markRealPagesZooming();
			this.scheduleSyntheticPageZoomPreview();
		});
		addHandler("scalechanged", () => {
			this.scheduleFinishZoomingPages();
			this.scheduleSyntheticPageZoomPreview();
			this.scheduleZoomScrollAnchorRestore();
			this.scheduleLayoutRefresh();
		});
	}

	private unbindNativePdfEvents(): void {
		if (this.nativeEventBus?.off) {
			for (const { name, callback } of this.nativeEventHandlers) {
				this.nativeEventBus.off(name, callback);
			}
		}
		this.nativeEventBus = null;
		this.nativeEventHandlers = [];
	}

	private markRealPagesZooming(): void {
		for (const pageNumber of this.pageSurfaces.keys()) {
			if (
				this.shouldKeepPageHot(pageNumber) ||
				this.zoomScrollAnchor?.pageNumber === pageNumber ||
				this.inlineTextPageNumber === pageNumber
			) {
				this.zoomingPages.add(pageNumber);
			}
		}
	}

	private captureZoomScrollAnchor(): void {
		if (this.zoomScrollAnchor) {
			return;
		}
		const scrollEl = this.scrollParent;
		if (!scrollEl?.isConnected || this.pageSurfaces.size === 0) {
			return;
		}
		const containerRect = scrollEl.getBoundingClientRect();
		const viewportY = containerRect.height / 2;
		const clientY = containerRect.top + viewportY;
		const ownerDocument = scrollEl.ownerDocument;
		const clientX = containerRect.left + (containerRect.width / 2);
		const sampleOffsets = [0, -0.12, 0.12, -0.28, 0.28];
		let surface: PageSurface | null = null;
		for (const offset of sampleOffsets) {
			const sampleY = clientY + (containerRect.height * offset);
			const hitTarget = ownerDocument.elementFromPoint(clientX, sampleY);
			const hitPageEl = hitTarget?.closest<HTMLElement>(
				'.page[data-page-number], .pdf-page[data-page-number], .pdf-native-annotator-synthetic-page[data-page-number]'
			) ?? null;
			const hitPageNumber = Number(hitPageEl?.dataset.pageNumber);
			const candidate = Number.isFinite(hitPageNumber) ? this.pageSurfaces.get(hitPageNumber) : null;
			if (candidate?.pageEl.isConnected) {
				surface = candidate;
				break;
			}
		}
		if (!surface) {
			const currentSurface = this.pageSurfaces.get(this.currentPage);
			if (currentSurface?.pageEl.isConnected) {
				const currentRect = currentSurface.pageEl.getBoundingClientRect();
				const closeToViewport = currentRect.bottom >= containerRect.top - containerRect.height &&
					currentRect.top <= containerRect.bottom + containerRect.height;
				if (closeToViewport) {
					surface = currentSurface;
				}
			}
		}
		if (!surface) {
			return;
		}
		const pageRect = surface.pageEl.getBoundingClientRect();
		if (pageRect.height <= 0) {
			return;
		}
		const pageTop = pageRect.top - containerRect.top + scrollEl.scrollTop;
		const anchor = captureZoomPageAnchor(
			surface.pageNumber,
			scrollEl.scrollTop + viewportY,
			pageTop,
			pageRect.height
		);
		this.zoomScrollAnchor = {
			...anchor,
			viewportY
		};
	}

	private scheduleZoomScrollAnchorRestore(clearAfterRestore = false): void {
		if (!this.zoomScrollAnchor) {
			return;
		}
		if (this.zoomAnchorRestoreHandle !== null) {
			window.cancelAnimationFrame(this.zoomAnchorRestoreHandle);
		}
		this.zoomAnchorRestoreHandle = window.requestAnimationFrame(() => {
			this.zoomAnchorRestoreHandle = null;
			this.restoreZoomScrollAnchor();
			if (clearAfterRestore) {
				this.zoomScrollAnchor = null;
			}
		});
	}

	private restoreZoomScrollAnchor(): void {
		const anchor = this.zoomScrollAnchor;
		const scrollEl = this.scrollParent;
		const surface = anchor ? this.pageSurfaces.get(anchor.pageNumber) : null;
		if (!anchor || !scrollEl?.isConnected || !surface?.pageEl.isConnected) {
			return;
		}
		const containerRect = scrollEl.getBoundingClientRect();
		const pageRect = surface.pageEl.getBoundingClientRect();
		if (pageRect.height <= 0) {
			return;
		}
		const pageTop = pageRect.top - containerRect.top + scrollEl.scrollTop;
		const maxScrollTop = Math.max(0, scrollEl.scrollHeight - scrollEl.clientHeight);
		const anchoredContentY = resolveZoomPageScrollTop(
			anchor,
			pageTop,
			pageRect.height,
			maxScrollTop + anchor.viewportY
		);
		const targetScrollTop = clamp(anchoredContentY - anchor.viewportY, 0, maxScrollTop);
		if (Math.abs(scrollEl.scrollTop - targetScrollTop) >= 0.5) {
			scrollEl.scrollTop = targetScrollTop;
		}
	}

	private ensureUi(): void {
		const viewContentEl = this.getViewContentEl();
		if (!viewContentEl || this.rootEl) {
			return;
		}

		viewContentEl.classList.add("pdf-native-annotator-host");

		this.rootEl = createDiv();
		this.rootEl.className = SESSION_ROOT_CLASS;

		this.toolbarEl = createDiv();
		this.toolbarEl.className = "pdf-native-annotator-toolbar";
		this.toolbarEl.title = "Drag empty space to move the annotation toolbar";
		this.toolbarEl.addEventListener("pointerdown", this.handleToolbarDragStart);

		this.statusEl = createDiv();
		this.statusEl.className = "pdf-native-annotator-status";
		this.statusEl.textContent = "";

		this.toolPreviewEl = createDiv();
		this.toolPreviewEl.className = "pdf-native-annotator-tool-preview is-hidden";

		this.rootEl.appendChild(this.toolbarEl);
		this.mountUi();
		viewContentEl.appendChild(this.toolPreviewEl);
		this.syncRenderTelemetry();
		viewContentEl.addEventListener("touchstart", this.handleZoomGestureTouchStart, { capture: true, passive: true });
		viewContentEl.addEventListener("wheel", this.handleZoomGestureWheel, { capture: true, passive: true });
		viewContentEl.addEventListener("gesturestart", this.handleZoomGestureStart, { capture: true, passive: true });
		viewContentEl.addEventListener("pointerdown", this.handleViewPointerDown, { capture: true });
		viewContentEl.addEventListener("pointermove", this.handleViewPointerMove, { passive: true });
		viewContentEl.addEventListener("pointerleave", this.handleViewPointerLeave, { passive: true });
		document.addEventListener("pointerdown", this.handleDocumentPointerDown, true);
		document.addEventListener("touchstart", this.handleDocumentTouchStart, { capture: true, passive: false });
		window.addEventListener("resize", this.handleViewportResize, { passive: true });
		this.captureVisualViewportBaseline();
		window.visualViewport?.addEventListener("resize", this.handleVisualViewportChange, { passive: true });
		window.visualViewport?.addEventListener("scroll", this.handleVisualViewportChange, { passive: true });
	}

	private mountUi(): void {
		if (!this.rootEl) {
			return;
		}

		const nativeToolbarEl = this.getNativeToolbarEl();
		const viewContentEl = this.getViewContentEl();
		if (nativeToolbarEl) {
			this.rootEl.classList.add("is-inline");
			this.rootEl.classList.remove("is-floating");
			this.rootEl.setCssStyles({
				top: "",
				right: "",
				left: ""
			});
			if (this.rootEl.parentElement !== nativeToolbarEl) {
				nativeToolbarEl.appendChild(this.rootEl);
			}
			return;
		}

		if (viewContentEl) {
			viewContentEl.classList.add("pdf-native-annotator-host");
			this.rootEl.classList.add("is-floating");
			this.rootEl.classList.remove("is-inline");
			this.applyFloatingToolbarPosition();
			if (this.rootEl.parentElement !== viewContentEl) {
				viewContentEl.appendChild(this.rootEl);
			}
		}
	}

	private syncRenderTelemetry(): void {
		const viewContentEl = this.getViewContentEl();
		if (viewContentEl && this.plugin.shouldShowRenderTelemetry()) {
			this.renderTelemetry.attach(viewContentEl);
			return;
		}
		this.renderTelemetry.dispose();
	}

	private applyFloatingToolbarPosition(): void {
		if (!this.rootEl) {
			return;
		}
		this.rootEl.setCssStyles({
			top: `${this.floatingToolbarOffset.top}px`,
			right: `${this.floatingToolbarOffset.right}px`,
			left: "auto"
		});
	}

	private readonly handleToolbarDragStart = (event: PointerEvent): void => {
		if (!this.rootEl?.classList.contains("is-floating")) {
			return;
		}
		if (this.isToolbarInteractiveTarget(event.target)) {
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		this.floatingToolbarDrag = {
			startX: event.clientX,
			startY: event.clientY,
			startRight: this.floatingToolbarOffset.right,
			startTop: this.floatingToolbarOffset.top
		};
		this.rootEl.classList.add("is-dragging");
		window.addEventListener("pointermove", this.handleToolbarDragMove, { passive: false });
		window.addEventListener("pointerup", this.handleToolbarDragEnd, { once: true });
		window.addEventListener("pointercancel", this.handleToolbarDragEnd, { once: true });
	};

	private isToolbarInteractiveTarget(target: EventTarget | null): boolean {
		const element = isDomElement(target) ? target : null;
		return !!element?.closest("button, input, select, textarea, a, .clickable-icon, .pdf-native-annotator-preset, .pdf-native-annotator-swatch");
	}

	private readonly handleToolbarDragMove = (event: PointerEvent): void => {
		if (!this.rootEl || !this.floatingToolbarDrag) {
			return;
		}
		event.preventDefault();
		const viewContentEl = this.getViewContentEl();
		const bounds = viewContentEl?.getBoundingClientRect();
		const toolbarRect = this.rootEl.getBoundingClientRect();
		const maxTop = Math.max(0, (bounds?.height ?? window.innerHeight) - toolbarRect.height - 8);
		const maxRight = Math.max(0, (bounds?.width ?? window.innerWidth) - Math.min(toolbarRect.width, bounds?.width ?? window.innerWidth) - 8);
		this.floatingToolbarOffset = {
			right: clamp(this.floatingToolbarDrag.startRight - (event.clientX - this.floatingToolbarDrag.startX), 8, maxRight),
			top: clamp(this.floatingToolbarDrag.startTop + (event.clientY - this.floatingToolbarDrag.startY), 8, maxTop)
		};
		this.applyFloatingToolbarPosition();
	};

	private readonly handleToolbarDragEnd = (): void => {
		this.rootEl?.classList.remove("is-dragging");
		this.floatingToolbarDrag = null;
		window.removeEventListener("pointermove", this.handleToolbarDragMove);
		window.removeEventListener("pointerup", this.handleToolbarDragEnd);
		window.removeEventListener("pointercancel", this.handleToolbarDragEnd);
	};

	private observePdfDom(): void {
		const viewContentEl = this.getViewContentEl();
		if (!viewContentEl) {
			return;
		}
		const observationRoot = (this.leaf.view as PdfLikeView).containerEl ?? viewContentEl;

		this.destroyObservers();

		this.mutationObserver = new MutationObserver((records) => {
			const externalChange = records.some((record) => this.isExternalPdfMutation(record));
			if (!externalChange) {
				return;
			}
			this.mountUi();
			this.scheduleLayoutRefresh();
		});
		this.mutationObserver.observe(observationRoot, {
			childList: true,
			subtree: true
		});

		if (typeof ResizeObserver !== "undefined") {
			this.viewResizeObserver = new ResizeObserver(() => {
				this.scheduleRepositionOpenPopovers();
				this.scheduleLayoutRefresh();
			});
			this.viewResizeObserver.observe(viewContentEl);
			const scrollParent = findScrollParent(viewContentEl);
			if (scrollParent !== viewContentEl) {
				this.viewResizeObserver.observe(scrollParent);
			}
		}
	}

	private isExternalPdfMutation(record: MutationRecord): boolean {
		if (!isDomNode(record.target)) {
			return true;
		}
		if (record.type === "childList") {
			const changedNodes = [...Array.from(record.addedNodes), ...Array.from(record.removedNodes)];
			return changedNodes.some((node) => !this.isOwnedAnnotatorDom(node));
		}
		if (this.isOwnedAnnotatorDom(record.target)) {
			return false;
		}
		const element = isDomElement(record.target) ? record.target : record.target.parentElement;
		return !!element?.closest(".pdfViewer, .page[data-page-number], .pdf-page[data-page-number], .canvasWrapper");
	}

	private isOwnedAnnotatorDom(target: Node): boolean {
		if (this.isSyncingSyntheticPages) {
			return true;
		}
		if (this.rootEl?.contains(target)) {
			return true;
		}
		if (this.toolPreviewEl?.contains(target)) {
			return true;
		}
		const element = isDomElement(target) ? target : target.parentElement;
		return !!element?.closest(".pdf-native-annotator-synthetic-pages, .pdf-native-annotator-synthetic-page, .pdf-native-annotator-overlay, .pdf-native-annotator-transient, .pdf-native-annotator-template-background, .pdf-native-annotator-native-page-entry, .pdf-native-annotator-native-page-footer");
	}

	private destroyObservers(): void {
		this.finishFingerPan(false);
		this.cancelFingerPanInertia();
		if (this.syncHandle !== null) {
			window.cancelAnimationFrame(this.syncHandle);
			this.syncHandle = null;
		}
		if (this.scrollHandle !== null) {
			window.cancelAnimationFrame(this.scrollHandle);
			this.scrollHandle = null;
		}
		if (this.scrollIdleHandle !== null) {
			window.clearTimeout(this.scrollIdleHandle);
			this.scrollIdleHandle = null;
		}
		if (this.redrawHandle !== null) {
			window.cancelAnimationFrame(this.redrawHandle);
			this.redrawHandle = null;
		}
		if (this.committedRedrawHandle !== null) {
			window.clearTimeout(this.committedRedrawHandle);
			this.committedRedrawHandle = null;
		}
		if (this.interactionRedrawHandle !== null) {
			window.cancelAnimationFrame(this.interactionRedrawHandle);
			this.interactionRedrawHandle = null;
		}
		this.cancelPageRenderJobs();
		this.pageRenderSlots.clear();
		if (this.popoverRepositionHandle !== null) {
			window.cancelAnimationFrame(this.popoverRepositionHandle);
			this.popoverRepositionHandle = null;
		}
		if (this.toolbarScrollRestoreHandle !== null) {
			window.cancelAnimationFrame(this.toolbarScrollRestoreHandle);
			this.toolbarScrollRestoreHandle = null;
		}
		if (this.thumbnailScrollRestoreHandle !== null) {
			window.cancelAnimationFrame(this.thumbnailScrollRestoreHandle);
			this.thumbnailScrollRestoreHandle = null;
		}
		if (this.keyboardAvoidanceHandle !== null) {
			window.cancelAnimationFrame(this.keyboardAvoidanceHandle);
			this.keyboardAvoidanceHandle = null;
		}
		this.clearPendingWebKitTouchPointer();
		this.clearLayoutRefreshHandles();
		if (this.zoomSettleHandle !== null) {
			window.clearTimeout(this.zoomSettleHandle);
			this.zoomSettleHandle = null;
		}
		if (this.zoomAnchorRestoreHandle !== null) {
			window.cancelAnimationFrame(this.zoomAnchorRestoreHandle);
			this.zoomAnchorRestoreHandle = null;
		}
		if (this.syntheticZoomPreviewHandle !== null) {
			window.cancelAnimationFrame(this.syntheticZoomPreviewHandle);
			this.syntheticZoomPreviewHandle = null;
		}
		this.zoomScrollAnchor = null;
		if (this.statusResetHandle !== null) {
			window.clearTimeout(this.statusResetHandle);
			this.statusResetHandle = null;
		}
		this.mutationObserver?.disconnect();
		this.mutationObserver = null;
		this.viewResizeObserver?.disconnect();
		this.viewResizeObserver = null;
		for (const observer of this.pageResizeObservers.values()) {
			observer.disconnect();
		}
		this.pageResizeObservers.clear();
		this.pendingRedrawPages.clear();
		this.pendingInteractionRedrawPages.clear();
		this.pendingCommittedRedrawPages.clear();
		this.zoomingPages.clear();
		this.isPdfScrolling = false;
		this.visualViewportBaselineHeight = 0;
		this.needsToolbarRefreshAfterScroll = false;
		if (this.scrollParent) {
			this.scrollParent.removeEventListener("scroll", this.handleScroll, { capture: false });
			this.scrollParent = null;
		}
		window.removeEventListener("resize", this.handleViewportResize);
		window.visualViewport?.removeEventListener("resize", this.handleVisualViewportChange);
		window.visualViewport?.removeEventListener("scroll", this.handleVisualViewportChange);
	}

	private scheduleSyncPages(): void {
		if (this.syncHandle !== null) {
			return;
		}
		this.syncHandle = window.requestAnimationFrame(() => {
			this.syncHandle = null;
			this.syncPages();
		});
	}

	private syncPages(redrawAnnotations = true): void {
		if (!this.file || !this.annotationDocument) {
			return;
		}

		const viewContentEl = this.getViewContentEl();
		if (!viewContentEl) {
			return;
		}

		const rawRealPageEls = this.getRealPdfPageElements(viewContentEl);

		if (rawRealPageEls.length === 0) {
			this.refreshStatus(`Waiting for ${this.file.name} pages...`, 1800);
			return;
		}

		this.realPdfPageCount = rawRealPageEls.reduce((maxPage, entry) => Math.max(maxPage, entry.pageNumber), 0);
		this.applyDeletedPdfPageVisibility(rawRealPageEls);
		this.syncSyntheticPages(rawRealPageEls);
		const syntheticPageEls = Array.from(viewContentEl.querySelectorAll<HTMLElement>(".pdf-native-annotator-synthetic-page[data-page-number]"))
			.map((pageEl) => {
				const rawPage = Number(pageEl.getAttribute("data-page-number"));
				return Number.isFinite(rawPage) && rawPage > 0 ? { pageEl, pageNumber: rawPage } : null;
			})
			.filter((entry): entry is { pageEl: HTMLElement; pageNumber: number } => !!entry);
		const realPageEls = rawRealPageEls.filter((entry) => !this.isPdfPageDeleted(entry.pageNumber));
		const pageEls = [...realPageEls, ...syntheticPageEls];
		const nextPages = new Set<number>();
		for (const { pageEl, pageNumber } of pageEls) {
			nextPages.add(pageNumber);
			try {
				this.ensurePageSurface(pageEl, pageNumber);
			} catch (error) {
				console.error(`freedraw-pdf: failed to attach overlay to page ${pageNumber}`, error);
			}
		}

		for (const [pageNumber, surface] of this.pageSurfaces.entries()) {
			if (!nextPages.has(pageNumber)) {
				this.pageResizeObservers.get(pageNumber)?.disconnect();
				this.pageResizeObservers.delete(pageNumber);
				surface.overlayEl.remove();
				surface.transientEl.remove();
				this.pageSurfaces.delete(pageNumber);
			}
		}

		this.applyOverlayMode();
		this.bindScrollParent((realPageEls[0] ?? rawRealPageEls[0]).pageEl);
		this.updateCurrentPageFromScroll();
		this.syncNativeMixedPageNavigator();
		this.syncNativeMixedPageThumbnails(viewContentEl);
		this.updateVisiblePageRange();
		if (redrawAnnotations) {
			this.drawAllAnnotations();
			this.refreshToolbar();
		}
	}

	private applyDeletedPdfPageVisibility(realPageEls: { pageEl: HTMLElement; pageNumber: number }[]): void {
		for (const { pageEl, pageNumber } of realPageEls) {
			const isDeleted = this.isPdfPageDeleted(pageNumber);
			pageEl.classList.toggle("pdf-native-annotator-deleted-pdf-page", isDeleted);
			this.setStyleIfChanged(pageEl, "display", isDeleted ? "none" : "");
			pageEl.setAttribute("aria-hidden", isDeleted ? "true" : "false");
		}
	}

	private getPrimaryPdfViewerEl(viewContentEl: HTMLElement): HTMLElement | null {
		const viewers = Array.from(viewContentEl.querySelectorAll<HTMLElement>(".pdfViewer"));
		if (viewers.length === 0) {
			return null;
		}
		let bestViewer: { element: HTMLElement; score: number } | null = null;
		for (const viewer of viewers) {
			if (!viewer.isConnected) {
				continue;
			}
			const style = window.getComputedStyle(viewer);
			if (style.display === "none" || style.visibility === "hidden") {
				continue;
			}
			const rect = viewer.getBoundingClientRect();
			const pageCount = viewer.querySelectorAll(".page[data-page-number], .pdf-page[data-page-number]").length;
			if (pageCount === 0) {
				continue;
			}
			const area = Math.max(1, rect.width * rect.height);
			const score = area + (pageCount * 1000);
			if (!bestViewer || score > bestViewer.score) {
				bestViewer = { element: viewer, score };
			}
		}
		return bestViewer?.element ?? null;
	}

	private getRealPdfPageElements(viewContentEl: HTMLElement): { pageEl: HTMLElement; pageNumber: number }[] {
		const pdfViewerEl = this.getPrimaryPdfViewerEl(viewContentEl);
		const candidates = pdfViewerEl
			? Array.from(pdfViewerEl.querySelectorAll<HTMLElement>(".page[data-page-number], .pdf-page[data-page-number]"))
			: Array.from(viewContentEl.querySelectorAll<HTMLElement>(PAGE_SELECTORS));
		const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
		const bestByPage = new Map<number, { pageEl: HTMLElement; pageNumber: number; area: number; visibleScore: number; hasCanvas: boolean }>();
		for (const pageEl of candidates) {
			if (!pageEl.isConnected) {
				continue;
			}
			if (pageEl.classList.contains("pdf-native-annotator-synthetic-page")) {
				continue;
			}
			if (pageEl.closest(".pdf-native-annotator-synthetic-pages")) {
				continue;
			}
			const rawPage = Number(pageEl.getAttribute("data-page-number"));
			if (!Number.isFinite(rawPage) || rawPage <= 0) {
				continue;
			}
			const hostEl = getOverlayHost(pageEl);
			if (!hostEl.isConnected) {
				continue;
			}
			const isDeletedPdfPage = pageEl.classList.contains("pdf-native-annotator-deleted-pdf-page");
			const pageStyle = window.getComputedStyle(pageEl);
			const hostStyle = window.getComputedStyle(hostEl);
			if (
				!isDeletedPdfPage &&
				(pageStyle.display === "none" || hostStyle.display === "none" || pageStyle.visibility === "hidden" || hostStyle.visibility === "hidden")
			) {
				continue;
			}
			const canvas = hostEl.querySelector("canvas") ?? pageEl.querySelector("canvas");
			const rect = hostEl.getBoundingClientRect();
			const pageRect = pageEl.getBoundingClientRect();
			const width = Math.max(rect.width, pageRect.width, hostEl.clientWidth, pageEl.clientWidth, isHtmlCanvasElement(canvas) ? canvas.clientWidth : 0);
			const height = Math.max(rect.height, pageRect.height, hostEl.clientHeight, pageEl.clientHeight, isHtmlCanvasElement(canvas) ? canvas.clientHeight : 0);
			const hasCanvas = isHtmlCanvasElement(canvas);
			if (!isDeletedPdfPage && ((!hasCanvas && width < 180) || width <= 2 || height <= 2)) {
				continue;
			}
			const area = Math.max(1, width * height);
			const intersectsViewport = rect.bottom > 0 && (!viewportHeight || rect.top < viewportHeight);
			const visibleScore = (intersectsViewport ? 2 : 0) + (hasCanvas ? 1 : 0);
			const existing = bestByPage.get(rawPage);
			if (
				!existing ||
				visibleScore > existing.visibleScore ||
				(visibleScore === existing.visibleScore && area > existing.area)
			) {
				bestByPage.set(rawPage, { pageEl, pageNumber: rawPage, area, visibleScore, hasCanvas });
			}
		}
		return Array.from(bestByPage.values())
			.sort((first, second) => first.pageNumber - second.pageNumber)
			.map(({ pageEl, pageNumber }) => ({ pageEl, pageNumber }));
	}

	private getNativePdfThumbnailPageNumber(linkEl: HTMLElement): number | null {
		const thumbnailEl = linkEl.querySelector<HTMLElement>(".thumbnail");
		const candidates = [
			thumbnailEl?.dataset.pageNumber,
			thumbnailEl?.dataset.pageLabel,
			linkEl.dataset.pageNumber,
			linkEl.getAttribute("aria-label")
		];
		for (const candidate of candidates) {
			const match = candidate?.match(/\d+/);
			if (!match) {
				continue;
			}
			const pageNumber = Number(match[0]);
			if (Number.isInteger(pageNumber) && pageNumber > 0) {
				return pageNumber;
			}
		}
		const href = linkEl.getAttribute("href") ?? "";
		const hrefMatch = href.match(/(?:page=|page-)(\d+)/i);
		if (!hrefMatch) {
			return null;
		}
		const pageNumber = Number(hrefMatch[1]);
		return Number.isInteger(pageNumber) && pageNumber > 0 ? pageNumber : null;
	}

	private getNativePdfThumbnailView(viewContentEl: HTMLElement): HTMLElement | null {
		const view = this.leaf.view as PdfLikeView;
		const roots = new Set<HTMLElement>([viewContentEl, view.containerEl]);
		const candidates = Array.from(roots)
			.flatMap((root) => Array.from(root.querySelectorAll<HTMLElement>(".pdf-sidebar-container .pdf-thumbnail-view")));
		if (candidates.length === 0) {
			return null;
		}
		return candidates.reduce((best, candidate) => {
			const candidateCount = candidate.querySelectorAll(":scope > a .thumbnail").length;
			const bestCount = best.querySelectorAll(":scope > a .thumbnail").length;
			return candidateCount > bestCount ? candidate : best;
		});
	}

	private cleanupNativeMixedPageThumbnails(): void {
		const thumbnailViews = new Set<HTMLElement>();
		if (this.nativeMixedThumbnailViewEl) {
			thumbnailViews.add(this.nativeMixedThumbnailViewEl);
		}
		const viewContentEl = this.getViewContentEl();
		const view = this.leaf.view as PdfLikeView;
		for (const root of [viewContentEl, view.containerEl]) {
			for (const thumbnailView of Array.from(root?.querySelectorAll<HTMLElement>(".pdf-thumbnail-view") ?? [])) {
				thumbnailViews.add(thumbnailView);
			}
		}
		for (const thumbnailView of thumbnailViews) {
			thumbnailView.classList.remove("pdf-native-annotator-has-synthetic-selection");
			thumbnailView.querySelectorAll(".pdf-native-annotator-native-page-entry, .pdf-native-annotator-native-page-footer")
				.forEach((element) => element.remove());
			thumbnailView.querySelectorAll(".pdf-native-annotator-native-pdf-page-hidden")
				.forEach((element) => element.classList.remove("pdf-native-annotator-native-pdf-page-hidden"));
			thumbnailView.querySelectorAll<HTMLElement>("[data-freedraw-native-context-bound='true']")
				.forEach((element) => {
					element.removeEventListener("contextmenu", this.handleNativePdfThumbnailContextMenu);
					delete element.dataset.freedrawNativeContextBound;
				});
		}
		this.nativeMixedThumbnailViewEl = null;
		this.nativeMixedThumbnailSignature = "";
	}

	private getNativeThumbnailScrollParent(thumbnailView: HTMLElement): HTMLElement | null {
		const sidebar = thumbnailView.closest<HTMLElement>(".pdf-sidebar-container");
		if (!sidebar) {
			return null;
		}
		let current: HTMLElement | null = thumbnailView;
		while (current && sidebar.contains(current)) {
			const style = window.getComputedStyle(current);
			if (style.overflowY === "auto" || style.overflowY === "scroll") {
				return current;
			}
			if (current === sidebar) {
				break;
			}
			current = current.parentElement;
		}
		return null;
	}

	private readonly handleNativePdfThumbnailContextMenu = (event: MouseEvent): void => {
		if (!this.annotationDocument) {
			return;
		}
		const linkEl = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
		if (!linkEl) {
			return;
		}
		const pageNumber = this.getNativePdfThumbnailPageNumber(linkEl);
		if (!pageNumber || this.isPdfPageDeleted(pageNumber)) {
			return;
		}
		const entry = this.getMixedPageEntries().find((candidate) => !candidate.isAdded && candidate.pageNumber === pageNumber);
		if (!entry) {
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		this.openMixedPageEntryMenu(entry, event, linkEl);
	};

	private updateNativeMixedPageThumbnailSelection(): void {
		const thumbnailView = this.nativeMixedThumbnailViewEl;
		if (!thumbnailView?.isConnected) {
			return;
		}
		const syntheticSelected = this.currentPage > this.realPdfPageCount;
		thumbnailView.classList.toggle("pdf-native-annotator-has-synthetic-selection", syntheticSelected);
		for (const entryEl of Array.from(thumbnailView.querySelectorAll<HTMLElement>(".pdf-native-annotator-native-page-entry"))) {
			const selected = Number(entryEl.dataset.pageNumber) === this.currentPage;
			entryEl.classList.toggle("is-selected", selected);
			entryEl.querySelector<HTMLElement>(".thumbnail")?.classList.toggle("selected", selected);
			entryEl.setAttribute("aria-current", selected ? "page" : "false");
		}
	}

	private syncNativeMixedPageThumbnails(viewContentEl: HTMLElement): void {
		if (!this.annotationDocument) {
			return;
		}
		const thumbnailView = this.getNativePdfThumbnailView(viewContentEl);
		if (!thumbnailView) {
			this.cleanupNativeMixedPageThumbnails();
			return;
		}
		if (this.nativeMixedThumbnailViewEl && this.nativeMixedThumbnailViewEl !== thumbnailView) {
			this.cleanupNativeMixedPageThumbnails();
		}
		this.nativeMixedThumbnailViewEl = thumbnailView;
		const mixedEntries = this.getMixedPageEntries();
		const addedEntries = mixedEntries.filter((entry) => entry.isAdded);
		const nativeLinks = Array.from(thumbnailView.querySelectorAll<HTMLElement>(":scope > a"));
		const signature = JSON.stringify({
			added: addedEntries.map((entry) => [
				entry.pageNumber,
				entry.pageId,
				entry.label,
				entry.template,
				entry.pageSize,
				entry.paperColor,
				entry.annotationCount
			]),
			deleted: this.annotationDocument.deletedPdfPages ?? [],
			removed: this.getRemovedPageEntries().length,
			native: nativeLinks.map((linkEl) => this.getNativePdfThumbnailPageNumber(linkEl))
		});
		const structureIsCurrent =
			this.nativeMixedThumbnailSignature === signature &&
			thumbnailView.querySelectorAll(":scope > .pdf-native-annotator-native-page-entry").length === addedEntries.length &&
			!!thumbnailView.querySelector(":scope > .pdf-native-annotator-native-page-footer") &&
			nativeLinks.every((linkEl) => linkEl.dataset.freedrawNativeContextBound === "true");
		if (structureIsCurrent) {
			this.updateNativeMixedPageThumbnailSelection();
			return;
		}

		const scrollParent = this.getNativeThumbnailScrollParent(thumbnailView);
		const restoreScroll = !!scrollParent && scrollParent.scrollHeight > scrollParent.clientHeight;
		const previousScrollTop = scrollParent?.scrollTop ?? 0;
		const previousScrollHeight = scrollParent?.scrollHeight ?? 0;
		thumbnailView.querySelectorAll(".pdf-native-annotator-native-page-entry")
			.forEach((element) => element.remove());

		const nativeByPage = new Map<number, { linkEl: HTMLElement; thumbnailEl: HTMLElement }>();
		for (const linkEl of Array.from(thumbnailView.querySelectorAll<HTMLElement>(":scope > a"))) {
			const pageNumber = this.getNativePdfThumbnailPageNumber(linkEl);
			const thumbnailEl = linkEl.querySelector<HTMLElement>(".thumbnail");
			if (!pageNumber || !thumbnailEl || nativeByPage.has(pageNumber)) {
				continue;
			}
			nativeByPage.set(pageNumber, { linkEl, thumbnailEl });
			linkEl.classList.toggle("pdf-native-annotator-native-pdf-page-hidden", this.isPdfPageDeleted(pageNumber));
			if (linkEl.dataset.freedrawNativeContextBound !== "true") {
				linkEl.addEventListener("contextmenu", this.handleNativePdfThumbnailContextMenu);
				linkEl.dataset.freedrawNativeContextBound = "true";
			}
		}
		if (nativeByPage.size === 0) {
			return;
		}

		const referenceThumbnail = nativeByPage.values().next().value?.thumbnailEl as HTMLElement | undefined;
		const referenceStyles = referenceThumbnail ? window.getComputedStyle(referenceThumbnail) : null;
		const thumbnailWidth = referenceStyles?.getPropertyValue("--thumbnail-width").trim() || "96px";
		const thumbnailHeight = referenceStyles?.getPropertyValue("--thumbnail-height").trim() || "136px";
		const addedByAnchor = new Map<number, MixedPageEntry[]>();
		for (const entry of mixedEntries) {
			if (!entry.isAdded || !entry.pageId) {
				continue;
			}
			const page = this.getSyntheticPageById(entry.pageId)?.page;
			const anchorPage = page ? this.getSyntheticPageInsertAfterPdfPage(page) : this.realPdfPageCount;
			const group = addedByAnchor.get(anchorPage) ?? [];
			group.push(entry);
			addedByAnchor.set(anchorPage, group);
		}

		const createAddedEntry = (entry: MixedPageEntry): HTMLElement => {
			const entryEl = createDiv();
			entryEl.className = "pdf-native-annotator-native-page-entry";
			entryEl.dataset.pageNumber = String(entry.pageNumber);
			entryEl.dataset.pageId = entry.pageId ?? "";
			entryEl.setAttribute("aria-label", `${entry.label}. Added page. ${entry.detail}`);
			const thumbnailEl = entryEl.createDiv({ cls: "thumbnail pdf-native-annotator-native-thumbnail" });
			thumbnailEl.dataset.pageLabel = String(entry.pageNumber);
			thumbnailEl.dataset.loaded = "true";
			thumbnailEl.tabIndex = 0;
			thumbnailEl.setAttribute("role", "link");
			thumbnailEl.setAttribute("aria-label", `Open ${entry.label}`);
			thumbnailEl.setCssProps({
				"--thumbnail-width": thumbnailWidth,
				"--thumbnail-height": thumbnailHeight,
				"--page-list-paper": entry.paperColor ?? "#fffdf7"
			});
			if (entry.template) {
				thumbnailEl.classList.add(`is-template-${entry.template}`);
			}
			const paperEl = thumbnailEl.createDiv({ cls: "pdf-native-annotator-native-thumbnail-paper" });
			paperEl.createDiv({ cls: "pdf-native-annotator-native-thumbnail-pattern" });
			const addedLabel = paperEl.createSpan({ cls: "pdf-native-annotator-native-thumbnail-kind", text: "Added" });
			addedLabel.setAttribute("aria-hidden", "true");
			if (entry.annotationCount > 0) {
				thumbnailEl.createSpan({
					cls: "pdf-native-annotator-native-thumbnail-count",
					text: String(entry.annotationCount)
				});
			}
			const openPage = (): void => this.goToMixedPage(entry.pageNumber);
			thumbnailEl.addEventListener("click", (event) => {
				event.preventDefault();
				event.stopPropagation();
				openPage();
			});
			thumbnailEl.addEventListener("keydown", (event) => {
				if (event.key !== "Enter" && event.key !== " ") {
					return;
				}
				event.preventDefault();
				event.stopPropagation();
				openPage();
			});
			thumbnailEl.addEventListener("contextmenu", (event) => {
				event.preventDefault();
				event.stopPropagation();
				this.openMixedPageEntryMenu(entry, event, thumbnailEl);
			});
			return entryEl;
		};

		const firstNativeLink = Array.from(nativeByPage.values())
			.sort((first, second) => (this.getNativePdfThumbnailPageNumber(first.linkEl) ?? 0) - (this.getNativePdfThumbnailPageNumber(second.linkEl) ?? 0))[0]?.linkEl ?? null;
		for (let anchorPage = 0; anchorPage <= this.realPdfPageCount; anchorPage += 1) {
			const group = addedByAnchor.get(anchorPage) ?? [];
			let cursor: HTMLElement | null = anchorPage === 0 ? null : nativeByPage.get(anchorPage)?.linkEl ?? null;
			for (const entry of group) {
				const entryEl = createAddedEntry(entry);
				if (cursor) {
					cursor.insertAdjacentElement("afterend", entryEl);
				} else if (firstNativeLink) {
					firstNativeLink.insertAdjacentElement("beforebegin", entryEl);
				} else {
					thumbnailView.appendChild(entryEl);
				}
				cursor = entryEl;
			}
		}

		let footer = thumbnailView.querySelector<HTMLButtonElement>(":scope > .pdf-native-annotator-native-page-footer");
		if (!footer) {
			footer = createEl("button");
			footer.type = "button";
			footer.className = "pdf-native-annotator-native-page-footer";
			setIcon(footer, "files");
			footer.createSpan({ cls: "pdf-native-annotator-native-page-footer-label", text: "Pages" });
			footer.addEventListener("click", (event) => {
				event.preventDefault();
				event.stopPropagation();
				this.openPageListPopover(event.currentTarget as HTMLElement);
			});
			thumbnailView.appendChild(footer);
		}
		const removedCount = this.getRemovedPageEntries().length;
		footer.setAttribute("aria-label", removedCount > 0 ? `Manage pages, ${removedCount} removed` : "Manage pages");
		footer.title = removedCount > 0 ? `Pages - ${removedCount} removed` : "Pages";
		this.nativeMixedThumbnailSignature = signature;
		this.updateNativeMixedPageThumbnailSelection();
		if (restoreScroll && scrollParent) {
			this.restoreNativeThumbnailScroll(scrollParent, previousScrollTop, previousScrollHeight);
		}
	}

	private restoreNativeThumbnailScroll(scrollParent: HTMLElement, previousScrollTop: number, previousScrollHeight: number): void {
		const restore = (): void => {
			if (!scrollParent.isConnected) {
				return;
			}
			const scrollHeightDelta = scrollParent.scrollHeight - previousScrollHeight;
			const maxScrollTop = Math.max(0, scrollParent.scrollHeight - scrollParent.clientHeight);
			scrollParent.scrollTop = clamp(previousScrollTop + scrollHeightDelta, 0, maxScrollTop);
		};
		restore();
		if (this.thumbnailScrollRestoreHandle !== null) {
			window.cancelAnimationFrame(this.thumbnailScrollRestoreHandle);
		}
		this.thumbnailScrollRestoreHandle = window.requestAnimationFrame(() => {
			this.thumbnailScrollRestoreHandle = null;
			restore();
		});
	}

	private syncSyntheticPages(realPageEls: { pageEl: HTMLElement; pageNumber: number }[]): void {
		if (!this.annotationDocument || realPageEls.length === 0) {
			return;
		}
		const pages = this.annotationDocument.appendedPages ?? [];
		const firstRealPage = realPageEls[0].pageEl;
		const pdfViewerEl = firstRealPage.closest<HTMLElement>(".pdfViewer");
		const pageContainer = this.getSyntheticPageContainer(firstRealPage);
		if (!pageContainer) {
			return;
		}
		this.syntheticPageContainer = pageContainer;
		this.isSyncingSyntheticPages = true;
		try {
			const existingPages = Array.from(pageContainer.querySelectorAll<HTMLElement>(".pdf-native-annotator-synthetic-page"));
			if (pdfViewerEl && pdfViewerEl !== pageContainer) {
				for (const stalePage of Array.from(pdfViewerEl.querySelectorAll<HTMLElement>(".pdf-native-annotator-synthetic-page"))) {
					stalePage.remove();
				}
			}
			for (const existingPage of existingPages) {
				const pageNumber = Number(existingPage.dataset.pageNumber);
				const index = pageNumber - this.realPdfPageCount - 1;
				if (!Number.isInteger(index) || index < 0 || index >= pages.length) {
					existingPage.remove();
				}
			}
			const orderedSyntheticPages: HTMLElement[] = [];
			pages.forEach((page, index) => {
				const pageNumber = this.realPdfPageCount + index + 1;
				let pageEl = pageContainer.querySelector<HTMLElement>(`.pdf-native-annotator-synthetic-page[data-page-number="${pageNumber}"]`);
				if (!pageEl) {
					pageEl = createDiv();
					pageEl.dataset.pageNumber = String(pageNumber);
				}
				pageEl.classList.remove("page");
				pageEl.classList.add("pdf-native-annotator-synthetic-page");
				const insertAfter = this.getSyntheticPageInsertAfterPdfPage(page);
				const referenceWidth = this.getSyntheticReferenceWidth(realPageEls, insertAfter);
				this.updateSyntheticPageElement(pageEl, page, pageNumber, referenceWidth);
				orderedSyntheticPages.push(pageEl);
			});
			for (let index = 0; index < orderedSyntheticPages.length; index += 1) {
				const pageEl = orderedSyntheticPages[index];
				const currentAtIndex = pageContainer.children.item(index);
				if (pageEl !== currentAtIndex) {
					pageContainer.insertBefore(pageEl, currentAtIndex);
				}
			}
		} finally {
			this.isSyncingSyntheticPages = false;
		}
	}

	private getSyntheticPageContainer(firstRealPage: HTMLElement): HTMLElement | null {
		const pdfViewerEl = firstRealPage.closest<HTMLElement>(".pdfViewer");
		const anchorEl = pdfViewerEl ?? firstRealPage;
		const parentEl = anchorEl.parentElement;
		if (!parentEl) {
			return null;
		}
		let container = parentEl.querySelector<HTMLElement>(":scope > .pdf-native-annotator-synthetic-pages");
		if (!container) {
			container = createDiv();
			container.className = "pdf-native-annotator-synthetic-pages";
			anchorEl.insertAdjacentElement("afterend", container);
		} else if (container.previousElementSibling !== anchorEl && container.parentElement === parentEl) {
			anchorEl.insertAdjacentElement("afterend", container);
		}
		return container;
	}

	private getSyntheticReferenceWidth(realPageEls: { pageEl: HTMLElement; pageNumber: number }[], anchorPageNumber: number): number {
		const exactAnchor = realPageEls.find((entry) => entry.pageNumber === anchorPageNumber);
		const previousAnchor = [...realPageEls].reverse().find((entry) => entry.pageNumber <= anchorPageNumber);
		const nextAnchor = realPageEls.find((entry) => entry.pageNumber >= anchorPageNumber);
		const anchor = exactAnchor ?? previousAnchor ?? nextAnchor ?? realPageEls[0];
		const width = anchor ? this.getRenderedPdfPageWidth(anchor.pageEl) : 0;
		if (width > 0) {
			return Math.floor(width);
		}
		const fallbackWidth = realPageEls.reduce((largest, entry) => Math.max(largest, this.getRenderedPdfPageWidth(entry.pageEl)), 0);
		return Math.max(24, Math.floor(fallbackWidth || 920));
	}

	private getRenderedPdfPageWidth(pageEl: HTMLElement): number {
		const hostEl = getOverlayHost(pageEl);
		const canvas = hostEl.querySelector("canvas") ?? pageEl.querySelector("canvas");
		const hostRect = hostEl.getBoundingClientRect();
		const pageRect = pageEl.getBoundingClientRect();
		const canvasRectWidth = isHtmlCanvasElement(canvas) ? canvas.getBoundingClientRect().width : 0;
		return resolvePdfPageContentWidth({
			canvasRectWidth,
			canvasClientWidth: isHtmlCanvasElement(canvas) ? canvas.clientWidth : 0,
			hostRectWidth: hostRect.width,
			hostClientWidth: hostEl.clientWidth,
			pageRectWidth: pageRect.width,
			pageClientWidth: pageEl.clientWidth
		});
	}

	private updateSyntheticPageElement(pageEl: HTMLElement, page: NotebookPage, pageNumber: number, referenceWidth: number): void {
		pageEl.dataset.pageNumber = String(pageNumber);
		pageEl.dataset.template = page.template;
		pageEl.dataset.pageSize = page.pageSize;
		pageEl.dataset.insertAfterPdfPage = String(this.getSyntheticPageInsertAfterPdfPage(page));
		const { width } = this.applySyntheticPageSize(pageEl, page, referenceWidth);
		this.applyPaperTemplateCssVariables(pageEl, width, page.paperColor);
		this.setStyleIfChanged(pageEl, "backgroundColor", page.paperColor);
		let hostEl = pageEl.querySelector<HTMLElement>(":scope > .canvasWrapper");
		if (!hostEl) {
			hostEl = createDiv();
			hostEl.className = "canvasWrapper pdf-native-annotator-synthetic-wrapper";
			pageEl.appendChild(hostEl);
		}
		this.setStyleIfChanged(hostEl, "width", "100%");
		this.setStyleIfChanged(hostEl, "height", "100%");
		this.setStyleIfChanged(hostEl, "backgroundColor", page.paperColor);
		let backgroundEl = hostEl.querySelector<HTMLElement>(":scope > .pdf-native-annotator-synthetic-background");
		if (!backgroundEl) {
			backgroundEl = createDiv();
			backgroundEl.className = "pdf-native-annotator-synthetic-background";
			hostEl.prepend(backgroundEl);
		}
		backgroundEl.dataset.template = page.template;
		this.applyCssTemplateBackground(backgroundEl, width, page.paperColor);
		hostEl.querySelector<HTMLElement>(":scope > .pdf-native-annotator-synthetic-label")?.remove();
	}

	private applySyntheticPageSize(pageEl: HTMLElement, page: NotebookPage, referenceWidth: number): { width: number; height: number } {
		const dimensions = getNotebookPageSizeDimensions(page.pageSize);
		const a4Dimensions = getNotebookPageSizeDimensions("a4");
		const scale = referenceWidth / a4Dimensions.width;
		const width = Math.max(24, Math.round(dimensions.width * scale));
		const height = Math.max(32, Math.round(dimensions.height * scale));
		this.setStyleIfChanged(pageEl, "width", `${width}px`);
		this.setStyleIfChanged(pageEl, "height", `${height}px`);
		this.setStyleIfChanged(pageEl, "aspectRatio", `${dimensions.width} / ${dimensions.height}`);
		return { width, height };
	}

	private scheduleSyntheticPageZoomPreview(): void {
		if (this.syntheticZoomPreviewHandle !== null || !this.annotationDocument?.appendedPages?.length) {
			return;
		}
		this.syntheticZoomPreviewHandle = window.requestAnimationFrame(() => {
			this.syntheticZoomPreviewHandle = null;
			this.previewSyntheticPageZoom();
		});
	}

	private previewSyntheticPageZoom(): void {
		const pageContainer = this.syntheticPageContainer;
		const pages = this.annotationDocument?.appendedPages ?? [];
		if (!pageContainer?.isConnected || pages.length === 0) {
			return;
		}
		pages.forEach((page, index) => {
			const pageNumber = this.realPdfPageCount + index + 1;
			const pageEl = pageContainer.querySelector<HTMLElement>(
				`.pdf-native-annotator-synthetic-page[data-page-number="${pageNumber}"]`
			);
			if (!pageEl) {
				return;
			}
			const anchorPageNumber = this.getSyntheticPageInsertAfterPdfPage(page);
			const referenceWidth = this.getSyntheticPreviewReferenceWidth(anchorPageNumber);
			const { width } = this.applySyntheticPageSize(pageEl, page, referenceWidth);
			this.applyPaperTemplateCssVariables(pageEl, width, page.paperColor);
			const backgroundEl = pageEl.querySelector<HTMLElement>(
				":scope > .canvasWrapper > .pdf-native-annotator-synthetic-background"
			);
			if (backgroundEl) {
				this.applyCssTemplateBackground(backgroundEl, width, page.paperColor);
			}
		});
	}

	private getSyntheticPreviewReferenceWidth(anchorPageNumber: number): number {
		const candidates = [
			clamp(anchorPageNumber, 1, Math.max(this.realPdfPageCount, 1)),
			this.zoomScrollAnchor?.pageNumber ?? 0,
			this.currentPage,
			1
		];
		for (const pageNumber of candidates) {
			if (pageNumber < 1 || pageNumber > this.realPdfPageCount) {
				continue;
			}
			const surface = this.pageSurfaces.get(pageNumber);
			if (!surface?.pageEl.isConnected) {
				continue;
			}
			const width = this.getRenderedPdfPageWidth(surface.pageEl);
			if (width > 0) {
				return Math.floor(width);
			}
		}
		return 920;
	}

	private applyPaperTemplateCssVariables(element: HTMLElement, width: number, paperColor: string): void {
		const metrics = getPaperTemplateMetrics(width);
		this.setStylePropertyIfChanged(element, "--annotator-template-step", `${Math.max(3, metrics.graphStep)}px`);
		this.setStylePropertyIfChanged(element, "--annotator-template-ruled-step", `${Math.max(4, metrics.ruledStep)}px`);
		this.setStylePropertyIfChanged(element, "--annotator-template-dot-step", `${Math.max(3, metrics.dotStep)}px`);
		this.setStylePropertyIfChanged(element, "--annotator-template-dot-size", `${metrics.dotRadius}px`);
		this.setStylePropertyIfChanged(element, "--annotator-template-ruled-offset", `${Math.max(8, metrics.ruledOffset)}px`);
		this.setStylePropertyIfChanged(element, "--annotator-template-line-width", `${Math.max(1, width / getNotebookPageSizeDimensions("a4").width)}px`);
		this.setStylePropertyIfChanged(element, "--annotator-template-line-color", PAPER_TEMPLATE_LINE_COLOR);
		this.setStylePropertyIfChanged(element, "--annotator-template-grid-color", PAPER_TEMPLATE_GRID_COLOR);
		this.setStylePropertyIfChanged(element, "--annotator-template-dot-color", PAPER_TEMPLATE_DOT_COLOR);
		this.setStylePropertyIfChanged(element, "--annotator-template-paper-color", paperColor);
	}

	private setStyleIfChanged(element: HTMLElement, property: keyof CSSStyleDeclaration, value: string): void {
		const cssProperty = String(property).replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`);
		if (element.style.getPropertyValue(cssProperty) === value) {
			return;
		}
		element.setCssProps({ [cssProperty]: value });
	}

	private setStylePropertyIfChanged(element: HTMLElement, property: string, value: string): void {
		if (element.style.getPropertyValue(property) === value) {
			return;
		}
		element.setCssProps({ [property]: value });
	}

	private ensurePageSurface(pageEl: HTMLElement, pageNumber: number): void {
		const hostEl = getOverlayHost(pageEl);
		if (!hostEl.isConnected) {
			return;
		}
		const existing = this.pageSurfaces.get(pageNumber);
		if (existing && existing.pageEl === pageEl && existing.hostEl === hostEl) {
			this.ensureOverlayLayerOrder(existing);
			this.resizeOverlay(existing, true);
			return;
		}
		if (existing) {
			this.pageResizeObservers.get(pageNumber)?.disconnect();
			this.pageResizeObservers.delete(pageNumber);
			this.cancelPageRenderJob(pageNumber);
			this.pageRenderSlots.delete(pageNumber);
			existing.overlayEl.remove();
			existing.transientEl.remove();
		}

		if (window.getComputedStyle(hostEl).position === "static") {
			hostEl.setCssStyles({ position: "relative" });
		}

		let overlayEl = hostEl.querySelector<HTMLCanvasElement>(`:scope > .${OVERLAY_CLASS}`);
		if (!overlayEl) {
			overlayEl = createEl("canvas");
			overlayEl.className = OVERLAY_CLASS;
			hostEl.appendChild(overlayEl);
			overlayEl.addEventListener("pointerenter", this.handlePointerEnter);
			overlayEl.addEventListener("pointerdown", this.handlePointerDown);
			overlayEl.addEventListener("pointermove", this.handlePointerMove);
			overlayEl.addEventListener("pointerup", this.handlePointerUp);
			overlayEl.addEventListener("pointercancel", this.handlePointerCancel);
			overlayEl.addEventListener("pointerleave", this.handlePointerLeave);
		}
		overlayEl.dataset.pageNumber = String(pageNumber);
		let transientEl = hostEl.querySelector<HTMLCanvasElement>(":scope > .pdf-native-annotator-transient");
		if (!transientEl) {
			transientEl = createEl("canvas");
			transientEl.className = "pdf-native-annotator-transient";
			hostEl.appendChild(transientEl);
		}

		const surface: PageSurface = {
			pageNumber,
			pageEl,
			hostEl,
			overlayEl,
			transientEl,
			lastWidth: 0,
			lastHeight: 0,
			pendingWidth: 0,
			pendingHeight: 0
		};
		this.pageSurfaces.set(pageNumber, surface);
		this.observePageSurface(surface);
		this.ensureOverlayLayerOrder(surface);
		this.resizeOverlay(surface);
	}

	private ensureOverlayLayerOrder(surface: PageSurface): void {
		if (!surface.overlayEl.isConnected || surface.overlayEl.parentElement !== surface.hostEl) {
			surface.hostEl.appendChild(surface.overlayEl);
		}
		if (!surface.transientEl.isConnected || surface.transientEl.parentElement !== surface.hostEl) {
			surface.hostEl.appendChild(surface.transientEl);
		}
		if (surface.transientEl.previousElementSibling !== surface.overlayEl || surface.hostEl.lastElementChild !== surface.transientEl) {
			surface.hostEl.appendChild(surface.overlayEl);
			surface.hostEl.appendChild(surface.transientEl);
		}
		surface.overlayEl.setCssStyles({ zIndex: "9990" });
		surface.transientEl.setCssStyles({ zIndex: "9991" });
	}

	private observePageSurface(surface: PageSurface): void {
		if (typeof ResizeObserver === "undefined") {
			return;
		}
		this.pageResizeObservers.get(surface.pageNumber)?.disconnect();
		const observer = new ResizeObserver(() => {
			const shouldPreview =
				this.shouldKeepPageHot(surface.pageNumber) ||
				this.zoomScrollAnchor?.pageNumber === surface.pageNumber ||
				this.inlineTextPageNumber === surface.pageNumber;
			if (!shouldPreview) {
				return;
			}
			this.previewResizeOverlay(surface);
			if (!surface.pageEl.classList.contains("pdf-native-annotator-synthetic-page")) {
				this.scheduleSyntheticPageZoomPreview();
			}
			if (this.zoomScrollAnchor?.pageNumber === surface.pageNumber) {
				this.restoreZoomScrollAnchor();
			}
			this.markPageZooming(surface.pageNumber);
		});
		observer.observe(surface.hostEl);
		this.pageResizeObservers.set(surface.pageNumber, observer);
	}

	private markPageZooming(pageNumber: number): void {
		this.zoomingPages.add(pageNumber);
		this.scheduleFinishZoomingPages();
	}

	private scheduleFinishZoomingPages(): void {
		if (this.zoomSettleHandle !== null) {
			window.clearTimeout(this.zoomSettleHandle);
		}
		this.zoomSettleHandle = window.setTimeout(() => {
			this.finishZoomingPages();
		}, ZOOM_SETTLE_DELAY_MS);
	}

	private finishZoomingPages(): void {
		if (this.zoomSettleHandle !== null) {
			window.clearTimeout(this.zoomSettleHandle);
			this.zoomSettleHandle = null;
		}
		const pages = Array.from(this.zoomingPages);
		this.zoomingPages.clear();
		let needsSurfaceSync = false;
		for (const pageNumber of pages) {
			const surface = this.pageSurfaces.get(pageNumber);
			if (
				!surface ||
				!surface.hostEl.isConnected ||
				surface.overlayEl.parentElement !== surface.hostEl ||
				surface.transientEl.parentElement !== surface.hostEl
			) {
				needsSurfaceSync = true;
				continue;
			}
			this.ensureOverlayLayerOrder(surface);
			this.resizeOverlay(surface, true);
			surface.overlayEl.setCssStyles({ opacity: "1" });
			this.schedulePageRedraw(pageNumber);
		}
		if (needsSurfaceSync || this.annotationDocument?.appendedPages?.length) {
			this.scheduleSyncPages();
		}
		this.scheduleZoomScrollAnchorRestore();
	}

	private previewResizeOverlay(surface: PageSurface): void {
		const size = this.getStableSurfaceSize(surface);
		if (!size) {
			return;
		}
		const { width, height } = size;
		const previousWidth = surface.pendingWidth || surface.lastWidth;
		const previousHeight = surface.pendingHeight || surface.lastHeight;
		surface.pendingWidth = width;
		surface.pendingHeight = height;
		if (width !== previousWidth || height !== previousHeight) {
			this.resizeInlineTextEditorForSurface(surface, previousWidth, previousHeight, width, height);
		}
		const previewScale = width / Math.max(surface.lastWidth, 1);
		surface.overlayEl.setCssStyles({
			width: `${surface.lastWidth}px`,
			height: `${surface.lastHeight}px`,
			transformOrigin: "0 0",
			transform: `scale(${previewScale})`
		});
		surface.transientEl.setCssStyles({
			width: `${surface.lastWidth}px`,
			height: `${surface.lastHeight}px`,
			transformOrigin: "0 0",
			transform: `scale(${previewScale})`
		});
	}

	private syncCanvasBackingSize(canvas: HTMLCanvasElement, width: number, height: number, preservePixels = false): void {
		const ownerWindow = canvas.ownerDocument.defaultView;
		const ratio = ownerWindow?.devicePixelRatio || window.devicePixelRatio || 1;
		const pixelWidth = Math.max(1, Math.floor(width * ratio));
		const pixelHeight = Math.max(1, Math.floor(height * ratio));
		if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
			let previousFrame: HTMLCanvasElement | null = null;
			if (preservePixels && canvas.width > 0 && canvas.height > 0) {
				previousFrame = canvas.ownerDocument.createElement("canvas");
				previousFrame.width = canvas.width;
				previousFrame.height = canvas.height;
				previousFrame.getContext("2d")?.drawImage(canvas, 0, 0);
			}
			canvas.width = pixelWidth;
			canvas.height = pixelHeight;
			if (previousFrame) {
				canvas.getContext("2d")?.drawImage(previousFrame, 0, 0, pixelWidth, pixelHeight);
			}
		}
	}

	private resizeOverlay(surface: PageSurface, preserveVisibleFrame = false): void {
		const size = this.getStableSurfaceSize(surface, true);
		if (!size) {
			return;
		}
		const { width, height } = size;
		const previousWidth = surface.pendingWidth || surface.lastWidth;
		const previousHeight = surface.pendingHeight || surface.lastHeight;
		const sizeChanged = width !== surface.lastWidth || height !== surface.lastHeight;
		// PDF.js can replace page children during a zoom without changing the
		// final measured size. Restore the editable paper layer before returning.
		this.syncPdfPageTemplateBackground(surface, width, height);
		surface.overlayEl.setCssStyles({
			width: `${width}px`,
			height: `${height}px`,
			transformOrigin: "0 0",
			transform: "none"
		});
		surface.transientEl.setCssStyles({
			width: `${width}px`,
			height: `${height}px`,
			transformOrigin: "0 0",
			transform: "none"
		});
		if (!sizeChanged && preserveVisibleFrame) {
			return;
		}

		if (!preserveVisibleFrame) {
			this.syncCanvasBackingSize(surface.overlayEl, width, height);
			this.syncCanvasBackingSize(surface.transientEl, width, height);
		}
		surface.lastWidth = width;
		surface.lastHeight = height;
		surface.pendingWidth = width;
		surface.pendingHeight = height;
		if (sizeChanged) {
			this.resizeInlineTextEditorForSurface(surface, previousWidth, previousHeight);
		}
	}

	private syncPdfPageTemplateBackground(surface: PageSurface, width: number, height: number): void {
		const pageTemplate = this.getPdfPageTemplate(surface.pageNumber);
		let backgroundEl = surface.hostEl.querySelector<HTMLElement>(":scope > .pdf-native-annotator-template-background");
		if (!pageTemplate || !this.canEditPdfPageTemplate(surface.pageNumber)) {
			backgroundEl?.remove();
			return;
		}
		if (!backgroundEl) {
			backgroundEl = createDiv();
			backgroundEl.className = "pdf-native-annotator-template-background pdf-native-annotator-synthetic-background";
			surface.hostEl.appendChild(backgroundEl);
			this.ensureOverlayLayerOrder(surface);
		}
		backgroundEl.dataset.template = pageTemplate.template;
		this.applyCssTemplateBackground(backgroundEl, width, pageTemplate.paperColor);
		this.setStyleIfChanged(backgroundEl, "width", `${width}px`);
		this.setStyleIfChanged(backgroundEl, "height", `${height}px`);
	}

	private applyCssTemplateBackground(element: HTMLElement, width: number, paperColor: string): void {
		this.applyPaperTemplateCssVariables(element, width, paperColor);
		this.setStyleIfChanged(element, "backgroundColor", paperColor);
		this.setStyleIfChanged(element, "backgroundImage", "");
		this.setStyleIfChanged(element, "backgroundSize", "");
		this.setStyleIfChanged(element, "backgroundRepeat", "");
		this.setStyleIfChanged(element, "backgroundPosition", "");
	}

	private getPdfPageTemplate(pageNumber: number): PdfPageTemplate | null {
		const pageTemplates = this.annotationDocument?.pdfPageTemplates;
		if (!pageTemplates?.length || pageNumber < 1 || pageNumber > this.realPdfPageCount) {
			return null;
		}
		return pageTemplates.find((pageTemplate) => pageTemplate.page === pageNumber) ?? null;
	}

	private canEditPdfPageTemplate(pageNumber: number): boolean {
		return !!this.annotationDocument &&
			hasEditableNativePageTemplates(this.annotationDocument, this.realPdfPageCount) &&
			this.getPdfPageTemplate(pageNumber) !== null;
	}

	private ensurePdfPageTemplate(pageNumber: number): PdfPageTemplate | null {
		return this.canEditPdfPageTemplate(pageNumber) ? this.getPdfPageTemplate(pageNumber) : null;
	}

	private setPdfPageTemplateByPage(pageNumber: number, template: NotebookTemplate): void {
		const pageTemplate = this.ensurePdfPageTemplate(pageNumber);
		if (!pageTemplate) {
			new Notice("Template editing is only available for PDFs created by this plugin.");
			return;
		}
		if (pageTemplate.template === template) {
			return;
		}
		this.pushHistory();
		pageTemplate.template = template;
		this.markDirtyAndRedraw(`Template changed to ${getNotebookTemplateLabel(template)}`);
		this.refreshSyntheticPages(pageNumber);
		this.drawPageAnnotations(pageNumber);
	}

	private setPdfPagePaperColorByPage(pageNumber: number, color: string): void {
		const pageTemplate = this.ensurePdfPageTemplate(pageNumber);
		if (!pageTemplate) {
			new Notice("Paper color editing is only available for PDFs created by this plugin.");
			return;
		}
		if (pageTemplate.paperColor.toLowerCase() === color.toLowerCase()) {
			return;
		}
		this.pushHistory();
		pageTemplate.paperColor = color;
		this.markDirtyAndRedraw("Paper color changed");
		this.refreshSyntheticPages(pageNumber);
		this.drawPageAnnotations(pageNumber);
	}

	private getStableSurfaceSize(surface: PageSurface, allowLastKnown = false): { width: number; height: number } | null {
		const rect = surface.hostEl.getBoundingClientRect();
		const width = Math.floor(rect.width || surface.hostEl.clientWidth || surface.pageEl.clientWidth || 0);
		const height = Math.floor(rect.height || surface.hostEl.clientHeight || surface.pageEl.clientHeight || 0);
		if (width > 2 && height > 2) {
			return { width, height };
		}
		if (allowLastKnown && surface.lastWidth > 2 && surface.lastHeight > 2) {
			return { width: surface.lastWidth, height: surface.lastHeight };
		}
		if (allowLastKnown && surface.pendingWidth > 2 && surface.pendingHeight > 2) {
			return { width: surface.pendingWidth, height: surface.pendingHeight };
		}
		return null;
	}

	private bindScrollParent(pageEl: HTMLElement): void {
		const nextScrollParent = findScrollParent(pageEl);
		if (this.scrollParent === nextScrollParent) {
			return;
		}
		if (this.scrollParent) {
			this.scrollParent.removeEventListener("scroll", this.handleScroll, { capture: false });
		}
		this.scrollParent = nextScrollParent;
		this.scrollParent.addEventListener("scroll", this.handleScroll, { passive: true });
	}

	private readonly handleScroll = (): void => {
		if (this.hasOpenTransientPopover()) {
			this.scheduleRepositionOpenPopovers();
		}
		if (!this.isPdfScrolling) {
			this.pauseCommittedRenderingForViewportMotion();
		}
		this.isPdfScrolling = true;
		if (this.scrollIdleHandle !== null) {
			window.clearTimeout(this.scrollIdleHandle);
		}
		this.scrollIdleHandle = window.setTimeout(() => {
			this.scrollIdleHandle = null;
			this.isPdfScrolling = false;
			this.updateCurrentPageFromScroll();
			if (this.needsToolbarRefreshAfterScroll) {
				this.needsToolbarRefreshAfterScroll = false;
				this.refreshToolbar();
			}
			this.updateVisiblePageRange(true);
			this.flushDeferredScrollRedraws();
		}, 160);
	};

	private readonly handleViewportResize = (): void => {
		this.scheduleRepositionOpenPopovers();
		this.scheduleLayoutRefresh();
	};

	private readonly handleVisualViewportChange = (): void => {
		this.scheduleRepositionOpenPopovers();
		const frame = this.inlineTextEditorFrameEl;
		const editor = this.inlineTextEditorEl;
		const viewport = window.visualViewport;
		const editorFocused = !!editor && editor.ownerDocument.activeElement === editor;
		if (!editorFocused) {
			this.captureVisualViewportBaseline();
		}
		const baselineHeight = Math.max(this.visualViewportBaselineHeight, window.innerHeight);
		const keyboardRaised = !!viewport &&
			Math.abs(viewport.scale - 1) < 0.05 &&
			viewport.height < baselineHeight - 80;
		if (!frame || !editor || !viewport || !editorFocused || !keyboardRaised) {
			return;
		}
		if (this.keyboardAvoidanceHandle !== null) {
			return;
		}
		this.keyboardAvoidanceHandle = window.requestAnimationFrame(() => {
			this.keyboardAvoidanceHandle = null;
			this.keepInlineTextEditorAboveKeyboard();
		});
	};

	private captureVisualViewportBaseline(): void {
		const viewport = window.visualViewport;
		if (!viewport || Math.abs(viewport.scale - 1) >= 0.05) {
			return;
		}
		this.visualViewportBaselineHeight = Math.max(
			this.visualViewportBaselineHeight,
			viewport.height,
			window.innerHeight
		);
	}

	private keepInlineTextEditorAboveKeyboard(): void {
		const frame = this.inlineTextEditorFrameEl;
		const editor = this.inlineTextEditorEl;
		const viewport = window.visualViewport;
		const scrollEl = this.scrollParent?.isConnected
			? this.scrollParent
			: frame
				? findScrollParent(frame)
				: null;
		if (!frame || !editor || !viewport || !scrollEl || editor.ownerDocument.activeElement !== editor) {
			return;
		}
		const keyboardRaised = Math.abs(viewport.scale - 1) < 0.05 &&
			viewport.height < Math.max(this.visualViewportBaselineHeight, window.innerHeight) - 80;
		if (!keyboardRaised) {
			return;
		}
		const rect = frame.getBoundingClientRect();
		const safeTop = viewport.offsetTop + 72;
		const safeBottom = viewport.offsetTop + viewport.height - 48;
		let deltaY = 0;
		if (rect.height >= safeBottom - safeTop) {
			deltaY = rect.top - safeTop;
		} else if (rect.bottom > safeBottom) {
			deltaY = rect.bottom - safeBottom;
		} else if (rect.top < safeTop) {
			deltaY = rect.top - safeTop;
		}
		if (Math.abs(deltaY) < 1) {
			return;
		}
		const maxScrollTop = Math.max(0, scrollEl.scrollHeight - scrollEl.clientHeight);
		scrollEl.scrollTop = clamp(scrollEl.scrollTop + deltaY, 0, maxScrollTop);
	}

	private clearLayoutRefreshHandles(): void {
		for (const handle of this.layoutRefreshHandles) {
			window.clearTimeout(handle);
		}
		this.layoutRefreshHandles = [];
	}

	private scheduleLayoutRefresh(): void {
		if (!this.file || !this.annotationDocument) {
			return;
		}
		this.clearLayoutRefreshHandles();
		const handle = window.setTimeout(() => {
			this.layoutRefreshHandles = this.layoutRefreshHandles.filter((pendingHandle) => pendingHandle !== handle);
			if (this.hasActiveTransientRender() || this.isViewportMotionActive()) {
				this.scheduleLayoutRefresh();
				return;
			}
			this.syncPages(false);
			this.forceRedrawVisibleAnnotations();
			this.scheduleZoomScrollAnchorRestore(true);
		}, 220);
		this.layoutRefreshHandles.push(handle);
	}

	private forceRedrawAllAnnotations(): void {
		if (!this.annotationDocument) {
			return;
		}
		this.zoomingPages.clear();
		this.pendingRedrawPages.clear();
		this.updateCurrentPageFromScroll();
		this.updateVisiblePageRange(false);
		const pageNumbers = prioritizeRenderPages(this.pageSurfaces.keys(), this.currentPage, this.pointerPage);
		for (const pageNumber of pageNumbers) {
			const surface = this.pageSurfaces.get(pageNumber);
			if (!surface) {
				continue;
			}
			surface.overlayEl.setCssStyles({ visibility: "visible" });
			this.ensureOverlayLayerOrder(surface);
			this.startPageRenderJob(pageNumber);
		}
	}

	private forceRedrawVisibleAnnotations(): void {
		if (!this.annotationDocument) {
			return;
		}
		this.updateCurrentPageFromScroll();
		this.updateVisiblePageRange(false);
		const visiblePages: number[] = [];
		for (const pageNumber of this.pageSurfaces.keys()) {
			const shouldDraw =
				pageNumber === this.currentPage ||
				pageNumber === this.pointerPage ||
				this.isPageNearViewport(pageNumber) ||
				!!this.visiblePageRange && pageNumber >= this.visiblePageRange.start && pageNumber <= this.visiblePageRange.end;
			if (!shouldDraw) {
				continue;
			}
			visiblePages.push(pageNumber);
		}
		for (const pageNumber of prioritizeRenderPages(visiblePages, this.currentPage, this.pointerPage)) {
			const surface = this.pageSurfaces.get(pageNumber);
			if (!surface) {
				continue;
			}
			this.zoomingPages.delete(pageNumber);
			surface.overlayEl.setCssStyles({ visibility: "visible" });
			this.ensureOverlayLayerOrder(surface);
			this.startPageRenderJob(pageNumber);
		}
		if (visiblePages.length === 0) {
			this.syncPages();
			this.forceRedrawAllAnnotations();
		}
	}

	private schedulePageRedraw(pageNumber: number): void {
		if (!this.shouldKeepPageHot(pageNumber)) {
			return;
		}
		if (this.zoomingPages.has(pageNumber)) {
			return;
		}
		this.pendingRedrawPages.add(pageNumber);
		if (this.hasActiveTransientRender()) {
			return;
		}
		if (this.isPdfScrolling && !this.currentStroke && !this.currentShape && !this.currentLasso) {
			return;
		}
		if (this.redrawHandle !== null) {
			return;
		}
		this.redrawHandle = window.requestAnimationFrame(() => {
			this.redrawHandle = null;
			if (this.hasActiveTransientRender()) {
				return;
			}
			const pendingPages = Array.from(this.pendingRedrawPages);
			this.pendingRedrawPages.clear();
			for (const pendingPage of pendingPages) {
				const shouldDraw =
					pendingPage === this.currentPage ||
					pendingPage === this.pointerPage ||
					this.shouldKeepPageHot(pendingPage);
				if (shouldDraw) {
					this.startPageRenderJob(pendingPage);
				}
			}
		});
	}

	private getNextPageRenderSlot(surface: PageSurface): HTMLCanvasElement {
		let pool = this.pageRenderSlots.get(surface.pageNumber);
		if (!pool) {
			pool = {
				canvases: [createEl("canvas"), createEl("canvas"), createEl("canvas")],
				nextIndex: 0
			};
			this.pageRenderSlots.set(surface.pageNumber, pool);
		}
		const canvas = pool.canvases[pool.nextIndex];
		pool.nextIndex = (pool.nextIndex + 1) % pool.canvases.length;
		const ratio = window.devicePixelRatio || 1;
		const pixelWidth = Math.max(1, Math.floor(surface.lastWidth * ratio));
		const pixelHeight = Math.max(1, Math.floor(surface.lastHeight * ratio));
		if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
			canvas.width = pixelWidth;
			canvas.height = pixelHeight;
		}
		return canvas;
	}

	private startPageRenderJob(pageNumber: number): void {
		if (this.isViewportMotionActive()) {
			this.pendingRedrawPages.add(pageNumber);
			return;
		}
		if (this.hasActiveTransientRender() || !this.annotationDocument) {
			return;
		}
		const surface = this.pageSurfaces.get(pageNumber);
		if (!surface || !surface.overlayEl.isConnected || !surface.hostEl.isConnected) {
			return;
		}
		this.ensureOverlayLayerOrder(surface);
		this.resizeOverlay(surface, true);
		const canvas = this.getNextPageRenderSlot(surface);
		const context = canvas.getContext("2d", { willReadFrequently: true });
		if (!context) {
			return;
		}
		const ratio = window.devicePixelRatio || 1;
		context.setTransform(1, 0, 0, 1, 0, 0);
		context.clearRect(0, 0, canvas.width, canvas.height);
		context.setTransform(ratio, 0, 0, ratio, 0, 0);

		const bucket = this.getPageAnnotationBucket(pageNumber);
		const steps: CooperativeRenderStep[] = [];
		for (const imageItem of bucket.imageItems) {
			steps.push({
				run: () => this.drawImageAnnotation(context, surface, imageItem),
				expensive: true
			});
		}
		const renderables = getAnnotationRenderables(bucket.strokes, bucket.textItems, bucket.shapes);
		for (const renderable of renderables) {
			if (renderable.kind === "stroke") {
				steps.push({
					run: () => this.drawStroke(context, surface, renderable.annotation),
					expensive: true
				});
			} else if (renderable.kind === "text") {
				if (this.inlineTextTargetId !== renderable.annotation.id || this.inlineTextPageNumber !== pageNumber) {
					steps.push({
						run: () => this.drawText(context, surface, renderable.annotation),
						expensive: false
					});
				}
			} else if (renderable.kind === "shape") {
				steps.push({
					run: () => this.drawShape(context, surface, renderable.annotation),
					expensive: false
				});
			}
		}
		const inlinePreviewText = this.getInlineTextPreviewItem(pageNumber);
		if (inlinePreviewText) {
			steps.push({
				run: () => this.drawText(context, surface, inlinePreviewText),
				expensive: false
			});
		}
		const pageSelections = this.selectedTargets.filter((target) => target.page === pageNumber);
		if (pageSelections.length > 0) {
			steps.push({
				run: () => this.drawSelection(context, surface, pageSelections),
				expensive: false
			});
		}
		if (this.lastSelectionRegion?.page === pageNumber) {
			const rect = this.lastSelectionRegion.rect;
			steps.push({
				run: () => this.drawFocusedRegion(context, surface, rect),
				expensive: false
			});
		}
		if (this.focusedRegion && this.focusedRegionPage === pageNumber) {
			const rect = this.focusedRegion;
			steps.push({
				run: () => this.drawFocusedRegion(context, surface, rect),
				expensive: false
			});
		}
		const version = (this.pageRenderVersions.get(pageNumber) ?? 0) + 1;
		this.pageRenderVersions.set(pageNumber, version);
		this.pageRenderJobs.set(pageNumber, {
			pageNumber,
			canvas,
			steps,
			nextStep: 0,
			lastProgressAt: performance.now(),
			width: surface.lastWidth,
			height: surface.lastHeight,
			version,
			inputEpoch: this.renderInputEpoch
		});
		this.renderTelemetry.recordRenderQueued(pageNumber, steps.length, this.pageRenderJobs.size);
		this.schedulePageRenderJobs();
	}

	private schedulePageRenderJobs(): void {
		if (this.pageRenderTaskHandle !== null || this.pageRenderJobs.size === 0) {
			return;
		}
		this.pageRenderTaskHandle = window.setTimeout(() => {
			this.pageRenderTaskHandle = null;
			if (this.isFingerPanRenderingPaused()) {
				this.cancelPageRenderJobs("cancelled by finger pan");
				return;
			}
			if (this.hasActiveTransientRender()) {
				this.cancelPageRenderJobs();
				return;
			}
			const pageNumber = prioritizeRenderPages(Array.from(this.pageRenderJobs.keys()), this.currentPage, this.pointerPage)[0];
			const job = this.pageRenderJobs.get(pageNumber);
			if (!job) {
				this.renderTelemetry.recordRenderIdle("no active render jobs");
				return;
			}
			const surface = this.pageSurfaces.get(pageNumber);
			if (!surface || surface.lastWidth !== job.width || surface.lastHeight !== job.height) {
				this.pageRenderJobs.delete(pageNumber);
				if (this.pageRenderJobs.size === 0) {
					this.renderTelemetry.recordRenderIdle("render invalidated by layout");
				}
				this.schedulePageRenderJobs();
				return;
			}
			const sliceStart = performance.now();
			const allowInputYield = sliceStart - job.lastProgressAt < 48;
			const previousStep = job.nextStep;
			const result = runCooperativeRenderSlice(job.steps, job.nextStep, {
				budgetMs: 4,
				now: () => performance.now(),
				isInputPending: () => allowInputYield && this.isBrowserInputPending()
			});
			job.nextStep = result.nextStep;
			if (job.nextStep > previousStep) {
				job.lastProgressAt = performance.now();
			}
			this.renderTelemetry.recordRenderProgress(
				pageNumber,
				job.nextStep,
				job.steps.length,
				this.pageRenderJobs.size,
				performance.now() - sliceStart,
				result.inputPending
			);
			const canSwap = !allowInputYield || (!result.inputPending && !this.isBrowserInputPending());
			if (job.nextStep >= job.steps.length && canSwap) {
				this.pageRenderJobs.delete(pageNumber);
				if (!this.hasActiveTransientRender()) {
					this.pageRenderPublications.set(pageNumber, job.version);
					this.renderTelemetry.recordRenderPublishing(pageNumber, this.pageRenderJobs.size + this.pageRenderPublications.size);
					void this.publishPageRenderSnapshot(job, surface);
				}
			}
			this.schedulePageRenderJobs();
		}, 0);
	}

	private isBrowserInputPending(): boolean {
		const scheduling = (navigator as Navigator & {
			scheduling?: {
				isInputPending?: () => boolean;
			};
		}).scheduling;
		return scheduling?.isInputPending?.() ?? false;
	}

	private cancelPageRenderJob(pageNumber: number): void {
		const cancelled = this.pageRenderJobs.delete(pageNumber);
		const publishing = this.pageRenderPublications.delete(pageNumber);
		this.pageRenderVersions.set(pageNumber, (this.pageRenderVersions.get(pageNumber) ?? 0) + 1);
		if (this.pageRenderJobs.size === 0 && this.pageRenderTaskHandle !== null) {
			window.clearTimeout(this.pageRenderTaskHandle);
			this.pageRenderTaskHandle = null;
		}
		if ((cancelled || publishing) && this.pageRenderJobs.size === 0 && this.pageRenderPublications.size === 0) {
			this.renderTelemetry.recordRenderCancelled("page render invalidated");
		}
	}

	private async publishPageRenderSnapshot(job: PageRenderJob, surface: PageSurface): Promise<void> {
		let snapshot: CanvasSnapshot | null = null;
		try {
			snapshot = await this.createCanvasSnapshot(job.canvas);
			const currentSurface = this.pageSurfaces.get(job.pageNumber);
			const isCurrent =
				currentSurface === surface &&
				surface.overlayEl.isConnected &&
				surface.lastWidth === job.width &&
				surface.lastHeight === job.height &&
				this.pageRenderVersions.get(job.pageNumber) === job.version &&
				this.pageRenderPublications.get(job.pageNumber) === job.version &&
				this.renderInputEpoch === job.inputEpoch &&
				!this.hasActiveTransientRender();
			if (!isCurrent) {
				return;
			}
			const targetContext = surface.overlayEl.getContext("2d");
			if (!targetContext) {
				return;
			}
			this.syncCanvasBackingSize(surface.overlayEl, job.width, job.height);
			targetContext.save();
			targetContext.setTransform(1, 0, 0, 1, 0, 0);
			targetContext.clearRect(0, 0, surface.overlayEl.width, surface.overlayEl.height);
			targetContext.drawImage(snapshot.image, 0, 0, surface.overlayEl.width, surface.overlayEl.height);
			targetContext.restore();
			this.renderTelemetry.recordRenderComplete(job.pageNumber);
		} catch (error) {
			console.warn("freedraw-pdf: asynchronous canvas publication failed", error);
			this.renderTelemetry.recordRenderCancelled("snapshot publication failed");
		} finally {
			snapshot?.dispose();
			if (this.pageRenderPublications.get(job.pageNumber) === job.version) {
				this.pageRenderPublications.delete(job.pageNumber);
			}
			if (this.pageRenderJobs.size === 0 && this.pageRenderPublications.size === 0) {
				this.renderTelemetry.recordRenderIdle("render queue empty");
			}
		}
	}

	private async createCanvasSnapshot(source: HTMLCanvasElement): Promise<CanvasSnapshot> {
		const ownerWindow = source.ownerDocument.defaultView;
		if (ownerWindow && typeof ownerWindow.createImageBitmap === "function") {
			const bitmap = await ownerWindow.createImageBitmap(source);
			return {
				image: bitmap,
				dispose: () => bitmap.close()
			};
		}

		const blob = await new Promise<Blob>((resolve, reject) => {
			source.toBlob((result) => {
				if (result) {
					resolve(result);
				} else {
					reject(new Error("Canvas snapshot returned no image data"));
				}
			}, "image/png");
		});
		const image = createEl("img");
		const urlApi = ownerWindow?.URL ?? URL;
		const objectUrl = urlApi.createObjectURL(blob);
		image.src = objectUrl;
		if (typeof image.decode === "function") {
			await image.decode();
		} else {
			await new Promise<void>((resolve, reject) => {
				image.addEventListener("load", () => resolve(), { once: true });
				image.addEventListener("error", () => reject(new Error("Canvas snapshot image failed to load")), { once: true });
			});
		}
		return {
			image,
			dispose: () => urlApi.revokeObjectURL(objectUrl)
		};
	}

	private publishRenderedCanvas(source: HTMLCanvasElement, target: HTMLCanvasElement): void {
		const sourceContext = source.getContext("2d", { willReadFrequently: true });
		const targetContext = target.getContext("2d");
		if (!sourceContext || !targetContext) {
			return;
		}
		try {
			const frame = sourceContext.getImageData(0, 0, source.width, source.height);
			targetContext.putImageData(frame, 0, 0);
		} catch (error) {
			console.warn("freedraw-pdf: pixel-frame publish failed; falling back to canvas copy", error);
			targetContext.save();
			targetContext.setTransform(1, 0, 0, 1, 0, 0);
			targetContext.clearRect(0, 0, target.width, target.height);
			targetContext.drawImage(source, 0, 0);
			targetContext.restore();
		}
	}

	private cancelPageRenderJobs(reason = "cancelled"): void {
		const hadJobs = this.pageRenderJobs.size > 0 || this.pageRenderPublications.size > 0;
		this.renderInputEpoch += 1;
		if (this.pageRenderTaskHandle !== null) {
			window.clearTimeout(this.pageRenderTaskHandle);
			this.pageRenderTaskHandle = null;
		}
		this.pageRenderJobs.clear();
		this.pageRenderPublications.clear();
		if (hadJobs) {
			this.renderTelemetry.recordRenderCancelled(reason);
		}
	}

	private flushDeferredScrollRedraws(): void {
		if (this.redrawHandle !== null) {
			return;
		}
		if (this.hasActiveTransientRender()) {
			return;
		}
		const pendingPages = Array.from(this.pendingRedrawPages);
		this.pendingRedrawPages.clear();
		for (const pendingPage of pendingPages) {
			if (this.shouldKeepPageHot(pendingPage) && !this.zoomingPages.has(pendingPage)) {
				this.startPageRenderJob(pendingPage);
			}
		}
	}

	private scheduleInteractionRedraw(pageNumber: number): void {
		if (this.currentStroke || this.currentShape || this.currentLasso || this.erasingSession) {
			this.pendingInteractionRedrawPages.add(pageNumber);
			if (this.interactionRedrawHandle !== null) {
				return;
			}
			this.interactionRedrawHandle = window.requestAnimationFrame(() => {
				this.interactionRedrawHandle = null;
				const pages = Array.from(this.pendingInteractionRedrawPages);
				this.pendingInteractionRedrawPages.clear();
				for (const pendingPage of pages) {
					this.drawTransientPageAnnotations(pendingPage);
				}
			});
			return;
		}
		this.pendingInteractionRedrawPages.add(pageNumber);
		if (this.interactionRedrawHandle !== null) {
			return;
		}
		this.interactionRedrawHandle = window.requestAnimationFrame(() => {
			this.interactionRedrawHandle = null;
			const pages = Array.from(this.pendingInteractionRedrawPages);
			this.pendingInteractionRedrawPages.clear();
			for (const pendingPage of pages) {
				this.drawPageAnnotations(pendingPage);
			}
		});
	}

	private flushInteractionRedraw(pageNumber?: number | null): void {
		if (this.interactionRedrawHandle !== null) {
			window.cancelAnimationFrame(this.interactionRedrawHandle);
			this.interactionRedrawHandle = null;
		}
		const pages = pageNumber ? [pageNumber] : Array.from(this.pendingInteractionRedrawPages);
		this.pendingInteractionRedrawPages.clear();
		for (const pendingPage of pages) {
			this.drawPageAnnotations(pendingPage);
		}
	}

	private deferCommittedPageRedraw(pageNumber: number, clearTransient = true): void {
		this.cancelPendingInteractionRedraw();
		const surface = this.pageSurfaces.get(pageNumber);
		if (surface && clearTransient) {
			this.clearTransientLayer(surface);
		}
		this.pendingCommittedRedrawPages.add(pageNumber);
		this.scheduleCommittedRedrawAfterIdle(160);
	}

	private retainCommittedPagePixels(pageNumber: number): void {
		this.pendingCommittedRedrawPages.delete(pageNumber);
		if (this.pendingCommittedRedrawPages.size === 0 && this.committedRedrawHandle !== null) {
			window.clearTimeout(this.committedRedrawHandle);
			this.committedRedrawHandle = null;
		}
	}

	private retainTouchErasePixels(pageNumber: number): void {
		this.cancelPageRenderJob(pageNumber);
		this.pendingInteractionRedrawPages.delete(pageNumber);
		this.retainCommittedPagePixels(pageNumber);
	}

	private scheduleCommittedRedrawAfterIdle(delayMs = 700): void {
		if (this.committedRedrawHandle !== null) {
			window.clearTimeout(this.committedRedrawHandle);
		}
		const waitMs = Math.max(16, delayMs);
		this.committedRedrawHandle = window.setTimeout(() => {
			this.committedRedrawHandle = null;
			if (this.hasActiveTransientRender()) {
				this.scheduleCommittedRedrawAfterIdle(waitMs);
				return;
			}
			const remainingIdleMs = Math.max(0, waitMs - (performance.now() - this.lastInkInputTimestamp));
			if (remainingIdleMs > 0) {
				this.scheduleCommittedRedrawAfterIdle(remainingIdleMs);
				return;
			}
			const pages = Array.from(this.pendingCommittedRedrawPages);
			this.pendingCommittedRedrawPages.clear();
			for (const pageNumber of pages) {
				this.schedulePageRedraw(pageNumber);
			}
		}, waitMs);
	}

	private cancelPendingInteractionRedraw(): void {
		if (this.interactionRedrawHandle !== null) {
			window.cancelAnimationFrame(this.interactionRedrawHandle);
			this.interactionRedrawHandle = null;
		}
		this.pendingInteractionRedrawPages.clear();
	}

	private hasActiveTransientRender(): boolean {
		return !!(this.currentStroke || this.currentShape || this.currentLasso || this.erasingSession);
	}

	private flushPendingCommittedPageRedraws(): void {
		if (this.committedRedrawHandle !== null) {
			window.clearTimeout(this.committedRedrawHandle);
			this.committedRedrawHandle = null;
		}
		const pages = Array.from(this.pendingCommittedRedrawPages);
		this.pendingCommittedRedrawPages.clear();
		for (const pageNumber of pages) {
			this.schedulePageRedraw(pageNumber);
		}
	}

	private pauseCommittedRenderingForInkInput(): void {
		this.lastInkInputTimestamp = performance.now();
		this.queueInterruptedPageRenders();
		this.cancelPageRenderJobs("cancelled by pointer input");
		this.cancelPendingInteractionRedraw();
		if (this.committedRedrawHandle !== null) {
			window.clearTimeout(this.committedRedrawHandle);
			this.committedRedrawHandle = null;
		}
		if (this.redrawHandle !== null) {
			window.cancelAnimationFrame(this.redrawHandle);
			this.redrawHandle = null;
		}
	}

	private queueInterruptedPageRenders(): void {
		for (const pageNumber of this.pageRenderJobs.keys()) {
			this.pendingRedrawPages.add(pageNumber);
		}
		for (const pageNumber of this.pageRenderPublications.keys()) {
			this.pendingRedrawPages.add(pageNumber);
		}
	}

	private resumeCommittedRenderingAfterInkInput(): void {
		if (!this.annotationDocument || this.redrawHandle !== null) {
			return;
		}
		this.redrawHandle = window.requestAnimationFrame(() => {
			this.redrawHandle = null;
			if (this.hasActiveTransientRender() || this.isViewportMotionActive()) {
				return;
			}
			this.flushDeferredScrollRedraws();
		});
	}

	private isFingerPanRenderingPaused(): boolean {
		return this.fingerPanPointerId !== null || this.fingerPanInertiaHandle !== null;
	}

	private isViewportMotionActive(): boolean {
		return this.isPdfScrolling || this.isFingerPanRenderingPaused();
	}

	private pauseCommittedRenderingForViewportMotion(): void {
		for (const pageNumber of this.pageRenderJobs.keys()) {
			this.pendingRedrawPages.add(pageNumber);
		}
		for (const pageNumber of this.pageRenderPublications.keys()) {
			this.pendingRedrawPages.add(pageNumber);
		}
		for (const pageNumber of this.pageSurfaces.keys()) {
			if (this.shouldKeepPageHot(pageNumber)) {
				this.pendingRedrawPages.add(pageNumber);
			}
		}
		this.cancelPageRenderJobs("cancelled by viewport motion");
		this.cancelPendingInteractionRedraw();
		if (this.committedRedrawHandle !== null) {
			window.clearTimeout(this.committedRedrawHandle);
			this.committedRedrawHandle = null;
		}
		if (this.redrawHandle !== null) {
			window.cancelAnimationFrame(this.redrawHandle);
			this.redrawHandle = null;
		}
	}

	private resumeCommittedRenderingAfterFingerPan(): void {
		if (this.isViewportMotionActive() || !this.annotationDocument || this.redrawHandle !== null) {
			return;
		}
		this.redrawHandle = window.requestAnimationFrame(() => {
			this.redrawHandle = null;
			if (this.isViewportMotionActive() || this.hasActiveTransientRender()) {
				return;
			}
			this.forceRedrawVisibleAnnotations();
		});
	}

	private isPageNearViewport(pageNumber: number): boolean {
		const surface = this.pageSurfaces.get(pageNumber);
		if (!surface || !this.scrollParent) {
			return false;
		}
		const containerRect = this.scrollParent.getBoundingClientRect();
		const rect = surface.pageEl.getBoundingClientRect();
		const margin = 120;
		return rect.bottom >= containerRect.top - margin && rect.top <= containerRect.bottom + margin;
	}

	private shouldKeepPageHot(pageNumber: number): boolean {
		if (pageNumber === this.currentPage || pageNumber === this.pointerPage) {
			return true;
		}
		if (this.visiblePageRange) {
			return pageNumber >= this.visiblePageRange.start && pageNumber <= this.visiblePageRange.end;
		}
		return this.isPageNearViewport(pageNumber);
	}

	private updateVisiblePageRange(allowRedraw = true): void {
		if (this.pageSurfaces.size === 0 || !this.scrollParent) {
			return;
		}

		const visiblePages = Array.from(this.pageSurfaces.keys())
			.filter((pageNumber) => this.isPageNearViewport(pageNumber))
			.sort((left, right) => left - right);

		if (visiblePages.length === 0) {
			return;
		}

		const previousRange = this.visiblePageRange;
		const nextRange = {
			start: Math.max(1, visiblePages[0] - PAGE_VIRTUALIZATION_MARGIN),
			end: visiblePages[visiblePages.length - 1] + PAGE_VIRTUALIZATION_MARGIN
		};
		if (previousRange && previousRange.start === nextRange.start && previousRange.end === nextRange.end) {
			return;
		}
		this.visiblePageRange = nextRange;

		for (const [pageNumber, surface] of this.pageSurfaces.entries()) {
			const hot = this.shouldKeepPageHot(pageNumber);
			surface.overlayEl.setCssStyles({ visibility: "visible" });
			const wasHot = previousRange
				? pageNumber >= previousRange.start && pageNumber <= previousRange.end
				: false;
			if (allowRedraw && hot && !wasHot) {
				this.schedulePageRedraw(pageNumber);
			}
		}
	}

	private updateCurrentPageFromScroll(): void {
		if (!this.scrollParent || this.pageSurfaces.size === 0) {
			return;
		}

		const containerRect = this.scrollParent.getBoundingClientRect();
		let nearestPage = this.currentPage;
		let nearestDistance = Number.POSITIVE_INFINITY;

		for (const [pageNumber, surface] of this.pageSurfaces.entries()) {
			const rect = surface.pageEl.getBoundingClientRect();
			const distance = Math.abs(rect.top - containerRect.top - 28);
			if (distance < nearestDistance) {
				nearestDistance = distance;
				nearestPage = pageNumber;
			}
		}

		if (nearestPage !== this.currentPage) {
			this.currentPage = nearestPage;
			this.updateNativeMixedPageThumbnailSelection();
			this.syncNativeMixedPageNavigator();
		}
	}

	private buildPageLink(pageNumber: number): string {
		if (!this.file) {
			return "";
		}
		return `[[${this.file.path}#page=${pageNumber}]]`;
	}

	private buildSelectionRegionReference(): string | null {
		const region = this.getSelectionRegion();
		if (!region) {
			return null;
		}
		const rect = [region.rect.left, region.rect.top, region.rect.right, region.rect.bottom]
			.map((value) => value.toFixed(4))
			.join(",");
		return `[[${region.file.path}#page=${region.page}]] ::region[page=${region.page};rect=${rect}]`;
	}

	private getSelectionRegion(): { file: TFile; page: number; rect: NormalizedRect } | null {
		if (!this.file) {
			return null;
		}
		if (this.lastSelectionRegion) {
			return { file: this.file, page: this.lastSelectionRegion.page, rect: this.lastSelectionRegion.rect };
		}
		if (this.selectedTargets.length === 0) {
			return null;
		}
		const selectionPage = this.getSelectionPage();
		if (!selectionPage) {
			return null;
		}
		const bounds = this.getCombinedBounds(this.selectedTargets.filter((target) => target.page === selectionPage));
		const rect = bounds ? normalizeRect(bounds) : null;
		return rect ? { file: this.file, page: selectionPage, rect } : null;
	}

	private async insertSessionTextAtPoint(pageNumber: number, point: AnnotationPoint, boxWidthScale?: number, boxHeightScale?: number): Promise<void> {
		this.beginSessionInlineTextEditor(pageNumber, point, undefined, boxWidthScale, boxHeightScale);
	}

	private beginSessionInlineTextEditor(pageNumber: number, point: AnnotationPoint, existingItem?: TextAnnotation, boxWidthScale?: number, boxHeightScale?: number): void {
		if (!this.annotationDocument) {
			return;
		}
		const surface = this.pageSurfaces.get(pageNumber);
		if (!surface || this.inlineTextEditorEl) {
			return;
		}
		const editingExistingText = !!existingItem;
		const autoFitTextBox = existingItem
			? existingItem.manualBoxSize !== true
			: false;
		if (existingItem) {
			this.selectedTarget = { kind: "text", id: existingItem.id, page: pageNumber };
			this.selectedTargets = [this.selectedTarget];
			this.syncCurrentTextStyleFromItem(existingItem);
		}
		const autoFitSize = autoFitTextBox && existingItem
			? this.measureAutoFitTextAnnotation(surface, {
				...existingItem,
				autoFit: true,
				boxWidthScale: undefined
			})
			: null;
		const layoutSource = autoFitSize
			? ({
				...existingItem,
				autoFit: true,
				boxWidthScale: autoFitSize.width / Math.max(surface.lastWidth, 1),
				boxHeightScale: autoFitSize.height / Math.max(surface.lastHeight, 1)
			} as TextAnnotation)
			: (boxWidthScale && boxWidthScale > 0) || (boxHeightScale && boxHeightScale > 0)
			? ({ ...existingItem, boxWidthScale, boxHeightScale } as TextAnnotation)
			: existingItem;
		const layout = getInlineTextEditorLayout(point, surface.lastWidth, surface.lastHeight, layoutSource);
		const frame = createDiv();
		frame.className = "pdf-native-annotator-inline-text-frame";
		frame.classList.toggle("is-auto-fit", autoFitTextBox);
		if (editingExistingText) {
			frame.classList.add("is-editing-selected");
		}
		frame.setCssStyles({
			left: `${layout.left}px`,
			top: `${layout.top}px`,
			width: `${layout.width}px`,
			height: `${layout.height}px`
		});
		frame.dataset.left = String(layout.left);
		frame.dataset.top = String(layout.top);
		frame.addEventListener("pointerdown", (event) => {
			event.stopPropagation();
			if (event.target !== frame) {
				return;
			}
			event.preventDefault();
			const startClientX = event.clientX;
			const startClientY = event.clientY;
			const startLeft = Number(frame.dataset.left) || 0;
			const startTop = Number(frame.dataset.top) || 0;
			const frameRect = frame.getBoundingClientRect();
			const onMove = (moveEvent: PointerEvent): void => {
				moveEvent.preventDefault();
				const nextLeft = clamp(startLeft + (moveEvent.clientX - startClientX), 8, Math.max(8, surface.lastWidth - frameRect.width - 8));
				const nextTop = clamp(startTop + (moveEvent.clientY - startClientY), 8, Math.max(8, surface.lastHeight - frameRect.height - 8));
				frame.setCssStyles({
					left: `${nextLeft}px`,
					top: `${nextTop}px`
				});
				frame.dataset.left = String(nextLeft);
				frame.dataset.top = String(nextTop);
				this.inlineTextPoint = {
					x: clamp(nextLeft / Math.max(surface.lastWidth, 1), 0.01, 0.96),
					y: clamp(nextTop / Math.max(surface.lastHeight, 1), 0.01, 0.96),
					pressure: 0.5
				};
			};
			const onUp = (): void => {
				window.removeEventListener("pointermove", onMove, true);
				window.removeEventListener("pointerup", onUp, true);
			};
			window.addEventListener("pointermove", onMove, true);
			window.addEventListener("pointerup", onUp, true);
		});
		frame.addEventListener("click", (event) => {
			event.stopPropagation();
		});
		const editor = createEl("textarea");
		editor.className = "pdf-native-annotator-inline-text-editor";
		editor.value = existingItem?.text ?? "";
		const editorFontScale = existingItem
			? this.resolveStoredFontScale(existingItem)
			: this.getStableTextFontScale(this.currentTextFontSize);
		const baseFontSize = getRenderedTextFontSize(editorFontScale, surface.lastWidth);
		const fontFamily = existingItem?.fontFamily ?? this.currentTextFontFamily;
		const fontWeight = existingItem ? resolveTextFontWeight(existingItem) : this.currentTextFontWeight;
		const fontStyle = existingItem ? resolveTextFontStyle(existingItem) : this.currentTextFontStyle;
		const textAlign = existingItem ? resolveTextAlignment(existingItem) : this.currentTextAlignment;
		const verticalAlign = existingItem ? resolveTextVerticalAlignment(existingItem) : this.currentTextVerticalAlignment;
		const lineSpacing = existingItem ? resolveTextLineSpacing(existingItem) : this.currentTextLineSpacing;
		const wordWrap = existingItem ? resolveTextWordWrap(existingItem) : this.currentTextWordWrap;
		editor.wrap = wordWrap ? "soft" : "off";
		editor.placeholder = "Type text";
		editor.spellcheck = true;
		editor.autocomplete = "off";
		editor.autocapitalize = "sentences";
		editor.inputMode = "text";
		editor.enterKeyHint = "enter";
		const textColor = existingItem?.color ?? this.currentTextColor;
		if (existingItem) {
			this.currentTextFontFamily = fontFamily;
			this.currentTextColor = textColor;
			this.currentTextFontWeight = fontWeight;
			this.currentTextFontStyle = fontStyle;
			this.currentTextAlignment = textAlign;
			this.currentTextVerticalAlignment = verticalAlign;
			this.currentTextLineSpacing = lineSpacing;
			this.currentTextWordWrap = wordWrap;
		}
		editor.dataset.textColor = textColor;
		editor.dataset.fontScale = String(editorFontScale);
		editor.setCssStyles({
			color: "transparent",
			fontSize: `${baseFontSize}px`,
			fontFamily: `"${fontFamily}", sans-serif`,
			fontWeight,
			fontStyle,
			textAlign,
			lineHeight: String(lineSpacing),
			whiteSpace: wordWrap ? "pre-wrap" : "pre",
			overflowWrap: wordWrap ? "break-word" : "normal"
		});
		editor.setCssProps({ "--annotator-inline-text-color": textColor });
		frame.appendChild(editor);
		const focusEditor = (): void => {
			if (!editor.isConnected) {
				return;
			}
			editor.focus({ preventScroll: true });
		};
		editor.addEventListener("pointerdown", () => focusEditor());
		editor.addEventListener("pointerup", () => focusEditor());
		const caretMirror = createDiv({ cls: "pdf-native-annotator-inline-text-caret-mirror" });
		caretMirror.setCssStyles({
			fontSize: `${baseFontSize}px`,
			fontFamily: `"${fontFamily}", sans-serif`,
			fontWeight,
			fontStyle,
			textAlign,
			lineHeight: String(lineSpacing),
			whiteSpace: wordWrap ? "pre-wrap" : "pre",
			overflowWrap: wordWrap ? "break-word" : "normal"
		});
		frame.appendChild(caretMirror);
		this.addInlineTextFrameHandles(frame, editor, surface.lastWidth, surface.lastHeight);
		surface.hostEl.appendChild(frame);
		this.inlineTextEditorFrameEl = frame;
		this.inlineTextEditorEl = editor;
		this.inlineTextCaretMirrorEl = caretMirror;
		this.inlineTextTargetId = existingItem?.id ?? null;
		this.inlineTextPoint = layout.point;
		this.inlineTextPageNumber = pageNumber;
		this.inlineTextAutoFit = autoFitTextBox;
		this.applyInlineTextEditorScale(editor, surface.lastWidth);
		this.captureVisualViewportBaseline();
		// iPadOS only opens the software keyboard while the trusted Pencil/touch
		// activation is still on the stack. A deferred focus creates the box but
		// leaves it impossible to type into.
		focusEditor();
		editor.setSelectionRange(editor.value.length, editor.value.length);
		const resizeEditor = (): void => {
			if (!autoFitTextBox || editingExistingText || boxWidthScale || boxHeightScale) {
				editor.setCssStyles({ height: "100%" });
				return;
			}
			resizeInlineTextEditor(editor, surface.lastHeight * 0.42);
		};
		const commit = (): void => {
			this.finishSessionInlineTextEditor(true);
		};
		editor.addEventListener("input", resizeEditor);
		editor.addEventListener("input", () => {
			this.updateInlineTextEditorBoxFromContent(pageNumber);
			this.drawPageAnnotations(pageNumber);
			this.updateInlineTextCaretMirror();
		});
		editor.addEventListener("select", () => this.updateInlineTextCaretMirror());
		editor.addEventListener("keyup", () => this.updateInlineTextCaretMirror());
		editor.addEventListener("pointerup", () => this.updateInlineTextCaretMirror());
		editor.addEventListener("blur", () => {
			window.setTimeout(() => {
				if (this.inlineTextEditorEl !== editor) {
					return;
				}
				const activeElement = editor.ownerDocument.activeElement;
				if (activeElement === editor) {
					return;
				}
				if (
					isHtmlElement(activeElement) &&
					activeElement.closest(
						".pdf-native-annotator-toolbar, " +
						".pdf-native-annotator-font-popover, " +
						".pdf-native-annotator-color-popover"
					)
				) {
					return;
				}
				commit();
			}, 0);
		});
		editor.addEventListener("keydown", (event) => {
			event.stopPropagation();
		});
		resizeEditor();
		this.updateInlineTextEditorBoxFromContent(pageNumber);
		this.drawPageAnnotations(pageNumber);
		this.updateInlineTextCaretMirror();
		window.setTimeout(() => {
			if (this.inlineTextEditorEl === editor && editor.isConnected && editor.ownerDocument.activeElement !== editor) {
				focusEditor();
				editor.setSelectionRange(editor.value.length, editor.value.length);
				this.updateInlineTextCaretMirror();
			}
		}, 0);
		this.refreshStatus("Type on page. Enter adds a line, Ctrl/Cmd+Enter saves, Esc cancels.");
	}

	private finishSessionInlineTextEditor(apply: boolean): void {
		const editor = this.inlineTextEditorEl;
		const frame = this.inlineTextEditorFrameEl;
		const pageNumber = this.inlineTextPageNumber;
		const point = pageNumber === null
			? this.inlineTextPoint
			: this.getInlineTextFramePoint(pageNumber);
		const targetId = this.inlineTextTargetId;
		const autoFit = this.inlineTextAutoFit;
		const value = editor?.value.trim() ?? "";
		const editorColor = editor?.dataset.textColor || this.currentTextColor;
		const frameRect = frame?.getBoundingClientRect() ?? null;
		const editorRect = editor?.getBoundingClientRect() ?? null;
		const preview = pageNumber === null ? null : this.getInlineTextPreviewItem(pageNumber);
		if (frame) {
			frame.remove();
		} else if (editor) {
			editor.remove();
		}
		this.inlineTextEditorEl = null;
		this.inlineTextEditorFrameEl = null;
		this.inlineTextCaretMirrorEl = null;
		this.inlineTextTargetId = null;
		this.inlineTextPoint = null;
		this.inlineTextPageNumber = null;
		this.inlineTextAutoFit = false;
		if (!apply || !this.annotationDocument || !point || pageNumber === null) {
			return;
		}
		const surface = this.pageSurfaces.get(pageNumber);
		const pageWidth = Math.max(surface?.lastWidth ?? 1, 1);
		const editorWidth = frameRect ? frameRect.width : editorRect ? editorRect.width : Number.NaN;
		const pageHeight = Math.max(surface?.lastHeight ?? 1, 1);
		const editorHeight = frameRect ? frameRect.height : editorRect ? editorRect.height : Number.NaN;
		const boxWidthScale = Number.isFinite(editorWidth) ? clamp(editorWidth / pageWidth, 0.04, 0.9) : undefined;
		const boxHeightScale = preview?.boxHeightScale ?? (Number.isFinite(editorHeight) ? clamp(editorHeight / pageHeight, 0.025, 0.9) : undefined);
		const nextX = clamp(point.x, 0.01, 0.96);
		const nextY = clamp(point.y, 0.01, 0.96);
		if (!value && !targetId) {
			return;
		}
		this.pushHistory();
		if (targetId) {
			const existing = this.annotationDocument.textItems.find((entry) => entry.id === targetId);
			if (existing) {
				if (!value.trim()) {
					this.annotationDocument.textItems = this.annotationDocument.textItems.filter((entry) => entry.id !== targetId);
					this.selectedTargets = this.selectedTargets.filter((target) => target.id !== targetId);
					this.selectedTarget = this.selectedTargets[0] ?? null;
					this.markDirtyAndRedraw("Text annotation deleted");
					return;
				}
				existing.text = value;
				existing.x = nextX;
				existing.y = nextY;
				existing.color = editorColor || existing.color || this.currentTextColor;
				existing.fontFamily = this.currentTextFontFamily;
				existing.fontSize = this.currentTextFontSize;
				existing.fontScale = this.getStableTextFontScale(this.currentTextFontSize);
				existing.fontWeight = this.currentTextFontWeight;
				existing.fontStyle = this.currentTextFontStyle;
				existing.textAlign = this.currentTextAlignment;
				existing.verticalAlign = this.currentTextVerticalAlignment;
				existing.lineSpacing = this.currentTextLineSpacing;
				existing.wordWrap = this.currentTextWordWrap;
				existing.autoFit = autoFit;
				existing.manualBoxSize = !autoFit;
				existing.boxWidthScale = boxWidthScale ?? existing.boxWidthScale;
				existing.boxHeightScale = boxHeightScale ?? existing.boxHeightScale;
				if (this.currentTool === "text") {
					this.selectedTarget = null;
					this.selectedTargets = [];
				} else {
					this.selectedTarget = { kind: "text", id: existing.id, page: pageNumber };
					this.selectedTargets = [this.selectedTarget];
				}
				this.markDirtyAndRedraw("Text annotation updated");
				return;
			}
		}
		if (!value.trim()) {
			return;
		}
		const nextText: TextAnnotation = {
			id: generateId("text"),
			page: pageNumber,
			text: value,
			x: nextX,
			y: nextY,
			color: editorColor || this.currentTextColor,
			fontSize: this.currentTextFontSize,
			fontFamily: this.currentTextFontFamily,
			fontScale: this.getStableTextFontScale(this.currentTextFontSize),
			fontWeight: this.currentTextFontWeight,
			fontStyle: this.currentTextFontStyle,
			textAlign: this.currentTextAlignment,
			verticalAlign: this.currentTextVerticalAlignment,
			lineSpacing: this.currentTextLineSpacing,
			wordWrap: this.currentTextWordWrap,
			autoFit,
			manualBoxSize: !autoFit,
			boxWidthScale,
			boxHeightScale,
			zIndex: this.getNextPageZIndex(pageNumber),
			createdAt: new Date().toISOString()
		};
		this.annotationDocument.textItems.push(nextText);
		if (this.currentTool === "text") {
			this.selectedTarget = null;
			this.selectedTargets = [];
		} else {
			this.selectedTarget = { kind: "text", id: nextText.id, page: pageNumber };
			this.selectedTargets = [this.selectedTarget];
		}
		this.markDirtyAndRedraw("Text annotation added");
	}

	private getInlineTextFramePoint(pageNumber: number): AnnotationPoint | null {
		const fallback = this.inlineTextPoint;
		const frame = this.inlineTextEditorFrameEl;
		const surface = this.pageSurfaces.get(pageNumber);
		if (!frame || !surface) {
			return fallback;
		}
		const left = Number(frame.dataset.left);
		const top = Number(frame.dataset.top);
		if (!Number.isFinite(left) || !Number.isFinite(top)) {
			return fallback;
		}
		return {
			x: clamp(left / Math.max(surface.lastWidth, 1), 0.01, 0.96),
			y: clamp(top / Math.max(surface.lastHeight, 1), 0.01, 0.96),
			pressure: fallback?.pressure ?? 0.5
		};
	}

	private resizeInlineTextEditorForSurface(
		surface: PageSurface,
		previousWidth: number,
		previousHeight: number,
		nextWidth = surface.lastWidth,
		nextHeight = surface.lastHeight
	): void {
		const frame = this.inlineTextEditorFrameEl;
		const editor = this.inlineTextEditorEl;
		const point = this.inlineTextPoint;
		if (
			!frame ||
			!editor ||
			!point ||
			this.inlineTextPageNumber !== surface.pageNumber ||
			previousWidth <= 0 ||
			previousHeight <= 0
		) {
			return;
		}

		const renderedRect = frame.getBoundingClientRect();
		const frameWidth = Number.parseFloat(frame.style.width) || renderedRect.width;
		const frameHeight = Number.parseFloat(frame.style.height) || renderedRect.height;
		const widthScale = clamp(frameWidth / previousWidth, 0.04, 0.9);
		const heightScale = clamp(frameHeight / previousHeight, 0.025, 0.9);
		const layout = getZoomStableTextFrameLayout(
			point,
			widthScale,
			heightScale,
			nextWidth,
			nextHeight
		);

		frame.setCssStyles({
			left: `${layout.left}px`,
			top: `${layout.top}px`,
			width: `${layout.width}px`,
			height: `${layout.height}px`
		});
		frame.dataset.left = String(layout.left);
		frame.dataset.top = String(layout.top);
		editor.setCssStyles({ height: "100%" });
		this.applyInlineTextEditorScale(editor, nextWidth);
		this.updateInlineTextVerticalAlignment(surface.pageNumber);
		this.updateInlineTextCaretMirror();
	}

	private applyInlineTextEditorScale(editor: HTMLTextAreaElement, pageWidth: number): void {
		const fontScale = Number(editor.dataset.fontScale);
		const metrics = getRenderedTextLayoutMetrics(pageWidth);
		const fontSize = getRenderedTextFontSize(
			Number.isFinite(fontScale) && fontScale > 0
				? fontScale
				: this.getStableTextFontScale(this.currentTextFontSize),
			pageWidth
		);
		const horizontalPadding = `${metrics.paddingX}px`;
		editor.setCssStyles({
			fontSize: `${fontSize}px`,
			paddingLeft: horizontalPadding,
			paddingRight: horizontalPadding,
			minHeight: `${metrics.minimumBoxHeight}px`
		});
		this.inlineTextEditorFrameEl?.setCssStyles({
			minWidth: `${metrics.minimumBoxWidth}px`,
			minHeight: `${metrics.minimumBoxHeight}px`
		});
		this.inlineTextCaretMirrorEl?.setCssStyles({
			fontSize: `${fontSize}px`,
			paddingLeft: horizontalPadding,
			paddingRight: horizontalPadding
		});
	}

	private addInlineTextFrameHandles(frame: HTMLDivElement, editor: HTMLTextAreaElement, pageWidth: number, pageHeight: number): void {
		const handles: Array<{ name: ResizeHandle; cls: string }> = [
			{ name: "nw", cls: "is-nw" },
			{ name: "n", cls: "is-n" },
			{ name: "ne", cls: "is-ne" },
			{ name: "e", cls: "is-e" },
			{ name: "se", cls: "is-se" },
			{ name: "s", cls: "is-s" },
			{ name: "sw", cls: "is-sw" },
			{ name: "w", cls: "is-w" }
		];
		for (const handle of handles) {
			const handleEl = createEl("button");
			handleEl.type = "button";
			handleEl.className = `pdf-native-annotator-inline-text-handle ${handle.cls}`;
			handleEl.setAttribute("aria-label", `Resize text box ${handle.name}`);
			handleEl.addEventListener("pointerdown", (event) => {
				event.preventDefault();
				event.stopPropagation();
				this.inlineTextAutoFit = false;
				frame.classList.remove("is-auto-fit");
				const startClientX = event.clientX;
				const startClientY = event.clientY;
				const startWidth = frame.getBoundingClientRect().width;
				const startHeight = frame.getBoundingClientRect().height;
				const startLeft = Number(frame.dataset.left) || 0;
				const startTop = Number(frame.dataset.top) || 0;
				const onMove = (moveEvent: PointerEvent): void => {
					moveEvent.preventDefault();
					const delta = moveEvent.clientX - startClientX;
					const deltaY = moveEvent.clientY - startClientY;
					let nextLeft = startLeft;
					let nextTop = startTop;
					let nextWidth = startWidth;
					let nextHeight = startHeight;
					if (handle.name.includes("e")) {
						nextWidth = clamp(startWidth + delta, 44, Math.max(44, pageWidth - startLeft - 12));
					}
					if (handle.name.includes("w")) {
						nextLeft = clamp(startLeft + delta, 8, startLeft + startWidth - 44);
						nextWidth = clamp(startWidth - (nextLeft - startLeft), 44, Math.max(44, pageWidth - 12));
					}
					if (handle.name.includes("s")) {
						nextHeight = clamp(startHeight + deltaY, 36, Math.max(36, pageHeight - startTop - 12));
					}
					if (handle.name.includes("n")) {
						nextTop = clamp(startTop + deltaY, 8, startTop + startHeight - 36);
						nextHeight = clamp(startHeight - (nextTop - startTop), 36, Math.max(36, pageHeight - 12));
					}
					frame.setCssStyles({
						left: `${nextLeft}px`,
						top: `${nextTop}px`,
						width: `${nextWidth}px`,
						height: `${nextHeight}px`
					});
					frame.dataset.left = String(nextLeft);
					frame.dataset.top = String(nextTop);
					editor.setCssStyles({ height: `${Math.max(36, nextHeight)}px` });
					if (this.inlineTextPageNumber !== null) {
						this.updateInlineTextVerticalAlignment(this.inlineTextPageNumber);
						this.scheduleInteractionRedraw(this.inlineTextPageNumber);
					}
					if (this.inlineTextPoint) {
						this.inlineTextPoint = {
							...this.inlineTextPoint,
							x: clamp(nextLeft / Math.max(pageWidth, 1), 0.01, 0.96),
							y: clamp(nextTop / Math.max(pageHeight, 1), 0.01, 0.96)
						};
					}
				};
				const onUp = (): void => {
					window.removeEventListener("pointermove", onMove, true);
					window.removeEventListener("pointerup", onUp, true);
					editor.focus();
				};
				window.addEventListener("pointermove", onMove, true);
				window.addEventListener("pointerup", onUp, true);
			});
			frame.appendChild(handleEl);
		}
	}

	private get currentTool(): AnnotationTool {
		return this.toolState.activeTool;
	}

	private get eraserMode(): EraserMode {
		return this.toolState.eraserMode;
	}

	private get currentColor(): string {
		return this.toolState.activeColor;
	}

	private getStableAnnotationWidthScale(width: number): number {
		return clamp(width / DEFAULT_STROKE_REFERENCE_WIDTH, 0.0005, MAX_STROKE_WIDTH_SCALE);
	}

	private getStableTextFontScale(fontSize: number): number {
		return clamp(fontSize / DEFAULT_STROKE_REFERENCE_WIDTH, 0.004, MAX_TEXT_FONT_SCALE);
	}

	private syncCurrentTextStyleFromItem(item: TextAnnotation): void {
		this.currentTextFontFamily = item.fontFamily ?? this.currentTextFontFamily;
		this.currentTextFontSize = Math.round(item.fontSize);
		this.currentTextColor = item.color ?? this.currentTextColor;
		this.currentTextFontWeight = resolveTextFontWeight(item);
		this.currentTextFontStyle = resolveTextFontStyle(item);
		this.currentTextAlignment = resolveTextAlignment(item);
		this.currentTextVerticalAlignment = resolveTextVerticalAlignment(item);
		this.currentTextLineSpacing = resolveTextLineSpacing(item);
		this.currentTextWordWrap = resolveTextWordWrap(item);
	}

	private resolveStoredScale(width: number, storedScale: number | undefined, maxScale: number): number {
		const fallbackScale = width > 0
			? clamp(width / DEFAULT_STROKE_REFERENCE_WIDTH, 0.0005, maxScale)
			: 0.0005;
		if (
			typeof storedScale === "number" &&
			Number.isFinite(storedScale) &&
			storedScale > 0 &&
			storedScale <= maxScale &&
			storedScale <= fallbackScale * SCALE_DRIFT_TOLERANCE
		) {
			return storedScale;
		}
		return fallbackScale;
	}

	private resolveStoredFontScale(textItem: TextAnnotation): number {
		const fallbackScale = this.getStableTextFontScale(textItem.fontSize);
		const storedScale = textItem.fontScale;
		if (
			typeof storedScale === "number" &&
			Number.isFinite(storedScale) &&
			storedScale > 0 &&
			storedScale <= MAX_TEXT_FONT_SCALE &&
			storedScale <= fallbackScale * SCALE_DRIFT_TOLERANCE
		) {
			return storedScale;
		}
		return fallbackScale;
	}

	private setActiveTool(tool: AnnotationTool): void {
		if (this.inlineTextEditorEl && tool !== "text") {
			this.finishSessionInlineTextEditor(true);
		}
		if (tool !== "select" && this.selectedTargets.length > 0) {
			this.clearSelection();
		}
		this.toolState.setActiveTool(tool);
		if (!isInkDrawingTool(tool) && this.pendingCommittedRedrawPages.size > 0) {
			this.flushPendingCommittedPageRedraws();
		}
		if (!this.annotationMode) {
			this.annotationMode = true;
			this.applyOverlayMode();
			this.refreshStatus("Annotation mode enabled");
		}
		this.persistToolDefaults();
	}

	private setCurrentColor(color: string): void {
		this.toolState.setColor(color);
		this.persistToolDefaults();
		this.updateInlineTextEditorStyle();
	}

	private shouldApplyStyleToSelection(): boolean {
		return this.currentTool === "select" && this.selectedTargets.length > 0;
	}

	private hasSelectedText(): boolean {
		return this.selectedTargets.some((target) => target.kind === "text");
	}

	private shouldApplyTextStyleToSelection(): boolean {
		return !this.inlineTextEditorEl && this.selectedTargets.some((target) => target.kind === "text");
	}

	private applyColorToSelection(color: string, pushHistory = true): void {
		if (!this.annotationDocument || this.selectedTargets.length === 0) {
			return;
		}
		if (pushHistory) {
			this.pushHistory();
		}
		for (const target of this.selectedTargets) {
			if (target.kind === "stroke") {
				const stroke = this.annotationDocument.strokes.find((entry) => entry.id === target.id);
				if (stroke) {
					stroke.color = color;
				}
				continue;
			}
			if (target.kind === "text") {
				const item = this.annotationDocument.textItems.find((entry) => entry.id === target.id);
				if (item) {
					item.color = color;
				}
				continue;
			}
			const shape = this.annotationDocument.shapes.find((entry) => entry.id === target.id);
			if (shape) {
				shape.color = color;
			}
		}
		this.markDirtyAndRedraw(this.selectedTargets.length === 1 ? "Selection color updated" : `Updated ${this.selectedTargets.length} selection colors`);
	}

	private applyTextColorToSelection(color: string, pushHistory = true): void {
		if (!this.annotationDocument || !this.hasSelectedText()) {
			return;
		}
		if (pushHistory) {
			this.pushHistory();
		}
		for (const target of this.selectedTargets) {
			if (target.kind !== "text") {
				continue;
			}
			const item = this.annotationDocument.textItems.find((entry) => entry.id === target.id);
			if (item) {
				item.color = color;
			}
		}
		this.markDirtyAndRedraw("Text color updated");
	}

	private applyWidthToSelection(width: number, pushHistory = true): void {
		if (!this.annotationDocument || this.selectedTargets.length === 0) {
			return;
		}
		if (pushHistory) {
			this.pushHistory();
		}
		for (const target of this.selectedTargets) {
			if (target.kind === "stroke") {
				const stroke = this.annotationDocument.strokes.find((entry) => entry.id === target.id);
				if (stroke) {
					stroke.width = width;
					stroke.widthScale = this.getStableAnnotationWidthScale(width);
				}
				continue;
			}
			if (target.kind === "shape") {
				const shape = this.annotationDocument.shapes.find((entry) => entry.id === target.id);
				if (shape) {
					shape.width = width;
					shape.widthScale = this.getStableAnnotationWidthScale(width);
				}
				continue;
			}
			const item = this.annotationDocument.textItems.find((entry) => entry.id === target.id);
			if (item) {
				item.fontSize = clamp(width * 4, 10, 96);
				item.fontScale = this.getStableTextFontScale(item.fontSize);
			}
		}
		this.markDirtyAndRedraw(this.selectedTargets.length === 1 ? "Selection width updated" : `Updated ${this.selectedTargets.length} selection widths`);
	}

	private applyFontFamilyToSelection(fontFamily: string): void {
		if (!this.annotationDocument || !this.hasSelectedText()) {
			return;
		}
		this.pushHistory();
		for (const target of this.selectedTargets) {
			if (target.kind !== "text") {
				continue;
			}
			const item = this.annotationDocument.textItems.find((entry) => entry.id === target.id);
			if (item) {
				item.fontFamily = fontFamily;
				this.updateAutoFitTextAnnotation(item, target.page);
			}
		}
		this.markDirtyAndRedraw("Text font updated");
	}

	private applyTextSizeToSelection(fontSize: number): void {
		if (!this.annotationDocument || !this.hasSelectedText()) {
			return;
		}
		this.pushHistory();
		for (const target of this.selectedTargets) {
			if (target.kind !== "text") {
				continue;
			}
			const item = this.annotationDocument.textItems.find((entry) => entry.id === target.id);
			if (item) {
				item.fontSize = fontSize;
				item.fontScale = this.getStableTextFontScale(fontSize);
				this.updateAutoFitTextAnnotation(item, target.page);
			}
		}
		this.markDirtyAndRedraw("Text size updated");
	}

	private applyTextFormattingToSelection(
		update: Partial<Pick<
			TextAnnotation,
			"fontWeight" | "fontStyle" | "textAlign" | "verticalAlign" | "lineSpacing" | "wordWrap"
		>>,
		message: string
	): void {
		if (!this.annotationDocument || !this.hasSelectedText()) {
			return;
		}
		this.pushHistory();
		for (const target of this.selectedTargets) {
			if (target.kind !== "text") {
				continue;
			}
			const item = this.annotationDocument.textItems.find((entry) => entry.id === target.id);
			if (item) {
				Object.assign(item, update);
				this.updateAutoFitTextAnnotation(item, target.page);
			}
		}
		this.markDirtyAndRedraw(message);
	}

	private applyTextAutoFitToSelection(autoFit: boolean): void {
		if (!this.annotationDocument || !this.hasSelectedText()) {
			return;
		}
		this.pushHistory();
		for (const target of this.selectedTargets) {
			if (target.kind !== "text") {
				continue;
			}
			const item = this.annotationDocument.textItems.find((entry) => entry.id === target.id);
			if (!item) {
				continue;
			}
			item.autoFit = autoFit;
			item.manualBoxSize = !autoFit;
			if (autoFit) {
				this.updateAutoFitTextAnnotation(item, target.page);
			}
		}
		this.markDirtyAndRedraw(autoFit ? "Text box will resize to fit" : "Text box size fixed");
	}

	private setTextFontFamily(fontFamily: string): void {
		this.currentTextFontFamily = fontFamily;
		this.updateInlineTextEditorStyle();
		if (this.shouldApplyTextStyleToSelection()) {
			this.applyFontFamilyToSelection(fontFamily);
		}
		this.refreshToolbar();
	}

	private setTextFontSize(fontSize: number): void {
		this.currentTextFontSize = fontSize;
		this.updateInlineTextEditorStyle();
		if (this.shouldApplyTextStyleToSelection()) {
			this.applyTextSizeToSelection(fontSize);
		}
		this.refreshToolbar();
	}

	private setTextFontWeight(fontWeight: TextFontWeight): void {
		this.currentTextFontWeight = fontWeight;
		this.updateInlineTextEditorStyle();
		if (this.shouldApplyTextStyleToSelection()) {
			this.applyTextFormattingToSelection({ fontWeight }, "Text weight updated");
		}
		this.refreshToolbar();
	}

	private setTextFontStyle(fontStyle: TextFontStyle): void {
		this.currentTextFontStyle = fontStyle;
		this.updateInlineTextEditorStyle();
		if (this.shouldApplyTextStyleToSelection()) {
			this.applyTextFormattingToSelection({ fontStyle }, "Text style updated");
		}
		this.refreshToolbar();
	}

	private setTextAlignment(textAlign: TextAlignment): void {
		this.currentTextAlignment = textAlign;
		this.updateInlineTextEditorStyle();
		if (this.shouldApplyTextStyleToSelection()) {
			this.applyTextFormattingToSelection({ textAlign }, "Text alignment updated");
		}
		this.refreshToolbar();
	}

	private setTextVerticalAlignment(verticalAlign: TextVerticalAlignment): void {
		this.currentTextVerticalAlignment = verticalAlign;
		this.updateInlineTextEditorStyle();
		if (this.shouldApplyTextStyleToSelection()) {
			this.applyTextFormattingToSelection({ verticalAlign }, "Text vertical alignment updated");
		}
		this.refreshToolbar();
	}

	private setTextLineSpacing(lineSpacing: number): void {
		this.currentTextLineSpacing = clamp(
			Number.isFinite(lineSpacing) ? lineSpacing : INLINE_TEXT_LINE_HEIGHT,
			0.8,
			3
		);
		this.updateInlineTextEditorStyle();
		if (this.shouldApplyTextStyleToSelection()) {
			this.applyTextFormattingToSelection(
				{ lineSpacing: this.currentTextLineSpacing },
				"Text line spacing updated"
			);
		}
		this.refreshToolbar();
	}

	private setTextWordWrap(wordWrap: boolean): void {
		this.currentTextWordWrap = wordWrap;
		if (this.inlineTextEditorEl) {
			this.inlineTextEditorEl.wrap = wordWrap ? "soft" : "off";
		}
		this.updateInlineTextEditorStyle();
		if (this.shouldApplyTextStyleToSelection()) {
			this.applyTextFormattingToSelection({ wordWrap }, wordWrap ? "Text wrapping enabled" : "Text wrapping disabled");
		}
		this.refreshToolbar();
	}

	private setTextAutoFit(autoFit: boolean): void {
		if (this.inlineTextEditorFrameEl && this.inlineTextEditorEl) {
			this.inlineTextAutoFit = autoFit;
			this.inlineTextEditorFrameEl.classList.toggle("is-auto-fit", autoFit);
			if (this.inlineTextPageNumber !== null) {
				this.updateInlineTextEditorBoxFromContent(this.inlineTextPageNumber);
				this.drawPageAnnotations(this.inlineTextPageNumber);
			}
		}
		if (this.shouldApplyTextStyleToSelection()) {
			this.applyTextAutoFitToSelection(autoFit);
		}
		this.refreshToolbar();
	}

	private transformTextCase(mode: "sentence" | "lower" | "upper" | "title" | "toggle"): void {
		const transform = (value: string): string => {
			if (mode === "lower") {
				return value.toLocaleLowerCase();
			}
			if (mode === "upper") {
				return value.toLocaleUpperCase();
			}
			if (mode === "title") {
				return value.toLocaleLowerCase().replace(/(^|[\s\-/])([a-z])/g, (_match, prefix: string, letter: string) => (
					`${prefix}${letter.toLocaleUpperCase()}`
				));
			}
			if (mode === "sentence") {
				return value.toLocaleLowerCase().replace(/(^|[.!?]\s+)([a-z])/g, (_match, prefix: string, letter: string) => (
					`${prefix}${letter.toLocaleUpperCase()}`
				));
			}
			return Array.from(value).map((character) => {
				const upper = character.toLocaleUpperCase();
				const lower = character.toLocaleLowerCase();
				return character === upper && character !== lower ? lower : upper;
			}).join("");
		};
		if (this.inlineTextEditorEl) {
			const start = this.inlineTextEditorEl.selectionStart;
			const end = this.inlineTextEditorEl.selectionEnd;
			this.inlineTextEditorEl.value = transform(this.inlineTextEditorEl.value);
			this.inlineTextEditorEl.setSelectionRange(start, end);
			if (this.inlineTextPageNumber !== null) {
				this.updateInlineTextEditorBoxFromContent(this.inlineTextPageNumber);
				this.drawPageAnnotations(this.inlineTextPageNumber);
			}
			this.updateInlineTextCaretMirror();
			return;
		}
		if (!this.annotationDocument || !this.hasSelectedText()) {
			this.refreshStatus("Select or edit text before changing case");
			return;
		}
		this.pushHistory();
		for (const target of this.selectedTargets) {
			if (target.kind !== "text") {
				continue;
			}
			const item = this.annotationDocument.textItems.find((entry) => entry.id === target.id);
			if (item) {
				item.text = transform(item.text);
				this.updateAutoFitTextAnnotation(item, target.page);
			}
		}
		this.markDirtyAndRedraw("Text case updated");
	}

	private setTextColor(color: string, pushHistory = true, refreshToolbar = true): void {
		this.currentTextColor = color;
		this.plugin.updateTextColor(color);
		if (this.inlineTextEditorEl) {
			this.inlineTextEditorEl.dataset.textColor = color;
			this.inlineTextEditorEl.setCssStyles({ color: "transparent" });
			this.inlineTextEditorEl.setCssProps({ "--annotator-inline-text-color": color });
			if (this.inlineTextPageNumber !== null) {
				this.drawPageAnnotations(this.inlineTextPageNumber);
			}
		}
		if (this.shouldApplyTextStyleToSelection()) {
			this.applyTextColorToSelection(color, pushHistory);
		}
		if (refreshToolbar) {
			this.refreshToolbar();
		}
	}
	private updateInlineTextEditorStyle(): void {
		if (!this.inlineTextEditorEl) {
			return;
		}
		const surface = this.inlineTextPageNumber ? this.pageSurfaces.get(this.inlineTextPageNumber) : null;
		const displayFontSize = surface
			? getRenderedTextFontSize(this.getStableTextFontScale(this.currentTextFontSize), surface.lastWidth)
			: this.currentTextFontSize;
		this.inlineTextEditorEl.dataset.textColor = this.currentTextColor;
		this.inlineTextEditorEl.setCssProps({ "--annotator-inline-text-color": this.currentTextColor });
		this.inlineTextEditorEl.wrap = this.currentTextWordWrap ? "soft" : "off";
		this.inlineTextEditorEl.setCssStyles({
			color: "transparent",
			fontFamily: `"${this.currentTextFontFamily}", sans-serif`,
			fontSize: `${displayFontSize}px`,
			fontWeight: this.currentTextFontWeight,
			fontStyle: this.currentTextFontStyle,
			textAlign: this.currentTextAlignment,
			lineHeight: String(this.currentTextLineSpacing),
			whiteSpace: this.currentTextWordWrap ? "pre-wrap" : "pre",
			overflowWrap: this.currentTextWordWrap ? "break-word" : "normal"
		});
		this.inlineTextCaretMirrorEl?.setCssStyles({
			fontFamily: `"${this.currentTextFontFamily}", sans-serif`,
			fontSize: `${displayFontSize}px`,
			fontWeight: this.currentTextFontWeight,
			fontStyle: this.currentTextFontStyle,
			textAlign: this.currentTextAlignment,
			lineHeight: String(this.currentTextLineSpacing),
			whiteSpace: this.currentTextWordWrap ? "pre-wrap" : "pre",
			overflowWrap: this.currentTextWordWrap ? "break-word" : "normal"
		});
		if (this.inlineTextEditorFrameEl?.classList.contains("is-editing-selected")) {
			this.inlineTextEditorEl.setCssStyles({ height: "100%" });
		} else {
			resizeInlineTextEditor(this.inlineTextEditorEl, (surface?.lastHeight ?? 600) * 0.42);
		}
		if (this.inlineTextPageNumber !== null) {
			this.updateInlineTextEditorBoxFromContent(this.inlineTextPageNumber);
			this.drawPageAnnotations(this.inlineTextPageNumber);
			this.updateInlineTextCaretMirror();
		}
	}

	private updateInlineTextCaretMirror(): void {
		const editor = this.inlineTextEditorEl;
		const mirror = this.inlineTextCaretMirrorEl;
		if (!editor || !mirror) {
			return;
		}
		const selectionStart = editor.selectionStart ?? editor.value.length;
		const selectionEnd = editor.selectionEnd ?? selectionStart;
		const caret = createSpan({ cls: "pdf-native-annotator-inline-text-caret" });
		caret.classList.toggle("is-hidden", selectionStart !== selectionEnd);
		mirror.replaceChildren(
			document.createTextNode(editor.value.slice(0, selectionStart)),
			caret,
			document.createTextNode(editor.value.slice(selectionEnd))
		);
	}

	private applyPreset(presetId: string): void {
		if (!this.toolState.applyPreset(presetId)) {
			return;
		}
		if (!this.annotationMode) {
			this.annotationMode = true;
			this.refreshStatus("Annotation mode enabled");
		}
		if (this.shouldApplyStyleToSelection()) {
			this.applyColorToSelection(this.currentColor);
			this.applyWidthToSelection(this.getActiveWidth());
		}
		this.persistToolDefaults();
		this.applyOverlayMode();
		this.refreshToolbar();
		this.refreshStatus(`Preset: ${this.toolState.allPresets.find((preset) => preset.id === presetId)?.label ?? "Custom"}`);
	}

	private setSelectionMode(mode: SelectionMode): void {
		this.toolState.setSelectionMode(mode);
		this.persistToolDefaults();
		if (mode !== "lasso") {
			this.currentLasso = null;
		}
		this.drawAllAnnotations();
		this.refreshToolbar();
	}

	private persistToolDefaults(): void {
		this.plugin.updateToolPreferences(this.toolState.snapshot, this.toolState.presetsSnapshot);
	}

	private getAppendedPages(): NotebookPage[] {
		if (!this.annotationDocument) {
			return [];
		}
		if (!Array.isArray(this.annotationDocument.appendedPages)) {
			this.annotationDocument.appendedPages = [];
		}
		return this.annotationDocument.appendedPages;
	}

	private getTemporarySidecarPageCount(): number {
		return this.annotationDocument?.appendedPages?.length ?? 0;
	}

	private getRemovedPages() {
		if (!this.annotationDocument) {
			return [];
		}
		if (!Array.isArray(this.annotationDocument.removedPages)) {
			this.annotationDocument.removedPages = [];
		}
		return this.annotationDocument.removedPages;
	}

	private isPdfPageDeleted(pageNumber: number, document = this.annotationDocument): boolean {
		return !!document && (
			!!document.deletedPdfPages?.includes(pageNumber) ||
			!!document.permanentlyDeletedPdfPages?.includes(pageNumber)
		);
	}

	private getSyntheticPageIndex(pageNumber = this.currentPage): number {
		return pageNumber > this.realPdfPageCount ? pageNumber - this.realPdfPageCount - 1 : -1;
	}

	private getCurrentSyntheticPage(): NotebookPage | null {
		const index = this.getSyntheticPageIndex();
		return index >= 0 ? this.getAppendedPages()[index] ?? null : null;
	}

	private getSyntheticPageById(pageId: string): { page: NotebookPage; index: number; pageNumber: number } | null {
		const pages = this.getAppendedPages();
		const index = pages.findIndex((page) => page.id === pageId);
		if (index < 0) {
			return null;
		}
		return {
			page: pages[index],
			index,
			pageNumber: this.realPdfPageCount + index + 1
		};
	}

	private getSyntheticPageInsertAfterPdfPage(page: NotebookPage): number {
		const rawAnchor = typeof page.insertAfterPdfPage === "number" ? page.insertAfterPdfPage : this.realPdfPageCount;
		return clamp(Math.round(rawAnchor), 0, Math.max(0, this.realPdfPageCount));
	}

	private findSyntheticInsertIndexAfterPdfPage(pdfPageNumber: number): number {
		const anchor = clamp(Math.round(pdfPageNumber), 0, Math.max(0, this.realPdfPageCount));
		const pages = this.getAppendedPages();
		let lastMatchingIndex = -1;
		for (let index = 0; index < pages.length; index += 1) {
			const pageAnchor = this.getSyntheticPageInsertAfterPdfPage(pages[index]);
			if (pageAnchor === anchor) {
				lastMatchingIndex = index;
			}
			if (lastMatchingIndex < 0 && pageAnchor > anchor) {
				return index;
			}
		}
		return lastMatchingIndex >= 0 ? lastMatchingIndex + 1 : pages.length;
	}

	private findFirstSyntheticInsertIndexAfterPdfPage(pdfPageNumber: number): number {
		const anchor = clamp(Math.round(pdfPageNumber), 0, Math.max(0, this.realPdfPageCount));
		const pages = this.getAppendedPages();
		for (let index = 0; index < pages.length; index += 1) {
			const pageAnchor = this.getSyntheticPageInsertAfterPdfPage(pages[index]);
			if (pageAnchor >= anchor) {
				return index;
			}
		}
		return pages.length;
	}
	private getPageMenuAnchor(): HTMLElement | null {
		return this.toolbarEl?.querySelector<HTMLElement>(".pdf-native-annotator-page-menu-button")
			?? this.toolbarEl?.querySelector<HTMLElement>(".pdf-native-annotator-page-chip")
			?? this.toolbarEl;
	}

	private getMixedPageCount(): number {
		return Math.max(this.realPdfPageCount, 0) + this.getAppendedPages().length;
	}

	private getAnnotationCountForPage(pageNumber: number, document = this.annotationDocument): number {
		return this.getAnnotationBreakdownForPage(pageNumber, document).total;
	}

	private getAnnotationBreakdownForPage(pageNumber: number, document = this.annotationDocument): { strokes: number; text: number; shapes: number; images: number; total: number } {
		const strokes = document?.strokes.filter((stroke) => stroke.page === pageNumber).length ?? 0;
		const text = document?.textItems.filter((item) => item.page === pageNumber).length ?? 0;
		const shapes = document?.shapes.filter((shape) => shape.page === pageNumber).length ?? 0;
		const images = document?.imageItems?.filter((image) => image.page === pageNumber).length ?? 0;
		return {
			strokes,
			text,
			shapes,
			images,
			total: strokes + text + shapes + images
		};
	}
	private getMixedPageEntries(document = this.annotationDocument): MixedPageEntry[] {
		const entries: MixedPageEntry[] = [];
		const addedEntriesByAnchor = new Map<number, MixedPageEntry[]>();
		const appendedPages = document?.appendedPages ?? [];
		appendedPages.forEach((page, index) => {
			const pageNumber = this.realPdfPageCount + index + 1;
			const annotationCount = this.getAnnotationCountForPage(pageNumber, document);
			const insertAfter = this.getSyntheticPageInsertAfterPdfPage(page);
			const group = addedEntriesByAnchor.get(insertAfter) ?? [];
			group.push({
				pageNumber,
				label: page.title.trim() || `Added page ${index + 1}`,
				detail: `${getNotebookTemplateLabel(page.template)} - ${getNotebookPageSizeLabel(page.pageSize)} - ${page.title.trim() || `Added page ${index + 1}`}`,
				isAdded: true,
				annotationCount,
				pageId: page.id,
				template: page.template,
				pageSize: page.pageSize,
				paperColor: page.paperColor
			});
			addedEntriesByAnchor.set(insertAfter, group);
		});
		entries.push(...(addedEntriesByAnchor.get(0) ?? []));
		for (let pageNumber = 1; pageNumber <= this.realPdfPageCount; pageNumber += 1) {
			if (this.isPdfPageDeleted(pageNumber, document)) {
				entries.push(...(addedEntriesByAnchor.get(pageNumber) ?? []));
				continue;
			}
			const annotationCount = this.getAnnotationCountForPage(pageNumber, document);
			const pageTemplate = document && hasEditableNativePageTemplates(document, this.realPdfPageCount)
				? (document.pdfPageTemplates ?? []).find((template) => template.page === pageNumber) ?? null
				: null;
			entries.push({
				pageNumber,
				label: `Page ${pageNumber}`,
				detail: pageTemplate
					? `${getNotebookTemplateLabel(pageTemplate.template)} - ${getNotebookPageSizeLabel(pageTemplate.pageSize)} - Plugin-created PDF page ${pageNumber}`
					: `PDF page - Page ${pageNumber}`,
				isAdded: false,
				annotationCount,
				template: pageTemplate?.template,
				pageSize: pageTemplate?.pageSize,
				paperColor: pageTemplate?.paperColor
			});
			entries.push(...(addedEntriesByAnchor.get(pageNumber) ?? []));
		}
		return entries;
	}

	private getRemovedPageEntries(document = this.annotationDocument): MixedPageEntry[] {
		if (!document) {
			return [];
		}
		const permanentPdfPages = new Set(document.permanentlyDeletedPdfPages ?? []);
		const hiddenPdfEntries = (document.deletedPdfPages ?? [])
			.filter((pageNumber) => pageNumber >= 1 && pageNumber <= this.realPdfPageCount)
			.filter((pageNumber) => !permanentPdfPages.has(pageNumber))
			.map((pageNumber): MixedPageEntry => ({
				pageNumber,
				label: `Page ${pageNumber}`,
				detail: `Removed PDF page - annotations preserved`,
				isAdded: false,
				annotationCount: this.getAnnotationCountForPage(pageNumber, document),
				isRemoved: true,
				removedKind: "pdf"
			}));
		const removedAddedEntries = (document.removedPages ?? []).map((entry): MixedPageEntry => ({
			pageNumber: 0,
			label: entry.page.title.trim() || "Removed added page",
			detail: `${getNotebookTemplateLabel(entry.page.template)} - ${getNotebookPageSizeLabel(entry.page.pageSize)} - removed`,
			isAdded: true,
			annotationCount:
				entry.annotations.strokes.length +
				entry.annotations.textItems.length +
				entry.annotations.shapes.length +
				entry.annotations.imageItems.length,
			pageId: entry.page.id,
			template: entry.page.template,
			pageSize: entry.page.pageSize,
			paperColor: entry.page.paperColor,
			isRemoved: true,
			removedKind: "added"
		}));
		return [...hiddenPdfEntries, ...removedAddedEntries];
	}

	private canNavigateMixedPage(direction: -1 | 1): boolean {
		const entries = this.getMixedPageEntries();
		const index = entries.findIndex((entry) => entry.pageNumber === this.currentPage);
		const nextIndex = index + direction;
		return index >= 0 && nextIndex >= 0 && nextIndex < entries.length;
	}

	private navigateMixedPage(direction: -1 | 1): void {
		const entries = this.getMixedPageEntries();
		if (entries.length === 0) {
			return;
		}
		const index = entries.findIndex((entry) => entry.pageNumber === this.currentPage);
		const nextEntry = entries[clamp((index >= 0 ? index : 0) + direction, 0, entries.length - 1)];
		if (!nextEntry || nextEntry.pageNumber === this.currentPage) {
			return;
		}
		this.goToMixedPage(nextEntry.pageNumber);
	}

	private goToMixedPage(pageNumber: number): void {
		const totalPages = this.getMixedPageCount();
		if (totalPages <= 0) {
			return;
		}
		const nextPage = clamp(Math.round(pageNumber), 1, totalPages);
		this.currentPage = nextPage;
		const surface = this.pageSurfaces.get(nextPage);
		if (surface) {
			this.scrollPageElementIntoView(surface.pageEl);
		} else {
			this.scheduleSyncPages();
		}
		this.refreshToolbar();
		this.refreshStatus(this.getCurrentSyntheticPage() ? `Added page ${nextPage}` : `PDF page ${nextPage}`);
	}

	private scrollPageElementIntoView(pageEl: HTMLElement): void {
		pageEl.scrollIntoView({
			block: "center",
			behavior: isTabletWebKitTouchDevice() ? "auto" : "smooth"
		});
	}

	hasCurrentAddedPage(): boolean {
		this.syncCurrentPageForPageAction();
		return !!this.getCurrentSyntheticPage();
	}

	addTemplatePageBeforeCurrent(): void {
		this.syncCurrentPageForPageAction();
		this.insertTemplatePageBeforeCurrent();
	}

	addTemplatePageAfterCurrent(): void {
		this.syncCurrentPageForPageAction();
		this.insertTemplatePageAfterCurrent();
	}

	addTemplatePageToEnd(): void {
		this.insertTemplatePageAtEnd();
	}

	duplicateCurrentAddedPage(includeAnnotations = true): void {
		this.syncCurrentPageForPageAction();
		this.duplicateCurrentTemplatePage(includeAnnotations);
	}

	clearCurrentAddedPageContents(): void {
		this.syncCurrentPageForPageAction();
		this.clearCurrentTemplatePageContents();
	}

	deleteCurrentAddedPage(): void {
		this.deleteCurrentTemplatePage();
	}

	deleteCurrentPage(syncFromViewer = true): void {
		if (syncFromViewer) {
			this.syncCurrentPageForPageAction();
		}
		if (this.getCurrentSyntheticPage()) {
			this.deleteCurrentTemplatePage();
			return;
		}
		this.deleteCurrentPdfPageFromSession();
	}

	canNavigatePage(direction: -1 | 1): boolean {
		this.syncCurrentPageForPageAction();
		return this.canNavigateMixedPage(direction);
	}

	goToPreviousPage(): void {
		this.navigateMixedPage(-1);
	}

	goToNextPage(): void {
		this.navigateMixedPage(1);
	}

	openMixedPageList(): void {
		this.syncCurrentPageForPageAction();
		const anchor = this.getPageMenuAnchor();
		if (!anchor) {
			new Notice("The PDF toolbar is not ready yet.");
			return;
		}
		this.openPageListPopover(anchor);
	}

	openGoToPage(): void {
		this.syncCurrentPageForPageAction();
		const anchor = this.getPageMenuAnchor();
		if (!anchor) {
			new Notice("The PDF toolbar is not ready yet.");
			return;
		}
		this.openGoToPagePopover(anchor);
	}

	private renumberTemplatePageTitles(): void {
		this.getAppendedPages().forEach((page, index) => {
			if (/^Page \d+( copy)?$/.test(page.title)) {
				page.title = `Page ${this.realPdfPageCount + index + 1}`;
			}
		});
	}

	private refreshSyntheticPages(targetPageNumber?: number): void {
		this.finishSessionInlineTextEditor(true);
		this.renumberTemplatePageTitles();
		this.syncPages();
		if (targetPageNumber) {
			this.currentPage = targetPageNumber;
			const surface = this.pageSurfaces.get(targetPageNumber);
			if (surface) {
				surface.overlayEl.setCssStyles({ visibility: "visible" });
				this.scrollPageElementIntoView(surface.pageEl);
				this.resizeOverlay(surface);
				this.applyOverlayMode();
				this.drawPageAnnotations(targetPageNumber);
			}
		}
		this.refreshToolbar();
	}

	private insertTemplatePageAtIndex(insertIndex: number, insertAfterPdfPage?: number | null, options?: NativeInsertPageOptions): void {
		if (!this.annotationDocument) {
			return;
		}
		this.finishSessionInlineTextEditor(true);
		const pages = this.getAppendedPages();
		const boundedInsertIndex = clamp(insertIndex, 0, pages.length);
		const anchor = insertAfterPdfPage === undefined
			? this.realPdfPageCount
			: clamp(Math.round(insertAfterPdfPage ?? this.realPdfPageCount), 0, Math.max(0, this.realPdfPageCount));
		const pageOptions = options ?? {
			title: `Page ${this.realPdfPageCount + pages.length + 1}`,
			template: this.getCurrentSyntheticPage()?.template ?? "ruled",
			pageSize: this.getCurrentSyntheticPage()?.pageSize ?? "a4",
			paperColor: this.getCurrentSyntheticPage()?.paperColor ?? "#fffdf7"
		};
		const nextPage = createTemplateNotebookPage(
			pageOptions.title.trim() || `Page ${this.realPdfPageCount + pages.length + 1}`,
			pageOptions.template,
			pageOptions.pageSize,
			pageOptions.paperColor
		);
		nextPage.insertAfterPdfPage = anchor;
		this.pushHistory();
		const insertedPageNumber = insertSyntheticPage(
			this.annotationDocument,
			this.realPdfPageCount,
			boundedInsertIndex,
			nextPage
		);
		this.selectedTargets = this.selectedTargets.map((target) => target.page >= insertedPageNumber ? { ...target, page: target.page + 1 } : target);
		this.currentPage = insertedPageNumber;
		this.annotationMode = true;
		this.markDirtyAndRedraw("Added template page to PDF");
		this.refreshSyntheticPages(insertedPageNumber);
	}

	private insertTemplatePageAtLocation(location: NativeInsertPageLocation, options?: NativeInsertPageOptions): void {
		const insertIndex = clamp(location.insertIndex, 0, this.getAppendedPages().length);
		this.insertTemplatePageAtIndex(insertIndex, location.anchor, options);
	}

	private insertTemplatePageAfterCurrent(): void {
		const currentSyntheticIndex = this.getSyntheticPageIndex();
		if (currentSyntheticIndex >= 0) {
			const currentSyntheticPage = this.getAppendedPages()[currentSyntheticIndex];
			this.insertTemplatePageAtIndex(currentSyntheticIndex + 1, this.getSyntheticPageInsertAfterPdfPage(currentSyntheticPage));
			return;
		}
		const anchor = clamp(this.currentPage, 0, Math.max(0, this.realPdfPageCount));
		this.insertTemplatePageAtIndex(this.findSyntheticInsertIndexAfterPdfPage(anchor), anchor);
	}
	private openTemplatePageInsertModalAfterPageId(pageId: string): void {
		const target = this.getSyntheticPageById(pageId);
		if (!target) {
			new Notice("That added page is no longer available.");
			return;
		}
		this.closePageListPopover();
		this.openTemplatePageInsertModalAtLocation("after", {
			insertIndex: target.index + 1,
			anchor: this.getSyntheticPageInsertAfterPdfPage(target.page),
			anchorLabel: target.page.title.trim() || `added page ${target.pageNumber}`
		}, {
			title: `Inserted page after ${target.page.title.trim() || `added page ${target.pageNumber}`}`,
			template: target.page.template,
			pageSize: target.page.pageSize,
			paperColor: target.page.paperColor
		});
	}
	private openTemplatePageInsertModalAfterPdfPage(pdfPageNumber: number): void {
		const anchor = clamp(Math.round(pdfPageNumber), 0, Math.max(0, this.realPdfPageCount));
		this.closePageListPopover();
		this.openTemplatePageInsertModalAtLocation("after", {
			insertIndex: this.findFirstSyntheticInsertIndexAfterPdfPage(anchor),
			anchor,
			anchorLabel: `PDF page ${anchor}`
		});
	}

	private insertTemplatePageBeforeCurrent(): void {
		const currentSyntheticIndex = this.getSyntheticPageIndex();
		if (currentSyntheticIndex < 0) {
			const anchor = clamp(this.currentPage - 1, 0, Math.max(0, this.realPdfPageCount));
			this.insertTemplatePageAtIndex(this.findSyntheticInsertIndexAfterPdfPage(anchor), anchor);
			return;
		}
		const currentSyntheticPage = this.getAppendedPages()[currentSyntheticIndex];
		this.insertTemplatePageAtIndex(currentSyntheticIndex, this.getSyntheticPageInsertAfterPdfPage(currentSyntheticPage));
	}

	private insertTemplatePageAtEnd(): void {
		this.insertTemplatePageAtIndex(this.getAppendedPages().length, this.realPdfPageCount);
	}
	private deleteCurrentTemplatePage(): void {
		if (!this.annotationDocument) {
			return;
		}
		this.finishSessionInlineTextEditor(false);
		const pageIndex = this.getSyntheticPageIndex();
		const pages = this.getAppendedPages();
		if (pageIndex < 0 || pageIndex >= pages.length) {
			new Notice("Only added template pages can be deleted here.");
			return;
		}
		const pageNumber = this.realPdfPageCount + pageIndex + 1;
		const title = pages[pageIndex].title;
		this.requestDangerConfirmation(
			"Remove added page?",
			`${title} and its annotations will move to Removed pages, where they can be restored or deleted permanently.`,
			"Move to Removed",
			() => {
				if (!this.annotationDocument) {
					return;
				}
				this.pushHistory();
				const removedPage = removeSyntheticPageToTrash(
					this.annotationDocument,
					this.realPdfPageCount,
					pageIndex
				);
				if (!removedPage) {
					return;
				}
				this.selectedTargets = [];
				this.selectedTarget = null;
				this.currentPage = Math.max(1, Math.min(pageNumber, this.realPdfPageCount + pages.length));
				this.markDirtyAndRedraw("Moved added page to Removed");
				this.refreshSyntheticPages(this.currentPage);
			}
		);
	}

	private deleteCurrentPdfPageFromSession(): void {
		if (!this.annotationDocument || this.currentPage < 1 || this.currentPage > this.realPdfPageCount) {
			new Notice("Open a PDF page first.");
			return;
		}
		const pageNumber = this.currentPage;
		if (this.isPdfPageDeleted(pageNumber)) {
			new Notice(`PDF page ${pageNumber} is already hidden from this session.`);
			return;
		}
		this.finishSessionInlineTextEditor(false);
		this.pushHistory();
		if (!hidePdfPage(this.annotationDocument, pageNumber)) {
			return;
		}
		this.selectedTargets = [];
		this.selectedTarget = null;
		const entries = this.getMixedPageEntries();
		const nextEntry = entries.find((entry) => entry.pageNumber > pageNumber) ?? entries[entries.length - 1];
		this.currentPage = nextEntry?.pageNumber ?? 1;
		this.markDirtyAndRedraw(`Moved PDF page ${pageNumber} to Removed`);
		this.syncPages();
		this.goToMixedPage(this.currentPage);
	}

	private deleteAddedPageById(pageId: string): void {
		const target = this.getSyntheticPageById(pageId);
		if (!target) {
			new Notice("That added page is no longer available.");
			return;
		}
		this.closePageListPopover();
		this.currentPage = target.pageNumber;
		this.deleteCurrentTemplatePage();
	}

	private restoreRemovedAddedPageById(pageId: string): void {
		if (!this.annotationDocument) {
			return;
		}
		this.closePageListPopover();
		this.pushHistory();
		const restoredPageNumber = restoreSyntheticPageFromTrash(
			this.annotationDocument,
			this.realPdfPageCount,
			pageId
		);
		if (restoredPageNumber === null) {
			new Notice("That removed page is no longer available.");
			return;
		}
		this.selectedTargets = [];
		this.selectedTarget = null;
		this.currentPage = restoredPageNumber;
		this.markDirtyAndRedraw("Restored added page");
		this.refreshSyntheticPages(restoredPageNumber);
	}

	private permanentlyDeleteRemovedAddedPageById(pageId: string): void {
		const removedPage = this.getRemovedPages().find((entry) => entry.page.id === pageId);
		if (!removedPage) {
			new Notice("That removed page is no longer available.");
			return;
		}
		this.closePageListPopover();
		this.requestDangerConfirmation(
			"Delete removed page permanently?",
			`${removedPage.page.title} and its stored annotations will be permanently deleted. This cannot be restored after the session is saved and reopened.`,
			"Delete permanently",
			() => {
				if (!this.annotationDocument) {
					return;
				}
				this.pushHistory();
				if (!permanentlyDeleteRemovedPage(this.annotationDocument, pageId)) {
					return;
				}
				this.markDirtyAndRedraw("Permanently deleted removed page");
				this.refreshToolbar();
			}
		);
	}

	private permanentlyDeleteRemovedPdfPageByNumber(pageNumber: number): void {
		if (!this.annotationDocument || pageNumber < 1 || pageNumber > this.realPdfPageCount) {
			new Notice("That removed PDF page is no longer available.");
			return;
		}
		if (!this.annotationDocument.deletedPdfPages?.includes(pageNumber)) {
			new Notice("That PDF page is not in Removed.");
			return;
		}
		this.closePageListPopover();
		this.requestDangerConfirmation(
			"Delete removed PDF page permanently?",
			`PDF page ${pageNumber} will be permanently omitted from this working session and future mixed exports. The original source PDF bytes are not rewritten.`,
			"Delete permanently",
			() => {
				if (!this.annotationDocument) {
					return;
				}
				this.pushHistory();
				if (!permanentlyDeleteHiddenPdfPage(this.annotationDocument, pageNumber)) {
					return;
				}
				this.selectedTargets = [];
				this.selectedTarget = null;
				this.markDirtyAndRedraw(`Permanently deleted PDF page ${pageNumber}`);
				this.syncPages();
				this.refreshToolbar();
			}
		);
	}

	private restorePdfPageToSession(pageNumber: number): void {
		if (!this.annotationDocument || pageNumber < 1 || pageNumber > this.realPdfPageCount) {
			return;
		}
		this.closePageListPopover();
		this.pushHistory();
		if (!restorePdfPage(this.annotationDocument, pageNumber)) {
			return;
		}
		this.currentPage = pageNumber;
		this.markDirtyAndRedraw(`Restored PDF page ${pageNumber}`);
		this.syncPages();
		this.goToMixedPage(pageNumber);
	}

	private duplicateCurrentTemplatePage(includeAnnotations = true): void {
		if (!this.annotationDocument) {
			return;
		}
		this.finishSessionInlineTextEditor(true);
		const pageIndex = this.getSyntheticPageIndex();
		const pages = this.getAppendedPages();
		if (pageIndex < 0 || pageIndex >= pages.length) {
			new Notice("Only added template pages can be duplicated here.");
			return;
		}
		const sourcePage = pages[pageIndex];
		const insertIndex = pageIndex + 1;
		const sourcePageNumber = this.realPdfPageCount + pageIndex + 1;
		const sourceStrokes = this.annotationDocument.strokes.filter((stroke) => stroke.page === sourcePageNumber);
		const sourceEraserPaths = (this.annotationDocument.eraserPaths ?? []).filter((eraserPath) => eraserPath.page === sourcePageNumber);
		const sourceTextItems = this.annotationDocument.textItems.filter((item) => item.page === sourcePageNumber);
		const sourceShapes = this.annotationDocument.shapes.filter((shape) => shape.page === sourcePageNumber);
		const sourceImages = (this.annotationDocument.imageItems ?? []).filter((image) => image.page === sourcePageNumber);
		this.pushHistory();
		const nextPage: NotebookPage = {
			...sourcePage,
			id: generateId("page"),
			title: `${sourcePage.title} copy`,
			strokes: [],
			textItems: [],
			shapes: [],
			imageItems: []
		};
		const insertedPageNumber = insertSyntheticPage(
			this.annotationDocument,
			this.realPdfPageCount,
			insertIndex,
			nextPage
		);
		if (includeAnnotations) {
			const clonedAnnotations = cloneAnnotationsForPage(sourceStrokes, sourceTextItems, sourceShapes, insertedPageNumber);
			this.annotationDocument.strokes.push(...clonedAnnotations.strokes);
			(this.annotationDocument.eraserPaths ??= []).push(...sourceEraserPaths.map((eraserPath) => ({
				...JSON.parse(JSON.stringify(eraserPath)) as EraserPathAnnotation,
				id: generateId("erase"),
				page: insertedPageNumber
			})));
			this.annotationDocument.textItems.push(...clonedAnnotations.textItems);
			this.annotationDocument.shapes.push(...clonedAnnotations.shapes);
			if (!Array.isArray(this.annotationDocument.imageItems)) {
				this.annotationDocument.imageItems = [];
			}
			this.annotationDocument.imageItems.push(...sourceImages.map((image) => ({
				...JSON.parse(JSON.stringify(image)) as ImageAnnotation,
				id: generateId("image"),
				page: insertedPageNumber,
				zIndex: this.getNextPageZIndex(insertedPageNumber)
			})));
		}
		this.selectedTargets = [];
		this.selectedTarget = null;
		this.currentPage = insertedPageNumber;
		this.markDirtyAndRedraw(includeAnnotations ? "Duplicated added page" : "Duplicated page structure");
		this.refreshSyntheticPages(insertedPageNumber);
	}

	private duplicateAddedPageById(pageId: string, includeAnnotations = true): void {
		const target = this.getSyntheticPageById(pageId);
		if (!target) {
			new Notice("That added page is no longer available.");
			return;
		}
		this.closePageListPopover();
		this.currentPage = target.pageNumber;
		this.duplicateCurrentTemplatePage(includeAnnotations);
	}

	private clearCurrentTemplatePageContents(): void {
		if (!this.annotationDocument) {
			return;
		}
		this.finishSessionInlineTextEditor(false);
		const pageIndex = this.getSyntheticPageIndex();
		const pages = this.getAppendedPages();
		if (pageIndex < 0 || pageIndex >= pages.length) {
			new Notice("Only added template pages can be cleared here.");
			return;
		}
		const page = pages[pageIndex];
		const pageNumber = this.realPdfPageCount + pageIndex + 1;
		const hasContents =
			this.annotationDocument.strokes.some((stroke) => stroke.page === pageNumber) ||
			(this.annotationDocument.eraserPaths ?? []).some((eraserPath) => eraserPath.page === pageNumber) ||
			this.annotationDocument.textItems.some((item) => item.page === pageNumber) ||
			this.annotationDocument.shapes.some((shape) => shape.page === pageNumber) ||
			(this.annotationDocument.imageItems ?? []).some((image) => image.page === pageNumber);
		if (!hasContents) {
			return;
		}
		this.requestDangerConfirmation(
			"Clear added page?",
			`All annotations on ${page.title} will be removed, but the page itself will stay.`,
			"Clear page",
			() => {
				if (!this.annotationDocument) {
					return;
				}
				this.pushHistory();
				this.annotationDocument.strokes = this.annotationDocument.strokes.filter((stroke) => stroke.page !== pageNumber);
				this.annotationDocument.eraserPaths = (this.annotationDocument.eraserPaths ?? []).filter((eraserPath) => eraserPath.page !== pageNumber);
				this.annotationDocument.textItems = this.annotationDocument.textItems.filter((item) => item.page !== pageNumber);
				this.annotationDocument.shapes = this.annotationDocument.shapes.filter((shape) => shape.page !== pageNumber);
				this.annotationDocument.imageItems = (this.annotationDocument.imageItems ?? []).filter((image) => image.page !== pageNumber);
				this.selectedTargets = [];
				this.selectedTarget = null;
				this.markDirtyAndRedraw("Cleared added page");
				this.refreshSyntheticPages(pageNumber);
			}
		);
	}

	private clearAddedPageById(pageId: string): void {
		const target = this.getSyntheticPageById(pageId);
		if (!target) {
			new Notice("That added page is no longer available.");
			return;
		}
		this.closePageListPopover();
		this.currentPage = target.pageNumber;
		this.clearCurrentTemplatePageContents();
	}

	private setCurrentTemplatePageTemplate(template: NotebookTemplate): void {
		const page = this.getCurrentSyntheticPage();
		if (!page || page.template === template) {
			return;
		}
		this.pushHistory();
		page.template = template;
		this.markDirtyAndRedraw(`Template changed to ${template}`);
		this.refreshSyntheticPages(this.currentPage);
	}

	private setCurrentTemplatePageSize(pageSize: NotebookPageSize): void {
		const page = this.getCurrentSyntheticPage();
		if (!page || page.pageSize === pageSize) {
			return;
		}
		this.pushHistory();
		page.pageSize = pageSize;
		this.markDirtyAndRedraw(`Page size changed to ${pageSize}`);
		this.refreshSyntheticPages(this.currentPage);
	}
	private setAddedPageTemplateById(pageId: string, template: NotebookTemplate): void {
		const target = this.getSyntheticPageById(pageId);
		if (!target) {
			new Notice("That added page is no longer available.");
			return;
		}
		if (target.page.template === template) {
			return;
		}
		this.pushHistory();
		target.page.template = template;
		this.markDirtyAndRedraw(`Template changed to ${getNotebookTemplateLabel(template)}`);
		this.refreshSyntheticPages(target.pageNumber);
	}

	private setAddedPageSizeById(pageId: string, pageSize: NotebookPageSize): void {
		const target = this.getSyntheticPageById(pageId);
		if (!target) {
			new Notice("That added page is no longer available.");
			return;
		}
		if (target.page.pageSize === pageSize) {
			return;
		}
		this.pushHistory();
		target.page.pageSize = pageSize;
		this.markDirtyAndRedraw(`Page size changed to ${getNotebookPageSizeLabel(pageSize)}`);
		this.refreshSyntheticPages(target.pageNumber);
	}

	private setAddedPagePaperColorById(pageId: string, color: string): void {
		const target = this.getSyntheticPageById(pageId);
		if (!target) {
			new Notice("That added page is no longer available.");
			return;
		}
		if (target.page.paperColor.toLowerCase() === color.toLowerCase()) {
			return;
		}
		this.pushHistory();
		target.page.paperColor = color;
		this.markDirtyAndRedraw("Paper color changed");
		this.refreshSyntheticPages(target.pageNumber);
	}
	private openGoToPagePopover(anchor: HTMLElement): void {
		const entries = this.getMixedPageEntries();
		const totalPages = entries.length;
		if (totalPages <= 0) {
			return;
		}
		this.beginExclusiveMenu();
		const popover = createDiv();
		popover.className = "modal pdf-native-annotator-rename-popover pdf-native-annotator-goto-popover";
		const title = popover.createDiv({ cls: "pdf-native-annotator-color-popover-title", text: "Go to page" });
		title.appendChild(this.createPopoverCloseButton(() => this.closeGoToPagePopover()));
		const form = popover.createEl("form", { cls: "pdf-native-annotator-rename-form" });
		const input = form.createEl("input", {
			type: "number",
			placeholder: `1-${totalPages}`
		});
		input.className = "pdf-native-annotator-rename-input";
		input.min = "1";
		input.max = String(totalPages);
		input.step = "1";
		input.value = String(this.getCurrentMixedPageOrdinal());
		form.createDiv({ cls: "pdf-native-annotator-popover-hint", text: `${totalPages} pages including added template pages` });
		const actions = form.createDiv({ cls: "pdf-native-annotator-confirm-actions" });
		const cancelButton = actions.createEl("button", { type: "button", text: "Cancel" });
		const goButton = actions.createEl("button", { type: "submit", text: "Go", cls: "mod-cta" });
		const commit = (): void => {
			const requestedPage = Number(input.value);
			if (!Number.isFinite(requestedPage) || requestedPage < 1 || requestedPage > totalPages) {
				new Notice(`Enter a page from 1 to ${totalPages}.`);
				return;
			}
			this.closeGoToPagePopover();
			this.goToMixedPage(entries[requestedPage - 1].pageNumber);
		};
		cancelButton.addEventListener("click", () => this.closeGoToPagePopover());
		goButton.addEventListener("pointerdown", (event) => {
			event.preventDefault();
			event.stopPropagation();
			commit();
		});
		input.addEventListener("keydown", (event) => {
			if (event.key === "Enter") {
				event.preventDefault();
				commit();
			}
			if (event.key === "Escape") {
				event.preventDefault();
				this.closeGoToPagePopover();
			}
			event.stopPropagation();
		});
		form.addEventListener("submit", (event) => {
			event.preventDefault();
			commit();
		});
		this.transientPopovers.open("go-to-page", popover);
		this.positionPopoverNearAnchor(popover, anchor);
		window.setTimeout(() => {
			input.focus();
			input.select();
		}, 0);
	}

	private openMixedPageEntryMenu(entry: MixedPageEntry, event: MouseEvent, anchor: HTMLElement): void {
		const openOrRestore = (): void => {
			if (entry.isRemoved) {
				if (entry.removedKind === "pdf") {
					this.restorePdfPageToSession(entry.pageNumber);
				} else if (entry.pageId) {
					this.restoreRemovedAddedPageById(entry.pageId);
				}
				return;
			}
			this.closePageListPopover();
			this.goToMixedPage(entry.pageNumber);
		};
		const menu = new Menu();
		if (entry.isRemoved) {
			menu.addItem((item) => item
				.setTitle("Restore page")
				.setIcon("rotate-ccw")
				.onClick(openOrRestore));
			if (entry.removedKind === "pdf") {
				menu.addSeparator();
				menu.addItem((item) => item
					.setTitle("Delete permanently")
					.setIcon("trash")
					.setWarning(true)
					.onClick(() => this.permanentlyDeleteRemovedPdfPageByNumber(entry.pageNumber)));
			} else if (entry.removedKind === "added" && entry.pageId) {
				menu.addSeparator();
				menu.addItem((item) => item
					.setTitle("Delete permanently")
					.setIcon("trash")
					.onClick(() => this.permanentlyDeleteRemovedAddedPageById(entry.pageId!)));
			}
			this.showExclusiveMenuAtMouseEvent(menu, event);
			return;
		}
		menu.addItem((item) => item
			.setTitle("Open page")
			.setIcon("arrow-right")
			.onClick(openOrRestore));
		menu.addItem((item) => item
			.setTitle("Copy page link")
			.setIcon("link")
			.onClick(() => void this.copyPageLink(entry.pageNumber)));
		menu.addItem((item) => item
			.setTitle("Export page snapshot")
			.setIcon("image-file")
			.onClick(() => void this.exportPageSnapshot(entry.pageNumber)));
		menu.addSeparator();
		if (entry.pageId) {
			menu.addItem((item) => item
				.setTitle("Add template page after")
				.setIcon("plus")
				.onClick(() => this.openTemplatePageInsertModalAfterPageId(entry.pageId!)));
			menu.addItem((item) => item
				.setTitle("Rename added page...")
				.setIcon("pencil")
				.onClick(() => this.openRenameAddedPagePopover(anchor, entry.pageId!)));
			menu.addItem((item) => item
				.setTitle("Duplicate added page")
				.setIcon("copy")
				.onClick(() => this.duplicateAddedPageById(entry.pageId!)));
			menu.addSeparator();
			menu.addItem((item) => item
				.setTitle("Page template...")
				.setIcon("rows-3")
				.onClick((menuEvent) => this.openAddedPageTemplateMenu(entry.pageId!, menuEvent, anchor)));
			menu.addItem((item) => item
				.setTitle("Page size...")
				.setIcon("maximize-2")
				.onClick((menuEvent) => this.openAddedPageSizeMenu(entry.pageId!, menuEvent, anchor)));
			menu.addItem((item) => item
				.setTitle("Paper color...")
				.setIcon("palette")
				.onClick((menuEvent) => this.openAddedPagePaperColorMenu(entry.pageId!, menuEvent, anchor)));
			menu.addSeparator();
			menu.addItem((item) => item
				.setTitle("Clear added page")
				.setIcon("eraser")
				.onClick(() => this.clearAddedPageById(entry.pageId!)));
			menu.addItem((item) => item
				.setTitle("Move added page to Removed")
				.setIcon("trash")
				.onClick(() => this.deleteAddedPageById(entry.pageId!)));
		} else {
			menu.addItem((item) => item
				.setTitle("Add template page after this PDF page")
				.setIcon("plus")
				.onClick(() => this.openTemplatePageInsertModalAfterPdfPage(entry.pageNumber)));
			if (this.canEditPdfPageTemplate(entry.pageNumber)) {
				menu.addSeparator();
				menu.addItem((item) => item
					.setTitle("Page template...")
					.setIcon("rows-3")
					.onClick((menuEvent) => this.openPdfPageTemplateMenu(entry.pageNumber, menuEvent, anchor)));
				menu.addItem((item) => item
					.setTitle("Paper color...")
					.setIcon("palette")
					.onClick((menuEvent) => this.openPdfPagePaperColorMenu(entry.pageNumber, menuEvent, anchor)));
				menu.addSeparator();
			}
			menu.addItem((item) => item
				.setTitle("Remove PDF page from session")
				.setIcon("trash")
				.onClick(() => {
					this.closePageListPopover();
					this.currentPage = entry.pageNumber;
					this.deleteCurrentPage(false);
				}));
		}
		this.showExclusiveMenuAtMouseEvent(menu, event);
	}

	private openAddedPageTemplateMenu(pageId: string, event: MouseEvent | KeyboardEvent, anchor: HTMLElement): void {
		const target = this.getSyntheticPageById(pageId);
		if (!target) {
			new Notice("That added page is no longer available.");
			return;
		}
		const menu = new Menu();
		addMenuDescriptors(menu, NOTEBOOK_TEMPLATES.map((template) => ({
			title: getNotebookTemplateLabel(template),
			checked: target.page.template === template,
			run: () => this.setAddedPageTemplateById(pageId, template)
		})));
		this.showMenuAtMenuEvent(menu, event, anchor);
	}

	private openAddedPageSizeMenu(pageId: string, event: MouseEvent | KeyboardEvent, anchor: HTMLElement): void {
		const target = this.getSyntheticPageById(pageId);
		if (!target) {
			new Notice("That added page is no longer available.");
			return;
		}
		const menu = new Menu();
		addMenuDescriptors(menu, NOTEBOOK_PAGE_SIZES.map((pageSize) => ({
			title: getNotebookPageSizeLabel(pageSize),
			checked: target.page.pageSize === pageSize,
			run: () => this.setAddedPageSizeById(pageId, pageSize)
		})));
		this.showMenuAtMenuEvent(menu, event, anchor);
	}

	private openAddedPagePaperColorMenu(pageId: string, event: MouseEvent | KeyboardEvent, anchor: HTMLElement): void {
		const target = this.getSyntheticPageById(pageId);
		if (!target) {
			new Notice("That added page is no longer available.");
			return;
		}
		const menu = new Menu();
		addMenuDescriptors(menu, PAPER_COLOR_PRESETS.map((preset) => ({
			title: preset.label,
			icon: "palette",
			checked: target.page.paperColor.toLowerCase() === preset.color.toLowerCase(),
			run: () => this.setAddedPagePaperColorById(pageId, preset.color)
		})));
		this.showMenuAtMenuEvent(menu, event, anchor);
	}

	private openPdfPageTemplateMenu(pageNumber: number, event: MouseEvent | KeyboardEvent, anchor: HTMLElement): void {
		if (!this.canEditPdfPageTemplate(pageNumber)) {
			return;
		}
		const pageTemplate = this.getPdfPageTemplate(pageNumber);
		if (!pageTemplate) {
			return;
		}
		const menu = new Menu();
		addMenuDescriptors(menu, NOTEBOOK_TEMPLATES.map((template) => ({
			title: getNotebookTemplateLabel(template),
			checked: pageTemplate.template === template,
			run: () => this.setPdfPageTemplateByPage(pageNumber, template)
		})));
		this.showMenuAtMenuEvent(menu, event, anchor);
	}

	private openPdfPagePaperColorMenu(pageNumber: number, event: MouseEvent | KeyboardEvent, anchor: HTMLElement): void {
		if (!this.canEditPdfPageTemplate(pageNumber)) {
			return;
		}
		const pageTemplate = this.getPdfPageTemplate(pageNumber);
		if (!pageTemplate) {
			return;
		}
		const menu = new Menu();
		addMenuDescriptors(menu, PAPER_COLOR_PRESETS.map((preset) => ({
			title: preset.label,
			icon: "palette",
			checked: pageTemplate.paperColor.toLowerCase() === preset.color.toLowerCase(),
			run: () => this.setPdfPagePaperColorByPage(pageNumber, preset.color)
		})));
		this.showMenuAtMenuEvent(menu, event, anchor);
	}

	private showMenuAtMenuEvent(menu: Menu, event: MouseEvent | KeyboardEvent, anchor: HTMLElement): void {
		const anchorRect = anchor.getBoundingClientRect();
		const x = "clientX" in event && event.clientX > 0 ? event.clientX : anchorRect.right + 8;
		const y = "clientY" in event && event.clientY > 0 ? event.clientY : anchorRect.top;
		this.showExclusiveMenuAtPosition(menu, { x, y, overlap: true });
	}

	private closeActiveNativeMenu(): void {
		const menu = this.activeNativeMenu;
		this.activeNativeMenu = null;
		menu?.hide();
	}

	private beginExclusiveMenu(): void {
		this.closeActiveNativeMenu();
		this.closeTransientPopovers();
	}

	private trackActiveNativeMenu(menu: Menu): void {
		this.activeNativeMenu = menu;
		menu.onHide(() => {
			if (this.activeNativeMenu === menu) {
				this.activeNativeMenu = null;
			}
		});
	}

	private showExclusiveMenuAtPosition(menu: Menu, position: Parameters<Menu["showAtPosition"]>[0]): void {
		this.beginExclusiveMenu();
		this.trackActiveNativeMenu(menu);
		menu.showAtPosition(position);
	}

	private showExclusiveMenuAtMouseEvent(menu: Menu, event: MouseEvent): void {
		this.beginExclusiveMenu();
		this.trackActiveNativeMenu(menu);
		menu.showAtMouseEvent(event);
	}

	private openPageListPopover(anchor: HTMLElement): void {
		const entries = this.getMixedPageEntries();
		const removedEntries = this.getRemovedPageEntries();
		if (entries.length === 0 && removedEntries.length === 0) {
			return;
		}
		this.beginExclusiveMenu();
		const pageListDocument = anchor.ownerDocument;
		const popover = createDiv();
		popover.className = "modal pdf-native-annotator-page-list-popover";
		const title = popover.createDiv({ cls: "pdf-native-annotator-color-popover-title", text: "Manage pages" });
		title.appendChild(this.createPopoverCloseButton(() => this.closePageListPopover()));
		const countByFilter = {
			all: entries.length,
			annotated: entries.filter((entry) => entry.annotationCount > 0).length,
			added: entries.filter((entry) => entry.isAdded).length,
			removed: removedEntries.length
		};
		const overview = popover.createDiv({ cls: "pdf-native-annotator-page-list-overview" });
		overview.createSpan({
			text: `${countByFilter.all} pages - ${countByFilter.added} added - ${countByFilter.annotated} annotated`
		});
		const filters = popover.createDiv({ cls: "pdf-native-annotator-page-list-filters" });
		const searchWrap = popover.createDiv({ cls: "pdf-native-annotator-page-list-search" });
		const searchInput = searchWrap.createEl("input", {
			type: "search",
			placeholder: "Search pages"
		});
		searchInput.value = this.pageListQuery;
		const summary = popover.createDiv({ cls: "pdf-native-annotator-page-list-summary" });
		const list = popover.createDiv({ cls: "pdf-native-annotator-page-list" });
		let currentFilteredEntries: typeof entries = [];
		const renderList = (): void => {
			list.replaceChildren();
			const sourceEntries = this.pageListFilter === "removed" ? removedEntries : entries;
			const filteredEntries = sourceEntries.filter((entry) => {
				if (this.pageListFilter === "added") {
					return entry.isAdded;
				}
				return true;
			}).filter((entry) => {
				const query = this.pageListQuery.trim().toLowerCase();
				if (!query) {
					return true;
				}
				return String(entry.pageNumber).includes(query) ||
					entry.label.toLowerCase().includes(query) ||
					entry.detail.toLowerCase().includes(query);
			});
			currentFilteredEntries = filteredEntries;
			summary.textContent = filteredEntries.length === sourceEntries.length
				? `${sourceEntries.length} ${this.pageListFilter === "removed" ? "removed" : "pages"}`
				: `${filteredEntries.length} of ${sourceEntries.length} pages`;
			if (filteredEntries.length === 0) {
				list.createDiv({ cls: "pdf-native-annotator-page-list-empty", text: "No pages match this filter." });
				return;
			}
			for (const entry of filteredEntries) {
				const button = createDiv();
				button.className = "menu-item pdf-native-annotator-page-list-item";
				button.setAttribute("role", "button");
				button.setAttribute("aria-label", `${entry.label}. ${entry.detail}`);
				button.tabIndex = 0;
				if (entry.pageNumber === this.currentPage) {
					button.classList.add("is-active", "is-selected");
				}
				if (entry.isAdded) {
					button.classList.add("is-added");
				}
				if (entry.annotationCount > 0) {
					button.classList.add("has-annotations");
				}
				if (entry.isRemoved) {
					button.classList.add("is-removed");
				}
				const thumbnail = button.createSpan({ cls: "menu-item-icon pdf-native-annotator-page-list-thumbnail" });
				thumbnail.classList.add(entry.isAdded ? "is-added" : "is-pdf");
				if (entry.template) {
					thumbnail.classList.add(`is-template-${entry.template}`);
				}
				if (entry.paperColor) {
					thumbnail.setCssProps({ "--page-list-paper": entry.paperColor });
				}
				const sheet = thumbnail.createSpan({ cls: "pdf-native-annotator-page-list-thumbnail-sheet" });
				sheet.createSpan({ cls: "pdf-native-annotator-page-list-thumbnail-pattern" });
				if (!entry.isAdded) {
					sheet.createSpan({ cls: "pdf-native-annotator-page-list-thumbnail-pdf", text: "PDF" });
				}
				if (entry.annotationCount > 0) {
					thumbnail.createSpan({ cls: "pdf-native-annotator-page-list-thumbnail-count", text: String(entry.annotationCount) });
				}
				const number = button.createSpan({
					cls: "pdf-native-annotator-page-list-number",
					text: entry.isRemoved ? "Removed" : String(entry.pageNumber)
				});
				number.setAttribute("aria-hidden", "true");
				const text = button.createSpan({ cls: "menu-item-title pdf-native-annotator-page-list-text" });
				text.createSpan({ cls: "pdf-native-annotator-page-list-label", text: entry.label });
				text.createSpan({ cls: "pdf-native-annotator-page-list-detail", text: entry.detail });
				const jump = (): void => {
					if (entry.isRemoved) {
						if (entry.removedKind === "pdf") {
							this.restorePdfPageToSession(entry.pageNumber);
						} else if (entry.pageId) {
							this.restoreRemovedAddedPageById(entry.pageId);
						}
						return;
					}
					this.closePageListPopover();
					this.goToMixedPage(entry.pageNumber);
				};
				button.addEventListener("click", jump);
				button.addEventListener("keydown", (event) => {
					if (event.key === "Enter" || event.key === " ") {
						event.preventDefault();
						jump();
					}
					if (event.key === "ArrowDown" || event.key === "ArrowUp") {
						event.preventDefault();
						const rows = Array.from(list.querySelectorAll<HTMLElement>(".pdf-native-annotator-page-list-item"));
						const currentIndex = rows.indexOf(button);
						const offset = event.key === "ArrowDown" ? 1 : -1;
						const nextIndex = clamp(currentIndex + offset, 0, rows.length - 1);
						rows[nextIndex]?.focus();
					}
				});
				const actions = button.createSpan({ cls: "menu-item-flair pdf-native-annotator-page-list-actions" });
				actions.addEventListener("click", (event) => event.stopPropagation());
				actions.addEventListener("keydown", (event) => event.stopPropagation());
				const moreButton = this.createPageListActionButton("more-horizontal", `Actions for ${entry.label}`, (event) => {
					this.openMixedPageEntryMenu(entry, event, actions);
				});
				actions.append(moreButton);
				list.appendChild(button);
			}
		};
		const renderFilters = (): void => {
			filters.replaceChildren();
			for (const filter of [
				{ id: "all", label: "All", count: countByFilter.all },
				{ id: "added", label: "Added", count: countByFilter.added },
				{ id: "removed", label: "Removed", count: countByFilter.removed }
			] as const) {
				const button = filters.createEl("button", { type: "button" });
				button.className = "pdf-native-annotator-page-list-filter";
				button.createSpan({ text: filter.label });
				if (filter.count > 0) {
					button.createSpan({ cls: "pdf-native-annotator-page-list-filter-count", text: String(filter.count) });
				}
				if (this.pageListFilter === filter.id) {
					button.classList.add("is-active");
				}
				button.addEventListener("click", () => {
					this.pageListFilter = filter.id;
					renderFilters();
					renderList();
				});
			}
		};
		searchInput.addEventListener("input", () => {
			this.pageListQuery = searchInput.value;
			renderList();
		});
		searchInput.addEventListener("keydown", (event) => {
			event.stopPropagation();
			if (event.key === "Escape") {
				if (searchInput.value) {
					event.preventDefault();
					this.pageListQuery = "";
					searchInput.value = "";
					renderList();
					return;
				}
				this.closePageListPopover();
			}
			if (event.key === "Enter" && currentFilteredEntries.length > 0) {
				event.preventDefault();
				this.closePageListPopover();
				this.goToMixedPage(currentFilteredEntries[0].pageNumber);
			}
			if (event.key === "ArrowDown") {
				event.preventDefault();
				list.querySelector<HTMLElement>(".pdf-native-annotator-page-list-item")?.focus();
			}
		});
		renderFilters();
		renderList();
		this.transientPopovers.open("page-list", popover, { onClose: () => pageListDocument.body.classList.remove("pdf-native-annotator-page-list-open") });
		pageListDocument.body.classList.add("pdf-native-annotator-page-list-open");
		this.positionPopoverNearAnchor(popover, anchor, "left");
		window.setTimeout(() => list.querySelector<HTMLElement>(".pdf-native-annotator-page-list-item.is-active")?.scrollIntoView({ block: "nearest" }), 0);
	}

	private openPaperColorPopover(anchor: HTMLElement): void {
		const page = this.getCurrentSyntheticPage();
		if (!page) {
			return;
		}
		this.beginExclusiveMenu();
		const popover = createDiv();
		popover.className = "modal pdf-native-annotator-color-popover pdf-native-annotator-paper-popover";
		const title = popover.createDiv({ cls: "pdf-native-annotator-color-popover-title", text: "Paper color" });
		title.appendChild(this.createPopoverCloseButton(() => this.closePaperColorPopover()));
		const swatches = popover.createDiv({ cls: "pdf-native-annotator-color-popover-swatches" });
		for (const preset of PAPER_COLOR_PRESETS) {
			const swatch = createEl("button");
			swatch.type = "button";
			swatch.className = "pdf-native-annotator-swatch";
			swatch.title = preset.label;
			swatch.setAttribute("aria-label", `${preset.label} paper`);
			if (page.paperColor.toLowerCase() === preset.color.toLowerCase()) {
				swatch.classList.add("is-active");
			}
			const inner = swatch.createSpan({ cls: "pdf-native-annotator-swatch-inner" });
			inner.setCssStyles({ backgroundColor: preset.color });
			swatch.addEventListener("click", () => {
				this.setCurrentTemplatePageColorValue(preset.color);
				this.closePaperColorPopover();
			});
			swatches.appendChild(swatch);
		}
		const customRow = popover.createDiv({ cls: "pdf-native-annotator-color-popover-custom" });
		customRow.createSpan({ text: "Custom" });
		const colorInput = createEl("input");
		colorInput.type = "color";
		colorInput.value = page.paperColor;
		colorInput.className = "pdf-native-annotator-color";
		let historyCaptured = false;
		colorInput.addEventListener("input", () => {
			if (!historyCaptured) {
				this.pushHistory();
				historyCaptured = true;
			}
			this.setCurrentTemplatePageColorValue(colorInput.value, false);
		});
		colorInput.addEventListener("change", () => {
			this.closePaperColorPopover();
		});
		customRow.appendChild(colorInput);
		this.transientPopovers.open("paper-color", popover);
		this.positionPopoverNearAnchor(popover, anchor);
	}

	private openRenameAddedPagePopover(anchor: HTMLElement, pageId: string): void {
		const target = this.getSyntheticPageById(pageId);
		if (!target) {
			new Notice("That added page is no longer available.");
			return;
		}
		const anchorRect = anchor.getBoundingClientRect();
		this.beginExclusiveMenu();
		const popover = createDiv();
		popover.className = "modal pdf-native-annotator-rename-popover";
		const title = popover.createDiv({ cls: "pdf-native-annotator-color-popover-title", text: "Page name" });
		title.appendChild(this.createPopoverCloseButton(() => this.closeRenamePopover()));
		const form = popover.createEl("form", { cls: "pdf-native-annotator-rename-form" });
		const input = form.createEl("input", {
			type: "text",
			placeholder: "Page name"
		});
		input.value = target.page.title;
		input.className = "pdf-native-annotator-rename-input";
		const actions = form.createDiv({ cls: "pdf-native-annotator-confirm-actions" });
		const cancelButton = actions.createEl("button", { type: "button", text: "Cancel" });
		const saveButton = actions.createEl("button", { type: "submit", text: "Save", cls: "mod-cta" });
		const commitRename = (): void => {
			this.renameAddedPage(pageId, input.value);
		};
		cancelButton.addEventListener("click", () => this.closeRenamePopover());
		saveButton.addEventListener("pointerdown", (event) => {
			event.preventDefault();
			event.stopPropagation();
			commitRename();
		});
		input.addEventListener("keydown", (event) => {
			if (event.key === "Enter") {
				event.preventDefault();
				commitRename();
			}
			if (event.key === "Escape") {
				event.preventDefault();
				this.closeRenamePopover();
			}
			event.stopPropagation();
		});
		input.addEventListener("change", commitRename);
		form.addEventListener("submit", (event) => {
			event.preventDefault();
			commitRename();
		});
		this.transientPopovers.open("rename", popover);
		this.positionPopoverNearRect(popover, anchorRect);
		window.setTimeout(() => {
			input.focus();
			input.select();
		}, 0);
	}

	private renameAddedPage(pageId: string, rawTitle: string): boolean {
		const target = this.getSyntheticPageById(pageId);
		const title = rawTitle.trim();
		if (!target) {
			new Notice("That added page is no longer available.");
			this.closeRenamePopover();
			return false;
		}
		if (!title) {
			new Notice("Page name cannot be empty.");
			return false;
		}
		if (title === target.page.title) {
			this.closeRenamePopover();
			return false;
		}
		this.pushHistory();
		target.page.title = title;
		this.currentPage = target.pageNumber;
		this.markDirtyAndRedraw("Renamed added page");
		this.refreshSyntheticPages(target.pageNumber);
		this.closeRenamePopover();
		new Notice(`Renamed page to "${title}"`);
		return true;
	}

	private showMenuBelowAnchor(menu: Menu, anchor: HTMLElement): void {
		const rect = anchor.getBoundingClientRect();
		this.showExclusiveMenuAtPosition(menu, { x: rect.left, y: rect.bottom + 6 });
	}

	private openCurrentAddedPageTemplateMenu(anchor: HTMLElement): void {
		const page = this.getCurrentSyntheticPage();
		if (!page) {
			new Notice("Open an added template page first.");
			return;
		}
		const menu = new Menu();
		addMenuDescriptors(menu, NOTEBOOK_TEMPLATES.map((template) => ({
			title: getNotebookTemplateLabel(template),
			checked: page.template === template,
			run: () => this.setCurrentTemplatePageTemplate(template)
		})));
		this.showMenuBelowAnchor(menu, anchor);
	}

	private openCurrentAddedPageSizeMenu(anchor: HTMLElement): void {
		const page = this.getCurrentSyntheticPage();
		if (!page) {
			new Notice("Open an added template page first.");
			return;
		}
		const menu = new Menu();
		addMenuDescriptors(menu, NOTEBOOK_PAGE_SIZES.map((pageSize) => ({
			title: getNotebookPageSizeLabel(pageSize),
			checked: page.pageSize === pageSize,
			run: () => this.setCurrentTemplatePageSize(pageSize)
		})));
		this.showMenuBelowAnchor(menu, anchor);
	}

	private openCurrentAddedPagePaperColorMenu(anchor: HTMLElement): void {
		const page = this.getCurrentSyntheticPage();
		if (!page) {
			new Notice("Open an added template page first.");
			return;
		}
		const menu = new Menu();
		addMenuDescriptors(menu, [
			...PAPER_COLOR_PRESETS.map((preset) => ({
				title: preset.label,
				icon: "palette",
				checked: page.paperColor.toLowerCase() === preset.color.toLowerCase(),
				run: () => this.setCurrentTemplatePageColorValue(preset.color)
			})),
			menuSeparator,
			{ title: "Custom color...", icon: "palette", run: () => this.openPaperColorPopover(anchor) }
		]);
		this.showMenuBelowAnchor(menu, anchor);
	}

	private openDocumentActionsMenu(button: HTMLButtonElement): void {
		const menu = new Menu();
		menu.addItem((item) => item
			.setTitle("Insert photo...")
			.setIcon("image-file")
			.onClick(() => void this.insertPhotoOnCurrentPage()));
		menu.addItem((item) => item
			.setTitle("Create blank annotatable PDF...")
			.setIcon("file-plus-2")
			.onClick(() => this.plugin.openBlankAnnotatablePdfModal()));
		if (!this.plugin.shouldShowRegionToolbarButton()) {
			menu.addItem((item) => item
				.setTitle("Select region embed")
				.setIcon("crop")
				.onClick(() => {
					this.setActiveTool("region");
					this.applyOverlayMode();
					this.refreshToolbar();
					this.refreshStatus("Region tool: drag a crop box");
				}));
		}
		menu.addSeparator();
		menu.addItem((item) => item
			.setTitle("Copy current page link")
			.setIcon("link")
			.onClick(() => void this.copyCurrentPageLink()));
		menu.addItem((item) => item
			.setTitle("Copy annotated page embed")
			.setIcon("code")
			.onClick(() => void this.copyCurrentPageEmbedBlock()));
		if (this.selectedTargets.length > 0) {
			menu.addItem((item) => item
				.setTitle("Copy selection")
				.setIcon("copy")
				.onClick(() => this.copySelectedTargets()));
			menu.addItem((item) => item
				.setTitle("Duplicate selection")
				.setIcon("copy-plus")
				.onClick(() => this.duplicateSelectedTargets()));
			menu.addItem((item) => item
				.setTitle("Delete selection")
				.setIcon("trash")
				.setWarning(true)
				.onClick(() => this.deleteSelectedTargets()));
		}
		if (this.plugin.hasClipboard()) {
			menu.addItem((item) => item
				.setTitle("Paste copied annotations")
				.setIcon("clipboard")
				.onClick(() => this.pasteClipboard()));
		}
		menu.addSeparator();
		menu.addItem((item) => item
			.setTitle("Current page snapshot")
			.setIcon("image-file")
			.onClick(() => void this.exportCurrentPageSnapshot()));
		menu.addItem((item) => item
			.setTitle("Annotated mixed PDF")
			.setIcon("file-output")
			.onClick(() => void this.exportAnnotatedMixedDocumentPdf()));
		menu.addSeparator();
		menu.addItem((item) => item
			.setTitle("Open annotation data JSON")
			.setIcon("database")
			.onClick(() => void this.openAnnotationDataJson()));
		if (this.shouldShowRelinkAnnotationDataAction()) {
			menu.addItem((item) => item
				.setTitle("Relink annotation data")
				.setIcon("replace")
				.onClick(() => void this.relinkAnnotationDataToCurrentPdf()));
		}
		menu.addItem((item) => item
			.setTitle("Create native mixed working PDF")
			.setIcon("file-plus-2")
			.onClick(() => void this.materializeNativeMixedWorkingPdf()));
		const rect = button.getBoundingClientRect();
		this.showExclusiveMenuAtPosition(menu, { x: rect.left, y: rect.bottom + 6 });
	}

	private openAddPageMenu(button: HTMLButtonElement): void {
		this.syncCurrentPageForPageAction();
		const menu = new Menu();
		const currentSyntheticPage = this.getCurrentSyntheticPage();
		menu.addItem((item) => item
			.setTitle(`Go to page... (${this.getCurrentMixedPageOrdinal()} of ${Math.max(1, this.getMixedPageEntries().length)})`)
			.setIcon("arrow-right-square")
			.onClick(() => this.openGoToPagePopover(button)));
		menu.addItem((item) => item
			.setTitle("Manage pages...")
			.setIcon("files")
			.onClick(() => this.openPageListPopover(button)));
		menu.addSeparator();
		menu.addItem((item) => item
			.setTitle("Quick add after current")
			.setIcon("plus")
			.onClick(() => this.insertTemplatePageAfterCurrent()));
		menu.addItem((item) => item
			.setTitle("Add before...")
			.setIcon("file-plus")
			.onClick(() => this.openTemplatePageInsertModal("before")));
		menu.addItem((item) => item
			.setTitle("Add after...")
			.setIcon("file-plus")
			.onClick(() => this.openTemplatePageInsertModal("after")));
		if (currentSyntheticPage) {
			menu.addSeparator();
			menu.addItem((item) => item
				.setTitle("Rename...")
				.setIcon("pencil")
				.onClick(() => this.openRenameAddedPagePopover(button, currentSyntheticPage.id)));
			menu.addItem((item) => item
				.setTitle("Duplicate with annotations")
				.setIcon("copy")
				.onClick(() => this.duplicateCurrentTemplatePage()));
			menu.addItem((item) => item
				.setTitle("Duplicate page only")
				.setIcon("copy-plus")
				.onClick(() => this.duplicateCurrentTemplatePage(false)));
			menu.addItem((item) => item
				.setTitle(`Template: ${getNotebookTemplateLabel(currentSyntheticPage.template)}`)
				.setIcon("rows-3")
				.onClick(() => this.openCurrentAddedPageTemplateMenu(button)));
			menu.addItem((item) => item
				.setTitle(`Size: ${getNotebookPageSizeLabel(currentSyntheticPage.pageSize)}`)
				.setIcon("maximize-2")
				.onClick(() => this.openCurrentAddedPageSizeMenu(button)));
			const currentPaper = PAPER_COLOR_PRESETS.find((preset) => preset.color.toLowerCase() === currentSyntheticPage.paperColor.toLowerCase())?.label ?? "Custom";
			menu.addItem((item) => item
				.setTitle(`Paper: ${currentPaper}`)
				.setIcon("palette")
				.onClick(() => this.openCurrentAddedPagePaperColorMenu(button)));
			menu.addItem((item) => item
				.setTitle("Clear contents")
				.setIcon("eraser")
				.onClick(() => this.clearCurrentTemplatePageContents()));
			menu.addItem((item) => item
				.setTitle("Move to Removed")
				.setIcon("trash")
				.setWarning(true)
				.onClick(() => this.deleteCurrentPage()));
		} else {
			menu.addSeparator();
			menu.addItem((item) => item
				.setTitle("Remove from this session")
				.setIcon("trash")
				.onClick(() => this.deleteCurrentPage()));
		}
		menu.addSeparator();
		menu.addItem((item) => item
			.setTitle("Export annotated PDF")
			.setIcon("file-output")
			.onClick(() => void this.exportAnnotatedMixedDocumentPdf()));
		const rect = button.getBoundingClientRect();
		this.showExclusiveMenuAtPosition(menu, { x: rect.left, y: rect.bottom + 6 });
	}

	private requestDangerConfirmation(title: string, message: string, confirmText: string, onConfirm: () => void): void {
		this.beginExclusiveMenu();
		const popover = createDiv();
		popover.className = "modal pdf-native-annotator-confirm-popover";
		const header = popover.createDiv({ cls: "pdf-native-annotator-confirm-title" });
		setIcon(header.createSpan({ cls: "pdf-native-annotator-confirm-icon" }), "triangle-alert");
		header.createSpan({ text: title });
		header.appendChild(this.createPopoverCloseButton(() => this.closeConfirmPopover()));
		popover.createDiv({ cls: "pdf-native-annotator-confirm-message", text: message });
		const actions = popover.createDiv({ cls: "pdf-native-annotator-confirm-actions" });
		const cancelButton = actions.createEl("button", { type: "button", text: "Cancel" });
		const confirmButton = actions.createEl("button", { type: "button", text: confirmText, cls: "mod-warning" });
		cancelButton.addEventListener("click", () => this.closeConfirmPopover());
		confirmButton.addEventListener("click", () => {
			this.closeConfirmPopover();
			onConfirm();
		});
		this.transientPopovers.open("confirm", popover);
		const popoverRect = popover.getBoundingClientRect();
		const left = clamp((window.innerWidth / 2) - (popoverRect.width / 2), 12, window.innerWidth - popoverRect.width - 12);
		const top = clamp(88, 12, window.innerHeight - popoverRect.height - 12);
		popover.setCssStyles({
			left: `${left}px`,
			top: `${top}px`
		});
		window.setTimeout(() => confirmButton.focus(), 0);
	}

	private setCurrentTemplatePageColorValue(color: string, pushHistory = true): void {
		const page = this.getCurrentSyntheticPage();
		if (!page || page.paperColor.toLowerCase() === color.toLowerCase()) {
			return;
		}
		if (pushHistory) {
			this.pushHistory();
		}
		page.paperColor = color;
		this.markDirtyAndRedraw("Paper color changed");
		this.refreshSyntheticPages(this.currentPage);
	}

	private openTextStyleMenu(button: HTMLButtonElement): void {
		this.beginExclusiveMenu();
		const popover = createDiv();
		popover.className = "modal pdf-native-annotator-font-popover";
		const title = popover.createDiv({ cls: "pdf-native-annotator-font-popover-title", text: "Text style" });
		title.appendChild(this.createPopoverCloseButton(() => this.closeFontPopover()));
		const preview = popover.createDiv({ cls: "pdf-native-annotator-font-preview", text: "The quick brown fox" });
		const selectionSummary = popover.createDiv({ cls: "pdf-native-annotator-font-selection-summary" });
		let fontSelect: HTMLSelectElement | null = null;
		let sizeInput: HTMLInputElement | null = null;
		let lineSpacingInput: HTMLInputElement | null = null;
		let boldButton: HTMLButtonElement | null = null;
		let italicButton: HTMLButtonElement | null = null;
		let wordWrapButton: HTMLButtonElement | null = null;
		let autoFitButton: HTMLButtonElement | null = null;
		let fixedBoxButton: HTMLButtonElement | null = null;
		const alignmentButtons = new Map<TextAlignment, HTMLButtonElement>();
		const verticalAlignmentButtons = new Map<TextVerticalAlignment, HTMLButtonElement>();
		const syncPopoverState = (): void => {
			const family = this.getCurrentTextFontFamilyForMenu();
			const size = this.getCurrentTextSizeForMenu();
			const color = this.getCurrentTextColorForMenu();
			const fontWeight = this.getCurrentTextFontWeightForMenu();
			const fontStyle = this.getCurrentTextFontStyleForMenu();
			const textAlign = this.getCurrentTextAlignmentForMenu();
			const verticalAlign = this.getCurrentTextVerticalAlignmentForMenu();
			const lineSpacing = this.getCurrentTextLineSpacingForMenu();
			const wordWrap = this.getCurrentTextWordWrapForMenu();
			const autoFit = this.getCurrentTextAutoFitForMenu();
			const summary = this.getTextSelectionStyleSummary();
			preview.setCssStyles({
				fontFamily: `"${family}", sans-serif`,
				fontSize: `${clamp(size, 12, 40)}px`,
				color,
				fontWeight,
				fontStyle,
				textAlign,
				lineHeight: String(lineSpacing)
			});
			selectionSummary.textContent = summary;
			selectionSummary.classList.toggle("is-hidden", summary.length === 0);
			if (fontSelect && fontSelect !== document.activeElement) {
				fontSelect.value = family;
			}
			if (sizeInput && sizeInput !== document.activeElement) {
				sizeInput.value = String(size);
			}
			if (lineSpacingInput && lineSpacingInput !== document.activeElement) {
				lineSpacingInput.value = lineSpacing.toFixed(2);
			}
			boldButton?.classList.toggle("is-active", fontWeight === "bold");
			boldButton?.setAttribute("aria-pressed", String(fontWeight === "bold"));
			italicButton?.classList.toggle("is-active", fontStyle === "italic");
			italicButton?.setAttribute("aria-pressed", String(fontStyle === "italic"));
			for (const [alignment, alignmentButton] of alignmentButtons) {
				const active = alignment === textAlign;
				alignmentButton.classList.toggle("is-active", active);
				alignmentButton.setAttribute("aria-pressed", String(active));
			}
			for (const [alignment, alignmentButton] of verticalAlignmentButtons) {
				const active = alignment === verticalAlign;
				alignmentButton.classList.toggle("is-active", active);
				alignmentButton.setAttribute("aria-pressed", String(active));
			}
			wordWrapButton?.classList.toggle("is-active", wordWrap);
			wordWrapButton?.setAttribute("aria-pressed", String(wordWrap));
			autoFitButton?.classList.toggle("is-active", autoFit);
			autoFitButton?.setAttribute("aria-pressed", String(autoFit));
			fixedBoxButton?.classList.toggle("is-active", !autoFit);
			fixedBoxButton?.setAttribute("aria-pressed", String(!autoFit));
		};
		const createStyleButton = (
			parent: HTMLElement,
			icon: string,
			label: string,
			onClick: () => void
		): HTMLButtonElement => {
			const styleButton = parent.createEl("button", {
				type: "button",
				cls: "clickable-icon pdf-native-annotator-text-style-button",
				attr: {
					"aria-label": label,
					title: label,
					"aria-pressed": "false"
				}
			});
			setIcon(styleButton, icon);
			styleButton.addEventListener("click", (event) => {
				event.preventDefault();
				event.stopPropagation();
				onClick();
				syncPopoverState();
			});
			return styleButton;
		};
		const fontRow = popover.createDiv({ cls: "pdf-native-annotator-font-select-row" });
		fontSelect = fontRow.createEl("select", { cls: "dropdown pdf-native-annotator-font-select" });
		for (const fontFamily of TEXT_FONT_FAMILIES) {
			const option = fontSelect.createEl("option", { text: fontFamily, value: fontFamily });
			option.setCssStyles({ fontFamily: `"${fontFamily}", sans-serif` });
		}
		fontSelect.value = this.getCurrentTextFontFamilyForMenu();
		fontSelect.addEventListener("change", () => {
			this.setTextFontFamily(fontSelect?.value ?? this.currentTextFontFamily);
			syncPopoverState();
		});
		const customSizeRow = popover.createDiv({ cls: "pdf-native-annotator-font-control-row" });
		customSizeRow.createSpan({ text: "Font size" });
		sizeInput = customSizeRow.createEl("input", {
			type: "number",
			cls: "pdf-native-annotator-font-number-input",
			attr: {
				min: "8",
				max: "96",
				step: "1"
			}
		});
		sizeInput.value = String(this.getCurrentTextSizeForMenu());
		sizeInput.addEventListener("change", () => {
			const nextSize = clamp(Math.round(Number(sizeInput?.value ?? this.currentTextFontSize)), 8, 96);
			this.setTextFontSize(nextSize);
			syncPopoverState();
		});
		const formatRow = popover.createDiv({ cls: "pdf-native-annotator-text-style-row" });
		formatRow.createSpan({ cls: "pdf-native-annotator-text-style-label", text: "Style" });
		const formatControls = formatRow.createDiv({ cls: "pdf-native-annotator-text-style-group" });
		boldButton = createStyleButton(formatControls, "bold", "Bold", () => {
			this.setTextFontWeight(this.getCurrentTextFontWeightForMenu() === "bold" ? "normal" : "bold");
		});
		italicButton = createStyleButton(formatControls, "italic", "Italic", () => {
			this.setTextFontStyle(this.getCurrentTextFontStyleForMenu() === "italic" ? "normal" : "italic");
		});
		const alignmentRow = popover.createDiv({ cls: "pdf-native-annotator-text-style-row" });
		alignmentRow.createSpan({ cls: "pdf-native-annotator-text-style-label", text: "Alignment" });
		const alignmentControls = alignmentRow.createDiv({ cls: "pdf-native-annotator-text-style-group" });
		for (const alignment of ["left", "center", "right"] as TextAlignment[]) {
			const label = `${alignment[0].toUpperCase()}${alignment.slice(1)} align`;
			const alignmentButton = createStyleButton(alignmentControls, `align-${alignment}`, label, () => {
				this.setTextAlignment(alignment);
			});
			alignmentButtons.set(alignment, alignmentButton);
		}
		const verticalAlignmentRow = popover.createDiv({ cls: "pdf-native-annotator-text-style-row" });
		verticalAlignmentRow.createSpan({ cls: "pdf-native-annotator-text-style-label", text: "Vertical" });
		const verticalAlignmentControls = verticalAlignmentRow.createDiv({ cls: "pdf-native-annotator-text-style-group" });
		const verticalAlignmentIcons: Record<TextVerticalAlignment, string> = {
			top: "align-vertical-justify-start",
			middle: "align-vertical-justify-center",
			bottom: "align-vertical-justify-end"
		};
		for (const alignment of ["top", "middle", "bottom"] as TextVerticalAlignment[]) {
			const label = `${alignment[0].toUpperCase()}${alignment.slice(1)} align`;
			const alignmentButton = createStyleButton(
				verticalAlignmentControls,
				verticalAlignmentIcons[alignment],
				label,
				() => this.setTextVerticalAlignment(alignment)
			);
			verticalAlignmentButtons.set(alignment, alignmentButton);
		}
		const lineSpacingRow = popover.createDiv({ cls: "pdf-native-annotator-font-control-row" });
		lineSpacingRow.createSpan({ text: "Line spacing" });
		lineSpacingInput = lineSpacingRow.createEl("input", {
			type: "number",
			cls: "pdf-native-annotator-font-number-input",
			attr: {
				min: "0.8",
				max: "3",
				step: "0.05"
			}
		});
		lineSpacingInput.value = this.getCurrentTextLineSpacingForMenu().toFixed(2);
		lineSpacingInput.addEventListener("change", () => {
			this.setTextLineSpacing(Number(lineSpacingInput?.value ?? this.currentTextLineSpacing));
			syncPopoverState();
		});
		const layoutRow = popover.createDiv({ cls: "pdf-native-annotator-text-style-row" });
		layoutRow.createSpan({ cls: "pdf-native-annotator-text-style-label", text: "Text box" });
		const layoutControls = layoutRow.createDiv({ cls: "pdf-native-annotator-text-style-group" });
		wordWrapButton = createStyleButton(layoutControls, "wrap-text", "Toggle word wrap", () => {
			this.setTextWordWrap(!this.getCurrentTextWordWrapForMenu());
		});
		autoFitButton = createStyleButton(layoutControls, "scan-text", "Resize box to fit text", () => {
			this.setTextAutoFit(true);
		});
		fixedBoxButton = createStyleButton(layoutControls, "square", "Keep text box size fixed", () => {
			this.setTextAutoFit(false);
		});
		const caseRow = popover.createDiv({ cls: "pdf-native-annotator-font-control-row" });
		caseRow.createSpan({ text: "Change case" });
		const caseSelect = caseRow.createEl("select", { cls: "dropdown pdf-native-annotator-case-select" });
		caseSelect.createEl("option", { text: "Choose...", value: "" });
		caseSelect.createEl("option", { text: "Sentence case", value: "sentence" });
		caseSelect.createEl("option", { text: "lowercase", value: "lower" });
		caseSelect.createEl("option", { text: "UPPERCASE", value: "upper" });
		caseSelect.createEl("option", { text: "Title Case", value: "title" });
		caseSelect.createEl("option", { text: "tOGGLE cASE", value: "toggle" });
		caseSelect.addEventListener("change", () => {
			const mode = caseSelect.value as "sentence" | "lower" | "upper" | "title" | "toggle" | "";
			if (mode) {
				this.transformTextCase(mode);
				caseSelect.value = "";
				syncPopoverState();
			}
		});
		this.transientPopovers.open("font", popover, { onClose: () => this.refocusInlineTextEditor() });
		syncPopoverState();
		this.positionPopoverNearAnchor(popover, button, "left");
	}

	private getSelectedTextItems(): TextAnnotation[] {
		if (!this.annotationDocument) {
			return [];
		}
		const selectedTextIds = new Set(this.selectedTargets.filter((target) => target.kind === "text").map((target) => target.id));
		return this.annotationDocument.textItems.filter((item) => selectedTextIds.has(item.id));
	}

	private getTextSelectionStyleSummary(): string {
		const items = this.getSelectedTextItems();
		if (items.length <= 1) {
			return "";
		}
		const families = new Set(items.map((item) => item.fontFamily ?? this.currentTextFontFamily));
		const sizes = new Set(items.map((item) => Math.round(item.fontSize)));
		const colors = new Set(items.map((item) => (item.color ?? this.currentTextColor).toLowerCase()));
		const widths = new Set(items.map((item) => item.boxWidthScale ? item.boxWidthScale.toFixed(4) : "auto"));
		const weights = new Set(items.map((item) => resolveTextFontWeight(item)));
		const styles = new Set(items.map((item) => resolveTextFontStyle(item)));
		const alignments = new Set(items.map((item) => resolveTextAlignment(item)));
		const verticalAlignments = new Set(items.map((item) => resolveTextVerticalAlignment(item)));
		const lineSpacings = new Set(items.map((item) => resolveTextLineSpacing(item).toFixed(2)));
		const wrappingModes = new Set(items.map((item) => resolveTextWordWrap(item)));
		const fitModes = new Set(items.map((item) => item.autoFit === true));
		const mixed = [
			families.size > 1 ? "font" : null,
			sizes.size > 1 ? "size" : null,
			colors.size > 1 ? "color" : null,
			widths.size > 1 ? "box" : null,
			weights.size > 1 ? "weight" : null,
			styles.size > 1 ? "style" : null,
			alignments.size > 1 ? "alignment" : null,
			verticalAlignments.size > 1 ? "vertical alignment" : null,
			lineSpacings.size > 1 ? "line spacing" : null,
			wrappingModes.size > 1 ? "wrapping" : null,
			fitModes.size > 1 ? "fit mode" : null
		].filter((entry): entry is string => !!entry);
		return mixed.length > 0
			? `${items.length} text boxes selected; mixed ${mixed.join(", ")}. Changes apply to all selected text boxes.`
			: `${items.length} text boxes selected. Changes apply to all selected text boxes.`;
	}

	private getCurrentTextFontFamilyForMenu(): string {
		if (this.inlineTextEditorEl) {
			return this.currentTextFontFamily;
		}
		if (this.annotationDocument && this.hasSelectedText()) {
			const item = this.getSelectedTextItems()[0] ?? null;
			return item?.fontFamily ?? this.currentTextFontFamily;
		}
		return this.currentTextFontFamily;
	}

	private getCurrentTextSizeForMenu(): number {
		if (this.inlineTextEditorEl) {
			return this.currentTextFontSize;
		}
		if (this.annotationDocument && this.hasSelectedText()) {
			const item = this.getSelectedTextItems()[0] ?? null;
			return item ? Math.round(item.fontSize) : this.currentTextFontSize;
		}
		return this.currentTextFontSize;
	}

	private getCurrentTextColorForMenu(): string {
		if (this.inlineTextEditorEl) {
			return this.currentTextColor;
		}
		if (this.annotationDocument && this.hasSelectedText()) {
			const item = this.getSelectedTextItems()[0] ?? null;
			return item?.color ?? this.currentTextColor;
		}
		return this.currentTextColor;
	}

	private getCurrentTextFontWeightForMenu(): TextFontWeight {
		if (this.inlineTextEditorEl) {
			return this.currentTextFontWeight;
		}
		if (this.annotationDocument && this.hasSelectedText()) {
			const item = this.getSelectedTextItems()[0] ?? null;
			return item ? resolveTextFontWeight(item) : this.currentTextFontWeight;
		}
		return this.currentTextFontWeight;
	}

	private getCurrentTextFontStyleForMenu(): TextFontStyle {
		if (this.inlineTextEditorEl) {
			return this.currentTextFontStyle;
		}
		if (this.annotationDocument && this.hasSelectedText()) {
			const item = this.getSelectedTextItems()[0] ?? null;
			return item ? resolveTextFontStyle(item) : this.currentTextFontStyle;
		}
		return this.currentTextFontStyle;
	}

	private getCurrentTextAlignmentForMenu(): TextAlignment {
		if (this.inlineTextEditorEl) {
			return this.currentTextAlignment;
		}
		if (this.annotationDocument && this.hasSelectedText()) {
			const item = this.getSelectedTextItems()[0] ?? null;
			return item ? resolveTextAlignment(item) : this.currentTextAlignment;
		}
		return this.currentTextAlignment;
	}

	private getCurrentTextVerticalAlignmentForMenu(): TextVerticalAlignment {
		if (this.inlineTextEditorEl) {
			return this.currentTextVerticalAlignment;
		}
		if (this.annotationDocument && this.hasSelectedText()) {
			const item = this.getSelectedTextItems()[0] ?? null;
			return item ? resolveTextVerticalAlignment(item) : this.currentTextVerticalAlignment;
		}
		return this.currentTextVerticalAlignment;
	}

	private getCurrentTextLineSpacingForMenu(): number {
		if (this.inlineTextEditorEl) {
			return this.currentTextLineSpacing;
		}
		if (this.annotationDocument && this.hasSelectedText()) {
			const item = this.getSelectedTextItems()[0] ?? null;
			return item ? resolveTextLineSpacing(item) : this.currentTextLineSpacing;
		}
		return this.currentTextLineSpacing;
	}

	private getCurrentTextWordWrapForMenu(): boolean {
		if (this.inlineTextEditorEl) {
			return this.currentTextWordWrap;
		}
		if (this.annotationDocument && this.hasSelectedText()) {
			const item = this.getSelectedTextItems()[0] ?? null;
			return item ? resolveTextWordWrap(item) : this.currentTextWordWrap;
		}
		return this.currentTextWordWrap;
	}

	private getCurrentTextAutoFitForMenu(): boolean {
		if (this.inlineTextEditorEl) {
			return this.inlineTextAutoFit;
		}
		if (this.annotationDocument && this.hasSelectedText()) {
			return this.getSelectedTextItems()[0]?.autoFit === true;
		}
		return true;
	}
	private getActivePresetKind(): ToolPresetKind | null {
		if (this.currentTool === "pen" || this.currentTool === "highlighter" || this.currentTool === "eraser") {
			return this.currentTool;
		}
		return null;
	}

	private isStrokeSizedTool(): boolean {
		return this.currentTool === "pen" ||
			this.currentTool === "highlighter" ||
			this.currentTool === "eraser" ||
			isShapeTool(this.currentTool);
	}

	private refreshToolbar(): void {
		if (!this.toolbarEl) {
			return;
		}
		this.updateNativeMixedPageThumbnailSelection();
		this.syncNativeMixedPageNavigator();

		const previousToolScrollLeft =
			this.toolbarEl.querySelector<HTMLElement>(".pdf-native-annotator-group.is-tools")?.scrollLeft ?? 0;
		this.toolbarEl.replaceChildren();

		const leftGroup = createDiv();
		leftGroup.className = "pdf-native-annotator-group is-tools";

		leftGroup.appendChild(this.createButton(this.annotationMode ? "Finish" : "Annotate", this.annotationMode, () => {
			this.toggleAnnotationMode();
		}));
		if (!this.annotationMode) {
			const readModeHint = createSpan();
			readModeHint.className = "pdf-native-annotator-read-mode-hint";
			readModeHint.textContent = "Read mode";
			leftGroup.appendChild(readModeHint);

			const rightGroup = createDiv();
			rightGroup.className = "pdf-native-annotator-group is-actions";
			const addPageButton = this.createPageMenuButton();
			rightGroup.appendChild(addPageButton);
			const moreButton = this.createIconButton("more-vertical", "More annotation actions", false, () => {
				this.openDocumentActionsMenu(moreButton);
			});
			rightGroup.appendChild(moreButton);

			this.toolbarEl.appendChild(leftGroup);
			this.toolbarEl.appendChild(rightGroup);
			this.restoreToolbarToolScroll(leftGroup, previousToolScrollLeft);
			this.repositionOpenPopovers();
			return;
		}
		if (isTabletWebKitTouchDevice()) {
			const touchDrawing = this.getInkInputPolicy() !== "pen-mouse-only";
			const touchModeButton = this.createButton(
				touchDrawing ? "Finger draws" : "Finger pans",
				touchDrawing,
				() => this.toggleTabletTouchInputMode()
			);
			touchModeButton.classList.add("pdf-native-annotator-mode-button", "pdf-native-annotator-touch-mode-button");
			touchModeButton.setAttribute("aria-pressed", String(touchDrawing));
			touchModeButton.title = touchDrawing
				? "Finger draws annotations. Tap to pan the page with one finger."
				: "Finger pans the page. Apple Pencil and mouse continue drawing.";
			leftGroup.appendChild(touchModeButton);
		}
		let selectButton: HTMLButtonElement;
		selectButton = this.createIconButton("move", "Select", this.currentTool === "select", () => {
			if (this.currentTool === "select") {
				this.openSelectionMenu(selectButton);
				return;
			}
			this.setActiveTool("select");
			this.applyOverlayMode();
			this.refreshToolbar();
		});
		leftGroup.appendChild(selectButton);
		if (this.currentTool === "select") {
			const selectionModeButton = this.createButton(
				this.toolState.selectionMode === "lasso" ? "Lasso" : this.toolState.selectionMode === "box" ? "Box" : "Single",
				false,
				() => {
					const targetButton = selectionModeButton;
					this.openSelectionMenu(targetButton);
				}
			);
			selectionModeButton.classList.add("pdf-native-annotator-mode-button");
			leftGroup.appendChild(selectionModeButton);
		}
		if (this.plugin.shouldShowRegionToolbarButton()) {
			leftGroup.appendChild(this.createIconButton("crop", "Region embed", this.currentTool === "region", () => {
				this.setActiveTool("region");
				this.applyOverlayMode();
				this.refreshToolbar();
				this.refreshStatus("Region tool: drag a crop box");
			}));
		}
		leftGroup.appendChild(this.createIconButton("pen-tool", "Pen", this.currentTool === "pen", () => {
			this.setActiveTool("pen");
			this.applyOverlayMode();
			this.refreshToolbar();
		}));
		leftGroup.appendChild(this.createIconButton("highlighter", "Highlighter", this.currentTool === "highlighter", () => {
			this.setActiveTool("highlighter");
			this.applyOverlayMode();
			this.refreshToolbar();
		}));
		leftGroup.appendChild(this.createIconButton("eraser", `Eraser (${this.eraserMode})`, this.currentTool === "eraser", () => {
			if (this.currentTool === "eraser") {
				this.toggleEraserMode();
				return;
			}
			this.setActiveTool("eraser");
			this.applyOverlayMode();
			this.refreshToolbar();
			this.refreshStatus(`Tool: Eraser (${this.eraserMode})`);
		}));
		if (this.currentTool === "eraser") {
			const eraserModeButton = this.createButton(
				this.eraserMode === "segment" ? "Touch erase" : "Object erase",
				false,
				() => {
					this.toggleEraserMode();
				}
			);
			eraserModeButton.classList.add("pdf-native-annotator-mode-button");
			leftGroup.appendChild(eraserModeButton);
		}
		leftGroup.appendChild(this.createIconButton("type", "Text", this.currentTool === "text", () => {
			this.setActiveTool("text");
			this.applyOverlayMode();
			this.refreshToolbar();
		}));
		if (isTabletWebKitTouchDevice()) {
			const shapeButton = this.createIconButton(
				"shapes",
				isShapeTool(this.currentTool) ? `Shapes (${this.currentTool})` : "Shapes",
				isShapeTool(this.currentTool),
				() => this.openShapeToolMenu(shapeButton)
			);
			shapeButton.classList.add("pdf-native-annotator-shape-menu-button");
			leftGroup.appendChild(shapeButton);
		} else {
			leftGroup.appendChild(this.createIconButton("square", "Rectangle", this.currentTool === "rectangle", () => {
				this.setActiveTool("rectangle");
				this.applyOverlayMode();
				this.refreshToolbar();
			}));
			leftGroup.appendChild(this.createIconButton("circle", "Ellipse", this.currentTool === "ellipse", () => {
				this.setActiveTool("ellipse");
				this.applyOverlayMode();
				this.refreshToolbar();
			}));
			leftGroup.appendChild(this.createIconButton("minus", "Line", this.currentTool === "line", () => {
				this.setActiveTool("line");
				this.applyOverlayMode();
				this.refreshToolbar();
			}));
		}

		const activePresetKind = this.getActivePresetKind();
		if (activePresetKind) {
			const slots = createDiv();
			slots.className = "pdf-native-annotator-pen-slots";
			slots.classList.add(`is-${activePresetKind}`);
			for (const preset of this.toolState.getPresetsByKind(activePresetKind)) {
				slots.appendChild(this.createPresetButton(preset));
			}
			leftGroup.appendChild(slots);
		}

		if (this.currentTool !== "eraser" && this.currentTool !== "region") {
			leftGroup.appendChild(this.createColorPickerButton());
		}

		if (this.isStrokeSizedTool() || this.shouldApplyStyleToSelection()) {
			const strokeControl = createDiv();
			strokeControl.className = "pdf-native-annotator-stroke-control";
			strokeControl.appendChild(this.createStrokeSizeButton());
			leftGroup.appendChild(strokeControl);
		}

		if (this.currentTool === "text" || (this.currentTool === "select" && this.hasSelectedText())) {
			const textStyleButton = this.createButton("Font", false, () => {
				this.openTextStyleMenu(textStyleButton);
			});
			textStyleButton.classList.add("pdf-native-annotator-mode-button", "pdf-native-annotator-font-button");
			leftGroup.appendChild(textStyleButton);
		}

		const rightGroup = createDiv();
		rightGroup.className = "pdf-native-annotator-group is-actions";

		if (this.selectedTargets.length > 0) {
			const selectionLabel = `Selection ${this.selectedTargets.length}`;
			const selectionActionsButton = this.createButton(selectionLabel, false, () => {
				this.openSelectionActionsMenu(selectionActionsButton);
			});
			selectionActionsButton.classList.add("pdf-native-annotator-mode-button");
			rightGroup.appendChild(selectionActionsButton);
		}
		if (this.lastSelectionRegion) {
			const regionActionsButton = this.createButton("Region", false, () => {
				this.openRegionActionsMenu(regionActionsButton);
			});
			regionActionsButton.classList.add("pdf-native-annotator-mode-button");
			rightGroup.appendChild(regionActionsButton);
		}
		if (this.lastSelectionRegion && this.plugin.shouldShowCopyEmbedToolbarButton()) {
			const copyRegionButton = this.createButton("Copy embed", false, () => {
				void this.copySelectionAnnotatedEmbedBlock();
			});
			copyRegionButton.classList.add("pdf-native-annotator-mode-button");
			copyRegionButton.title = "Copy an annotated markdown embed for the selected box region";
			rightGroup.appendChild(copyRegionButton);
		}
		if (this.plugin.hasClipboard()) {
			rightGroup.appendChild(this.createIconButton("clipboard", "Paste copied annotations", false, () => this.pasteClipboard()));
		}
		rightGroup.appendChild(this.createHistoryIconButton("undo-2", "Undo", () => this.undoFromToolbar()));
		rightGroup.appendChild(this.createHistoryIconButton("redo-2", "Redo", () => this.redoFromToolbar()));
		const addPageButton = this.createPageMenuButton();
		rightGroup.appendChild(addPageButton);
		const moreButton = this.createIconButton("more-vertical", "More annotation actions", false, () => {
			this.openDocumentActionsMenu(moreButton);
		});
		rightGroup.appendChild(moreButton);

		this.toolbarEl.appendChild(leftGroup);
		this.toolbarEl.appendChild(rightGroup);
		this.restoreToolbarToolScroll(leftGroup, previousToolScrollLeft);
		this.repositionOpenPopovers();
	}

	private restoreToolbarToolScroll(group: HTMLElement, scrollLeft: number): void {
		group.scrollLeft = scrollLeft;
		if (this.toolbarScrollRestoreHandle !== null) {
			window.cancelAnimationFrame(this.toolbarScrollRestoreHandle);
		}
		this.toolbarScrollRestoreHandle = window.requestAnimationFrame(() => {
			this.toolbarScrollRestoreHandle = null;
			if (group.isConnected) {
				group.scrollLeft = scrollLeft;
			}
		});
	}

	private createButton(label: string, active: boolean, onClick: () => void): HTMLButtonElement {
		const button = createEl("button");
		button.type = "button";
		button.className = "pdf-native-annotator-button";
		if (label.trim()) {
			button.classList.add("pdf-native-annotator-text-button");
		}
		if (active) {
			button.classList.add("is-active");
		}
		button.textContent = label;
		this.bindToolbarButtonActivation(button, onClick);
		return button;
	}

	private bindToolbarButtonActivation(button: HTMLButtonElement, onActivate: (event: Event) => void): void {
		let handledMousePointerUp = false;
		button.addEventListener("pointerdown", (event) => event.stopPropagation());
		button.addEventListener("pointerup", (event) => {
			event.stopPropagation();
			if (event.pointerType !== "mouse" || event.button !== 0 || button.disabled) {
				return;
			}
			handledMousePointerUp = true;
			event.preventDefault();
			onActivate(event);
			window.setTimeout(() => {
				handledMousePointerUp = false;
			}, 0);
		});
		button.addEventListener("click", (event) => {
			event.stopPropagation();
			if (handledMousePointerUp) {
				event.preventDefault();
				return;
			}
			event.preventDefault();
			if (!button.disabled) {
				onActivate(event);
			}
		});
	}

	private createIconButton(icon: string, label: string, active: boolean, onClick: () => void): HTMLButtonElement {
		const button = this.createButton("", active, onClick);
		button.classList.add("clickable-icon", "pdf-native-annotator-icon-button");
		button.setAttribute("aria-label", label);
		button.title = label;
		setIcon(button, icon);
		return button;
	}
	private createPageMenuButton(): HTMLButtonElement {
		const button = createEl("button");
		button.type = "button";
		button.className = "pdf-native-annotator-button pdf-native-annotator-labeled-icon-button pdf-native-annotator-page-menu-button";
		button.setAttribute("aria-label", "Page");
		button.title = "Navigate, add, and manage pages";
		setIcon(button, "files");
		button.createSpan({ text: "Page" });
		let openedFromPointerDown = false;
		button.addEventListener("pointerdown", (event) => {
			event.stopPropagation();
			if (button.disabled || (event.pointerType === "mouse" && event.button !== 0)) {
				return;
			}
			event.preventDefault();
			openedFromPointerDown = true;
			this.openAddPageMenu(button);
			window.setTimeout(() => {
				openedFromPointerDown = false;
			}, 0);
		});
		button.addEventListener("click", (event) => {
			event.stopPropagation();
			event.preventDefault();
			if (!button.disabled && !openedFromPointerDown) {
				this.openAddPageMenu(button);
			}
		});
		return button;
	}

	private createHistoryIconButton(icon: string, label: string, onActivate: () => void): HTMLButtonElement {
		const button = createEl("button");
		button.type = "button";
		button.className = "pdf-native-annotator-button clickable-icon pdf-native-annotator-icon-button";
		button.setAttribute("aria-label", label);
		button.title = label;
		setIcon(button, icon);
		let handledPointerDown = false;
		button.addEventListener("pointerdown", (event) => {
			event.stopPropagation();
			if (button.disabled) {
				return;
			}
			if (event.pointerType === "mouse" && event.button !== 0) {
				return;
			}
			handledPointerDown = true;
			event.preventDefault();
			onActivate();
			window.setTimeout(() => {
				handledPointerDown = false;
			}, 0);
		});
		button.addEventListener("click", (event) => {
			event.stopPropagation();
			if (handledPointerDown) {
				event.preventDefault();
				return;
			}
			event.preventDefault();
			if (!button.disabled) {
				onActivate();
			}
		});
		return button;
	}

	private createPageListActionButton(icon: string, label: string, onClick: (event: MouseEvent) => void): HTMLButtonElement {
		const button = createEl("button");
		button.type = "button";
		button.className = "pdf-native-annotator-page-list-action clickable-icon";
		button.setAttribute("aria-label", label);
		button.title = label;
		setIcon(button, icon);
		button.addEventListener("pointerdown", (event) => event.stopPropagation());
		button.addEventListener("click", (event) => {
			event.preventDefault();
			event.stopPropagation();
			onClick(event);
		});
		return button;
	}

	private createPopoverCloseButton(onClick: () => void): HTMLButtonElement {
		const button = createEl("button");
		button.type = "button";
		button.className = "modal-close-button pdf-native-annotator-popover-close";
		button.setAttribute("aria-label", "Close");
		button.title = "Close";
		setIcon(button, "x");
		button.addEventListener("pointerdown", (event) => {
			event.preventDefault();
			event.stopPropagation();
			onClick();
		});
		button.addEventListener("click", (event) => {
			event.preventDefault();
			event.stopPropagation();
		});
		return button;
	}

	private positionPopoverNearAnchor(popover: HTMLElement, anchor: HTMLElement, mode: "center" | "left" = "center"): void {
		this.positionPopoverNearRect(popover, anchor.getBoundingClientRect(), mode);
	}

	private positionPopoverNearRect(popover: HTMLElement, anchorRect: DOMRect, mode: "center" | "left" = "center"): void {
		popover.setCssStyles({ maxHeight: "" });
		const popoverRect = popover.getBoundingClientRect();
		const visualViewport = window.visualViewport;
		const viewportLeft = visualViewport?.offsetLeft ?? 0;
		const viewportTop = visualViewport?.offsetTop ?? 0;
		const viewportWidth = visualViewport?.width ?? window.innerWidth;
		const viewportHeight = visualViewport?.height ?? window.innerHeight;
		const placement = resolveAnchoredPopoverPlacement(
			anchorRect,
			popoverRect,
			{
				left: viewportLeft,
				top: viewportTop,
				right: viewportLeft + viewportWidth,
				bottom: viewportTop + viewportHeight
			},
			mode
		);
		popover.setCssStyles({
			left: `${placement.left}px`,
			top: `${placement.top}px`,
			maxHeight: `${placement.maxHeight}px`
		});
	}

	private scheduleRepositionOpenPopovers(): void {
		if (this.popoverRepositionHandle !== null) {
			return;
		}
		this.popoverRepositionHandle = window.requestAnimationFrame(() => {
			this.popoverRepositionHandle = null;
			this.repositionOpenPopovers();
		});
	}

	private repositionOpenPopovers(): void {
		if (!this.toolbarEl) {
			return;
		}
		const strokeAnchor = this.toolbarEl.querySelector<HTMLElement>(".pdf-native-annotator-stroke-button");
		const strokePopover = this.transientPopovers.get("stroke");
		if (strokePopover && strokeAnchor) {
			this.positionPopoverNearAnchor(strokePopover, strokeAnchor);
		}
		const colorAnchor = this.toolbarEl.querySelector<HTMLElement>(".pdf-native-annotator-color-button");
		const colorPopover = this.transientPopovers.get("color");
		if (colorPopover && colorAnchor) {
			this.positionPopoverNearAnchor(colorPopover, colorAnchor);
		}
		const fontAnchor = this.toolbarEl.querySelector<HTMLElement>(".pdf-native-annotator-font-button");
		const fontPopover = this.transientPopovers.get("font");
		if (fontPopover && fontAnchor) {
			this.positionPopoverNearAnchor(fontPopover, fontAnchor, "left");
		}
		const pageAnchor = this.toolbarEl.querySelector<HTMLElement>(".pdf-native-annotator-page-menu-button");
		if (pageAnchor) {
			const paperColorPopover = this.transientPopovers.get("paper-color");
			if (paperColorPopover) {
				this.positionPopoverNearAnchor(paperColorPopover, pageAnchor);
			}
			const renamePopover = this.transientPopovers.get("rename");
			if (renamePopover) {
				this.positionPopoverNearAnchor(renamePopover, pageAnchor);
			}
			const goToPagePopover = this.transientPopovers.get("go-to-page");
			if (goToPagePopover) {
				this.positionPopoverNearAnchor(goToPagePopover, pageAnchor);
			}
			const pageListPopover = this.transientPopovers.get("page-list");
			if (pageListPopover) {
				this.positionPopoverNearAnchor(pageListPopover, pageAnchor, "left");
			}
		}
	}

	private createPresetButton(preset: ToolPreset): HTMLButtonElement {
		const button = createEl("button");
		button.type = "button";
		button.className = "pdf-native-annotator-preset";
		button.classList.add(`is-${preset.kind}`);
		button.title = `${preset.label}: ${preset.kind} ${preset.width}`;
		button.setAttribute("aria-label", preset.label);
		if (this.toolState.selectedPresetId === preset.id) {
			button.classList.add("is-active");
		}
		const preview = createSpan();
		preview.className = "pdf-native-annotator-preset-preview";
		preview.setCssStyles({
			height: `${Math.max(4, Math.min(14, preset.width))}px`,
			width: `${Math.max(18, Math.min(34, preset.width * 2.6))}px`
		});
		if (preset.kind !== "eraser") {
			preview.setCssStyles({
				backgroundColor: preset.color,
				opacity: String(preset.opacity)
			});
		}
		button.appendChild(preview);
		this.bindToolbarButtonActivation(button, () => {
			this.applyPreset(preset.id);
		});
		return button;
	}

	private usesTextColorControl(): boolean {
		return this.currentTool === "text" || (
			this.currentTool === "select" &&
			this.selectedTargets.length > 0 &&
			this.selectedTargets.every((target) => target.kind === "text")
		);
	}

	private getToolbarColor(): string {
		return this.usesTextColorControl() ? this.getCurrentTextColorForMenu() : this.currentColor;
	}

	private applyToolbarColor(color: string, pushHistory = true, refreshToolbar = true): void {
		if (this.usesTextColorControl()) {
			this.setTextColor(color, pushHistory, refreshToolbar);
			return;
		}
		if (this.shouldApplyStyleToSelection()) {
			this.applyColorToSelection(color, pushHistory);
		}
		this.setCurrentColor(color);
		if (refreshToolbar) {
			this.refreshToolbar();
		}
	}

	private createColorSwatch(color: string, label: string): HTMLButtonElement {
		const button = createEl("button");
		button.type = "button";
		button.className = "pdf-native-annotator-swatch";
		button.title = label;
		button.setAttribute("aria-label", `${label} ${this.usesTextColorControl() ? "text" : "ink"}`);
		if (this.getToolbarColor().toLowerCase() === color.toLowerCase()) {
			button.classList.add("is-active");
		}
		const inner = createSpan();
		inner.className = "pdf-native-annotator-swatch-inner";
		inner.setCssStyles({ backgroundColor: color });
		button.appendChild(inner);
		this.bindToolbarButtonActivation(button, () => {
			this.applyToolbarColor(color);
		});
		return button;
	}

	private createColorPickerButton(): HTMLButtonElement {
		const button = createEl("button");
		button.type = "button";
		button.className = "pdf-native-annotator-color-button";
		button.title = "Choose color";
		button.setAttribute("aria-label", this.usesTextColorControl() ? "Choose text color" : "Choose ink color");
		const preview = button.createSpan({ cls: "pdf-native-annotator-color-button-preview" });
		preview.setCssStyles({ backgroundColor: this.getToolbarColor() });
		this.bindToolbarButtonActivation(button, () => {
			this.openColorPopover(button);
		});
		return button;
	}

	private openColorPopover(anchor: HTMLElement): void {
		this.beginExclusiveMenu();
		const popover = createDiv();
		popover.className = "modal pdf-native-annotator-color-popover pdf-native-annotator-tool-color-popover";
		const controlsTextColor = this.usesTextColorControl();
		const title = popover.createDiv({
			cls: "pdf-native-annotator-color-popover-title",
			text: controlsTextColor ? "Text color" : "Ink color"
		});
		title.appendChild(this.createPopoverCloseButton(() => this.closeColorPopover()));
		const swatches = popover.createDiv({ cls: "pdf-native-annotator-color-popover-swatches" });
		for (const preset of TEXT_COLOR_PRESETS) {
			const swatch = this.createColorSwatch(preset.color, preset.label);
			swatch.addEventListener("click", () => {
				this.closeColorPopover();
			});
			swatches.appendChild(swatch);
		}
		const customRow = popover.createDiv({ cls: "pdf-native-annotator-color-popover-custom" });
		customRow.createSpan({ text: "Custom" });
		const colorInput = createEl("input");
		colorInput.type = "color";
		colorInput.value = this.getToolbarColor();
		colorInput.className = "pdf-native-annotator-color";
		let historyCaptured = false;
		colorInput.addEventListener("input", () => {
			const appliesToSelection = this.usesTextColorControl()
				? this.shouldApplyTextStyleToSelection()
				: this.shouldApplyStyleToSelection();
			if (appliesToSelection) {
				if (!historyCaptured) {
					this.pushHistory();
					historyCaptured = true;
				}
			}
			this.applyToolbarColor(colorInput.value, false, false);
			const preview = anchor.querySelector<HTMLElement>(".pdf-native-annotator-color-button-preview");
			if (preview) {
				preview.setCssStyles({ backgroundColor: colorInput.value });
			}
		});
		colorInput.addEventListener("change", () => {
			this.closeColorPopover();
			this.refreshToolbar();
		});
		customRow.appendChild(colorInput);
		this.transientPopovers.open("color", popover, { onClose: () => this.refocusInlineTextEditor() });
		this.positionPopoverNearAnchor(popover, anchor);
	}

	private createStrokeSizeButton(): HTMLButtonElement {
		const width = this.shouldApplyStyleToSelection() ? this.getSelectionWidthValue() : this.getActiveWidth();
		const button = createEl("button");
		button.type = "button";
		button.className = "pdf-native-annotator-stroke-button";
		button.classList.add("is-active");
		button.title = `${this.getStrokePopoverTitle()}: ${width.toFixed(1)} px`;
		button.setAttribute("aria-label", `${this.getStrokePopoverTitle()} ${width.toFixed(1)} px`);
		setIcon(button.createSpan({ cls: "pdf-native-annotator-stroke-icon" }), "sliders-horizontal");
		button.createSpan({ cls: "pdf-native-annotator-stroke-value", text: `${width.toFixed(1)}` });
		this.bindToolbarButtonActivation(button, () => {
			this.openStrokeThicknessPopover(button);
		});
		return button;
	}

	private updateStrokePreviewElement(anchor: HTMLElement, width: number): void {
		const strokeValue = anchor.querySelector<HTMLElement>(".pdf-native-annotator-stroke-value");
		if (strokeValue) {
			strokeValue.textContent = width.toFixed(1);
		}
		anchor.setAttribute("aria-label", `${this.getStrokePopoverTitle()} ${width.toFixed(1)} px`);
		anchor.setAttribute("title", `${this.getStrokePopoverTitle()}: ${width.toFixed(1)} px`);

		const activePresetPreview = this.toolbarEl?.querySelector<HTMLElement>(".pdf-native-annotator-preset.is-active .pdf-native-annotator-preset-preview");
		this.updatePresetPreviewElement(activePresetPreview, width);
	}
	private updatePresetPreviewElement(preview: HTMLElement | null | undefined, width: number): void {
		if (!preview) {
			return;
		}
		preview.setCssStyles({
			height: `${Math.max(4, Math.min(14, width))}px`,
			width: `${Math.max(18, Math.min(34, width * 2.6))}px`
		});
	}

	private getWidthStorageTool(tool: AnnotationTool = this.currentTool): AnnotationTool {
		return isShapeTool(tool) ? "pen" : tool;
	}

	private setToolbarWidth(width: number, refresh = true, targetTool: AnnotationTool = this.currentTool, pushSelectionHistory = true): void {
		if (this.shouldApplyStyleToSelection()) {
			this.applyWidthToSelection(width, pushSelectionHistory);
		}
		this.toolState.setWidth(width, this.getWidthStorageTool(targetTool));
		this.persistToolDefaults();
		this.refreshToolPreviewFromLastPointer(this.currentTool === "eraser" && this.erasingSession);
		if (refresh) {
			this.refreshToolbar();
		}
	}

	private openStrokeThicknessPopover(anchor: HTMLElement): void {
		this.beginExclusiveMenu();
		const popover = createDiv();
		popover.className = "modal pdf-native-annotator-stroke-popover";
		const targetTool = this.currentTool;
		const initialWidth = this.shouldApplyStyleToSelection() ? this.getSelectionWidthValue() : this.getActiveWidth();
		const title = popover.createDiv({ cls: "pdf-native-annotator-stroke-popover-title" });
		title.createSpan({ text: this.getStrokePopoverTitle() });
		title.appendChild(this.createPopoverCloseButton(() => this.closeStrokePopover()));
		const previewWrap = popover.createDiv({ cls: "pdf-native-annotator-stroke-popover-preview" });
		const previewLine = previewWrap.createSpan({ cls: "pdf-native-annotator-stroke-popover-preview-line" });
		previewLine.setCssProps({ "--stroke-preview-size": `${initialWidth}px` });
		if (targetTool === "highlighter") {
			previewWrap.classList.add("is-highlighter");
			previewLine.setCssStyles({ backgroundColor: this.currentColor });
		} else if (targetTool === "eraser") {
			previewWrap.classList.add("is-eraser");
		} else {
			previewLine.setCssStyles({ backgroundColor: this.currentColor });
		}
		const body = popover.createDiv({ cls: "pdf-native-annotator-stroke-popover-body" });
		const valueLabel = body.createSpan({ cls: "pdf-native-annotator-stroke-popover-value", text: `${initialWidth.toFixed(1)} px` });
		const sliderWrap = body.createDiv({ cls: "pdf-native-annotator-stroke-slider-wrap" });
		const slider = sliderWrap.createEl("input", { type: "range" });
		const widthRange = this.getWidthRange(targetTool);
		slider.min = String(widthRange.min);
		slider.max = String(widthRange.max);
		slider.step = String(widthRange.step);
		slider.value = String(initialWidth);
		const tickRow = sliderWrap.createDiv({ cls: "pdf-native-annotator-stroke-ticks" });
		tickRow.createSpan({ text: "Thin" });
		tickRow.createSpan({ text: "Thick" });
		let historyCaptured = false;
		slider.addEventListener("input", () => {
			if (!historyCaptured && this.shouldApplyStyleToSelection()) {
				this.pushHistory();
				historyCaptured = true;
			}
			const width = Number(slider.value);
			valueLabel.textContent = `${width.toFixed(1)} px`;
			previewLine.setCssProps({ "--stroke-preview-size": `${width}px` });
			this.setToolbarWidth(width, false, targetTool, false);
			this.updateStrokePreviewElement(anchor, width);
		});
		slider.addEventListener("change", () => {
			const width = Number(slider.value);
			this.setToolbarWidth(width, true, targetTool, !historyCaptured);
		});
		this.transientPopovers.open("stroke", popover);
		this.positionPopoverNearAnchor(popover, anchor);
	}

	private closeStrokePopover(): void {
		this.transientPopovers.close("stroke");
	}

	private closeTransientPopovers(): void {
		this.transientPopovers.closeAll();
	}

	private closeColorPopover(): void {
		this.transientPopovers.close("color");
	}

	private closePaperColorPopover(): void {
		this.transientPopovers.close("paper-color");
	}

	private closeConfirmPopover(): void {
		this.transientPopovers.close("confirm");
	}

	private closeRenamePopover(): void {
		this.transientPopovers.close("rename");
	}

	private closeGoToPagePopover(): void {
		this.transientPopovers.close("go-to-page");
	}

	private closePageListPopover(): void {
		this.transientPopovers.close("page-list");
	}

	private closeFontPopover(): void {
		this.transientPopovers.close("font");
	}

	private refocusInlineTextEditor(): void {
		const editor = this.inlineTextEditorEl;
		if (!editor) {
			return;
		}
		window.setTimeout(() => {
			if (this.inlineTextEditorEl === editor && editor.isConnected) {
				editor.focus();
				this.updateInlineTextCaretMirror();
			}
		}, 0);
	}

	private getActiveWidth(): number {
		return this.toolState.getWidth();
	}

	private getStrokePopoverTitle(): string {
		if (this.currentTool === "eraser") {
			return "Eraser thickness";
		}
		if (this.currentTool === "highlighter") {
			return "Highlighter thickness";
		}
		if (this.currentTool === "line") {
			return "Line thickness";
		}
		if (this.currentTool === "rectangle" || this.currentTool === "ellipse") {
			return "Shape thickness";
		}
		return "Pen thickness";
	}

	private getWidthRange(tool: AnnotationTool = this.currentTool): { min: number; max: number; step: number } {
		if (tool === "highlighter") {
			return TOOL_WIDTH_RANGES.highlighter;
		}
		if (tool === "eraser") {
			return TOOL_WIDTH_RANGES.eraser;
		}
		return TOOL_WIDTH_RANGES.pen;
	}
	private getSelectionWidthValue(): number {
		if (!this.annotationDocument || this.selectedTargets.length === 0) {
			return this.getActiveWidth();
		}
		const values: number[] = [];
		for (const target of this.selectedTargets) {
			if (target.kind === "stroke") {
				const stroke = this.annotationDocument.strokes.find((entry) => entry.id === target.id);
				if (stroke) {
					values.push(stroke.width);
				}
				continue;
			}
			if (target.kind === "shape") {
				const shape = this.annotationDocument.shapes.find((entry) => entry.id === target.id);
				if (shape) {
					values.push(shape.width);
				}
				continue;
			}
			const item = this.annotationDocument.textItems.find((entry) => entry.id === target.id);
			if (item) {
				values.push(Math.max(1, Math.round(item.fontSize / 4)));
			}
		}
		if (values.length === 0) {
			return this.getActiveWidth();
		}
		return Math.max(1, Math.round(values.reduce((sum, value) => sum + value, 0) / values.length));
	}

	private refreshToolPreviewFromLastPointer(active = false): void {
		if (this.currentTool !== "eraser") {
			this.hideToolPreview();
			return;
		}
		const preview = this.previewState.snapshot;
		if (preview.clientX === null || preview.clientY === null) {
			if (!active) {
				this.hideToolPreview();
			}
			return;
		}
		this.updateToolPreview(preview.clientX, preview.clientY, active);
	}

	private getToolPreviewRadius(): number {
		if (this.currentTool === "eraser") {
			return Math.max(6, this.toolState.getWidth("eraser") / 2);
		}
		return 0;
	}

	private getEraserThreshold(pageNumber: number): number {
		const surface = this.pageSurfaces.get(pageNumber);
		const pageWidth = Math.max(surface?.lastWidth ?? 1, 1);
		return (this.getToolPreviewRadius() / pageWidth);
	}

	private updateToolPreview(clientX: number, clientY: number, active = false): void {
		const viewContentEl = this.getViewContentEl();
		if (!this.toolPreviewEl || !this.annotationMode || !viewContentEl) {
			return;
		}
		this.previewState.recordPointer(clientX, clientY);
		const radius = this.getToolPreviewRadius();
		if (radius <= 0 || this.currentTool !== "eraser") {
			this.hideToolPreview();
			return;
		}
		this.previewState.show(radius, active);

		this.toolPreviewEl.classList.remove("is-hidden", "is-eraser", "is-active");
		this.toolPreviewEl.classList.add("is-eraser");
		if (active) {
			this.toolPreviewEl.classList.add("is-active");
		}
		const size = radius * 2;
		const rect = viewContentEl.getBoundingClientRect();
		this.toolPreviewEl.setCssStyles({
			width: `${size}px`,
			height: `${size}px`,
			left: `${clientX - rect.left - radius}px`,
			top: `${clientY - rect.top - radius}px`
		});
	}

	private hideToolPreview(): void {
		this.previewState.hide();
		this.toolPreviewEl?.classList.add("is-hidden");
	}
	private openShapeToolMenu(button: HTMLButtonElement): void {
		const menu = new Menu();
		const shapeTools: Array<{ tool: ShapeTool; label: string; icon: string }> = [
			{ tool: "rectangle", label: "Rectangle", icon: "square" },
			{ tool: "ellipse", label: "Ellipse", icon: "circle" },
			{ tool: "line", label: "Line", icon: "minus" }
		];
		addMenuDescriptors(menu, shapeTools.map((shape) => ({
			title: shape.label,
			icon: shape.icon,
			checked: this.currentTool === shape.tool,
			run: () => {
				this.setActiveTool(shape.tool);
				this.applyOverlayMode();
				this.refreshToolbar();
				this.refreshStatus(`Tool: ${shape.label}`);
			}
		})));
		const rect = button.getBoundingClientRect();
		this.showExclusiveMenuAtPosition(menu, { x: rect.left, y: rect.bottom + 6 });
	}

	private toggleEraserMode(): void {
		const nextMode: EraserMode = this.eraserMode === "segment" ? "object" : "segment";
		this.toolState.setEraserMode(nextMode);
		this.persistToolDefaults();
		this.refreshToolbar();
		this.refreshToolPreviewFromLastPointer(false);
		this.refreshStatus(nextMode === "object" ? "Eraser mode: whole object" : "Eraser mode: touch section");
	}

	private openSelectionMenu(button: HTMLButtonElement): void {
		const menu = new Menu();
		addMenuDescriptors(menu, ([
			{ mode: "single", title: "Single select", status: "Selection mode: single" },
			{ mode: "box", title: "Box select", status: "Selection mode: box" },
			{ mode: "lasso", title: "Freehand lasso", status: "Selection mode: lasso" }
		] as const).map((definition) => ({
			title: definition.title,
			checked: this.toolState.selectionMode === definition.mode,
			run: () => {
				this.setSelectionMode(definition.mode);
				this.refreshStatus(definition.status);
			}
		})));
		const rect = button.getBoundingClientRect();
		this.showExclusiveMenuAtPosition(menu, { x: rect.left, y: rect.bottom + 6 });
	}

	private openSelectionActionsMenu(button: HTMLButtonElement): void {
		const menu = new Menu();
		const hasAnnotationSelection = this.selectedTargets.length > 0;
		const descriptors: MenuDescriptor[] = [
			{ title: "Select all on page (Ctrl/Cmd+A)", icon: "list-plus", run: () => this.selectAllCurrentPageAnnotations() }
		];
		if (hasAnnotationSelection) {
			descriptors.push(
				menuSeparator,
				{ title: "Copy selection (Ctrl/Cmd+C)", icon: "copy", run: () => this.copySelectedTargets() },
				{ title: "Cut selection (Ctrl/Cmd+X)", icon: "scissors", run: () => this.cutSelectedTargets() },
				{ title: "Duplicate selection", icon: "copy", run: () => this.duplicateSelectedTargets() },
				{ title: "Delete selection (Del)", icon: "trash", run: () => this.deleteSelectedTargets() },
				menuSeparator,
				{ title: "Bring to front (Ctrl/Cmd+])", icon: "bring-to-front", run: () => this.reorderSelectedTargets("front") },
				{ title: "Send to back (Ctrl/Cmd+[)", icon: "send-to-back", run: () => this.reorderSelectedTargets("back") }
			);
		}
		if (this.plugin.hasClipboard()) {
			descriptors.push(
				menuSeparator,
				{ title: "Paste copied annotations (Ctrl/Cmd+V)", icon: "clipboard", run: () => this.pasteClipboard() },
				{ title: "Paste copied annotation in place (Ctrl/Cmd+Shift+V)", icon: "clipboard-copy", run: () => this.pasteClipboard(true) }
			);
		}
		addMenuDescriptors(menu, descriptors);
		const rect = button.getBoundingClientRect();
		this.showExclusiveMenuAtPosition(menu, { x: rect.left, y: rect.bottom + 6 });
	}

	private openRegionActionsMenu(button: HTMLButtonElement): void {
		const menu = new Menu();
		const region = this.lastSelectionRegion;
		if (!region) {
			addMenuDescriptors(menu, [{ title: "No active region", icon: "info", disabled: true }]);
			const emptyRect = button.getBoundingClientRect();
			this.showExclusiveMenuAtPosition(menu, { x: emptyRect.left, y: emptyRect.bottom + 6 });
			return;
		}
		addMenuDescriptors(menu, [
			{ title: "Copy region embed block", icon: "code", run: () => this.copySelectionAnnotatedEmbedBlock() },
			{ title: "Copy region reference", icon: "link", run: () => this.copySelectionRegionReference() },
			{ title: "Export region image", icon: "image-file", run: () => this.exportSelectionSnapshot() },
			{ title: "Open source page", icon: "file-text", run: () => this.goToMixedPage(region.page) },
			menuSeparator,
			{ title: "Clear region", icon: "x", run: () => this.clearRegion() }
		]);
		const rect = button.getBoundingClientRect();
		this.showExclusiveMenuAtPosition(menu, { x: rect.left, y: rect.bottom + 6 });
	}

	private applyOverlayMode(): void {
		if (!this.annotationMode || !isInkDrawingTool(this.currentTool) || this.getInkInputPolicy() !== "pen-mouse-only") {
			this.finishFingerPan(false);
		}
		for (const surface of this.pageSurfaces.values()) {
			const cursorTool = this.annotationMode ? this.currentTool : "disabled";
			const cursor = resolveOverlayModeCursor(
				cursorTool,
				surface.overlayEl.dataset.cursorTool,
				surface.overlayEl.style.cursor,
				this.getDefaultOverlayCursor()
			);
			surface.overlayEl.classList.toggle("is-enabled", this.annotationMode);
			surface.overlayEl.setCssStyles({
				pointerEvents: this.annotationMode ? "auto" : "none",
				touchAction: this.annotationMode ? this.getOverlayTouchAction() : ""
			});
			this.setOverlayCursor(surface, cursor, cursorTool);
		}
		if (!this.annotationMode) {
			this.hideToolPreview();
			return;
		}
		this.refreshToolPreviewFromLastPointer(this.currentTool === "eraser" && this.erasingSession);
	}

	private getOverlayTouchAction(): string {
		// This must be present before pointerdown. Pointer Events does not allow a
		// Pencil pan to be cancelled after WebKit has claimed the gesture. Keeping
		// only pinch zoom native preserves two-finger zoom without admitting Pencil pan.
		return "pinch-zoom";
	}

	private getInkInputPolicy(): InkInputPolicy {
		return this.plugin.getInkInputPolicy();
	}

	private toggleTabletTouchInputMode(): void {
		const touchDrawing = this.getInkInputPolicy() !== "pen-mouse-only";
		const nextPolicy: InkInputPolicy = touchDrawing ? "pen-mouse-only" : "allow-touch";
		this.forceFinishStalePdfInteraction("Input mode changed");
		void this.plugin.updateBehaviorSettings({ inkInputPolicy: nextPolicy });
		this.refreshStatus(
			nextPolicy === "allow-touch"
				? "Finger draws; Apple Pencil and mouse also draw"
				: "Finger pans; Apple Pencil and mouse draw",
			3000
		);
	}

	private readonly handleSessionKeyDown = (event: KeyboardEvent): void => {
		if (this.handleInlineTextEditorShortcut(event)) {
			event.preventDefault();
			event.stopPropagation();
			return;
		}
		if (event.key === "Escape" && this.isSessionEscapeEligible(event) && this.cancelActiveSessionInteraction()) {
			event.preventDefault();
			return;
		}
		if (event.key === "Escape" && this.isSessionEscapeEligible(event)) {
			event.preventDefault();
			event.stopPropagation();
			this.exitAnnotationModeFromEscape();
			return;
		}
		const isModifierShortcut = event.ctrlKey || event.metaKey;
		if (isModifierShortcut && this.isSessionShortcutActive(event)) {
			const key = event.key.toLowerCase();
			if (key === "z") {
				event.preventDefault();
				if (event.shiftKey) {
					this.redo();
				} else {
					this.undo();
				}
				return;
			}
			if (key === "y") {
				event.preventDefault();
				this.redo();
				return;
			}
		}
		if (!this.isSessionKeyboardActive(event)) {
			return;
		}

		if ((event.key === "Delete" || event.key === "Backspace") && this.selectedTargets.length > 0) {
			event.preventDefault();
			this.deleteSelectedTargets();
			return;
		}

		if (event.key === "Enter" && this.selectedTargets.length === 1 && this.selectedTargets[0].kind === "text") {
			event.preventDefault();
			this.beginEditingSelectedTextTarget(this.selectedTargets[0]);
			return;
		}

		if (isModifierShortcut && event.key.toLowerCase() === "a") {
			event.preventDefault();
			this.selectAllCurrentPageAnnotations();
			return;
		}
		if (isModifierShortcut && event.key.toLowerCase() === "c" && this.selectedTargets.length > 0) {
			event.preventDefault();
			this.copySelectedTargets();
			return;
		}

		if (isModifierShortcut && event.key.toLowerCase() === "x" && this.selectedTargets.length > 0) {
			event.preventDefault();
			this.cutSelectedTargets();
			return;
		}

		if (isModifierShortcut && event.key === "]" && this.selectedTargets.length > 0) {
			event.preventDefault();
			this.reorderSelectedTargets(event.shiftKey ? "front" : "forward");
			return;
		}

		if (isModifierShortcut && event.key === "[" && this.selectedTargets.length > 0) {
			event.preventDefault();
			this.reorderSelectedTargets(event.shiftKey ? "back" : "backward");
			return;
		}

		const nudgeAmount = this.getKeyboardNudgeAmount(event.shiftKey);
		const nudges: Record<string, { x: number; y: number }> = {
			ArrowLeft: { x: -nudgeAmount, y: 0 },
			ArrowRight: { x: nudgeAmount, y: 0 },
			ArrowUp: { x: 0, y: -nudgeAmount },
			ArrowDown: { x: 0, y: nudgeAmount }
		};
		const nudge = nudges[event.key];
		if (nudge && this.selectedTargets.length > 0) {
			event.preventDefault();
			this.nudgeSelectedTargets(nudge.x, nudge.y, !this.keyboardNudgeHistoryOpen);
			this.keyboardNudgeHistoryOpen = true;
		}
	};

	private handleInlineTextEditorShortcut(event: KeyboardEvent): boolean {
		const editor = this.inlineTextEditorEl;
		if (!editor || (event.target !== editor && editor.ownerDocument.activeElement !== editor)) {
			return false;
		}
		const key = event.key.toLowerCase();
		const isModifierShortcut = (event.ctrlKey || event.metaKey) && !event.altKey;
		if (key === "arrowleft" || key === "arrowright") {
			this.moveInlineTextCaretHorizontally(
				editor,
				key === "arrowleft" ? "left" : "right",
				event.shiftKey,
				isModifierShortcut || event.altKey
			);
			return true;
		}
		if (isModifierShortcut && key === "b") {
			this.setTextFontWeight(this.currentTextFontWeight === "bold" ? "normal" : "bold");
			return true;
		}
		if (isModifierShortcut && key === "i") {
			this.setTextFontStyle(this.currentTextFontStyle === "italic" ? "normal" : "italic");
			return true;
		}
		if (isModifierShortcut && key === "enter") {
			this.finishSessionInlineTextEditor(true);
			return true;
		}
		if (key === "escape") {
			this.finishSessionInlineTextEditor(false);
			return true;
		}
		return false;
	}

	private moveInlineTextCaretHorizontally(
		editor: HTMLTextAreaElement,
		direction: "left" | "right",
		extendSelection: boolean,
		byWord: boolean
	): void {
		const start = editor.selectionStart;
		const end = editor.selectionEnd;
		if (!extendSelection && start !== end) {
			const collapsedPosition = direction === "left" ? start : end;
			editor.setSelectionRange(collapsedPosition, collapsedPosition);
			this.updateInlineTextCaretMirror();
			return;
		}
		if (!extendSelection) {
			const nextPosition = getHorizontalTextCaretIndex(editor.value, start, direction, byWord);
			editor.setSelectionRange(nextPosition, nextPosition);
			this.updateInlineTextCaretMirror();
			return;
		}
		const selectionDirection = editor.selectionDirection;
		const anchor = selectionDirection === "backward" ? end : start;
		const focus = selectionDirection === "backward" ? start : end;
		const nextFocus = getHorizontalTextCaretIndex(editor.value, focus, direction, byWord);
		editor.setSelectionRange(
			Math.min(anchor, nextFocus),
			Math.max(anchor, nextFocus),
			nextFocus < anchor ? "backward" : "forward"
		);
		this.updateInlineTextCaretMirror();
	}

	private isSessionEscapeEligible(event: KeyboardEvent): boolean {
		if (!this.annotationMode || !this.isLeafActive()) {
			return false;
		}
		const target = event.target;
		if (isHtmlElement(target)) {
			if (target.isContentEditable || target.closest("input, textarea, select, [contenteditable='true']")) {
				return false;
			}
		}
		return !this.hasOpenTransientPopover();
	}

	private exitAnnotationModeFromEscape(): void {
		if (!this.annotationMode) {
			return;
		}
		this.selectedTarget = null;
		this.selectedTargets = [];
		this.lastSelectionRegion = null;
		this.activeResizeHandle = null;
		this.dragAnchor = null;
		this.toggleAnnotationMode();
	}

	private readonly handleSessionKeyUp = (event: KeyboardEvent): void => {
		if (event.key === "ArrowLeft" || event.key === "ArrowRight" || event.key === "ArrowUp" || event.key === "ArrowDown") {
			this.keyboardNudgeHistoryOpen = false;
		}
	};

	private readonly handleSessionWindowBlur = (): void => {
		this.keyboardNudgeHistoryOpen = false;
	};

	private isSessionKeyboardActive(event: KeyboardEvent): boolean {
		if (!this.annotationMode || this.currentTool !== "select" || !this.isLeafActive()) {
			return false;
		}
		return this.isSessionShortcutActive(event);
	}

	private isSessionShortcutActive(event: KeyboardEvent): boolean {
		if (!this.annotationMode || !this.isLeafActive()) {
			return false;
		}
		if (this.hasOpenTransientPopover()) {
			return false;
		}
		const target = event.target;
		if (isHtmlElement(target)) {
			if (target.isContentEditable || target.closest("input, textarea, select, [contenteditable='true']")) {
				return false;
			}
		}
		return true;
	}

	private isLeafActive(): boolean {
		return this.plugin.app.workspace.getActiveViewOfType(FileView)?.leaf === this.leaf;
	}

	private beginEditingSelectedTextTarget(target: SelectedTarget): void {
		if (!this.annotationDocument || target.kind !== "text") {
			return;
		}
		const item = this.annotationDocument.textItems.find((entry) => entry.id === target.id);
		if (!item) {
			return;
		}
		this.syncCurrentTextStyleFromItem(item);
		this.beginSessionInlineTextEditor(target.page, { x: item.x, y: item.y, pressure: 0.5 }, item);
	}

	private hasOpenTransientPopover(): boolean {
		return this.transientPopovers.hasOpen();
	}

	private getKeyboardNudgeAmount(useLargeStep: boolean): number {
		const selectedPage = this.getSelectionPage() ?? this.lastSelectionRegion?.page ?? this.currentPage;
		const surface = this.pageSurfaces.get(selectedPage);
		const minDimension = Math.min(surface?.lastWidth ?? 0, surface?.lastHeight ?? 0);
		const pixels = useLargeStep ? 10 : 2;
		if (!minDimension) {
			return useLargeStep ? 0.012 : 0.003;
		}
		return clamp(pixels / minDimension, 0.001, 0.03);
	}

	private readonly handleViewPointerMove = (event: PointerEvent): void => {
		if (!this.annotationMode) {
			return;
		}
		if (
			this.fingerPanPointerId === event.pointerId ||
			shouldPanInkPointerEvent(event, this.currentTool, this.getInkInputPolicy())
		) {
			this.hideToolPreview();
			return;
		}
		if (this.currentTool === "eraser") {
			this.updateToolPreview(event.clientX, event.clientY, this.erasingSession);
		}
		this.updateOverlayCursorForPointer(event);
	};

	private readonly handleViewPointerLeave = (): void => {
		if (!this.erasingSession) {
			this.hideToolPreview();
		}
		for (const surface of this.pageSurfaces.values()) {
			this.setOverlayCursor(surface, this.getDefaultOverlayCursor());
		}
	};

	private getDefaultOverlayCursor(): string {
		if (!this.annotationMode) {
			return "default";
		}
		if (this.currentTool === "eraser") {
			return "cell";
		}
		return "crosshair";
	}

	private setOverlayCursor(
		surface: PageSurface,
		cursor: string,
		cursorTool: AnnotationTool | "disabled" = this.currentTool
	): void {
		if (surface.overlayEl.style.cursor !== cursor) {
			surface.overlayEl.setCssStyles({ cursor });
		}
		surface.overlayEl.dataset.cursorTool = cursorTool;
	}

	private getSelectedRegionHit(pageNumber: number, point: AnnotationPoint): SelectedTarget | null {
		const pageTargets = this.selectedTargets.filter((target) => target.page === pageNumber);
		const selectedBounds = this.getCombinedBounds(pageTargets);
		return selectedBounds && pointInBounds(point, selectedBounds) ? (pageTargets[0] ?? null) : null;
	}

	private getSelectionCursorAtPoint(surface: PageSurface, point: AnnotationPoint): string {
		if (this.pointerPage === surface.pageNumber && this.dragAnchor && this.selectedTargets.length > 0) {
			return this.activeResizeHandle ? this.getCursorForHandle(this.activeResizeHandle) : "grabbing";
		}
		const handle = this.selectedTargets.length > 0
			? this.getSelectionHandleHit(surface.pageNumber, point)
			: null;
		if (handle) {
			return this.getCursorForHandle(handle);
		}
		const hit = this.getSelectedTargetHit(surface.pageNumber, point)
			?? this.getSelectedRegionHit(surface.pageNumber, point)
			?? this.findSelectableTarget(surface.pageNumber, point);
		return hit ? "move" : "crosshair";
	}

	private updateOverlayCursorForPointer(event: PointerEvent): void {
		const surface = this.getSurfaceAtClientPoint(event.clientX, event.clientY);
		if (!surface) {
			return;
		}
		const rect = surface.overlayEl.getBoundingClientRect();
		const point: AnnotationPoint = {
			x: clamp((event.clientX - rect.left) / Math.max(rect.width, 1), 0, 1),
			y: clamp((event.clientY - rect.top) / Math.max(rect.height, 1), 0, 1),
			pressure: 0.5
		};
		let cursor = this.getDefaultOverlayCursor();
		if (this.currentTool === "select") {
			cursor = this.getSelectionCursorAtPoint(surface, point);
		} else if (this.currentTool === "text") {
			cursor = this.findSelectableTarget(surface.pageNumber, point)?.kind === "text"
				? "text"
				: "crosshair";
		}
		this.setOverlayCursor(surface, cursor);
	}

	private readonly handleViewPointerDown = (event: PointerEvent): void => {
		if (shouldPanInkPointerEvent(event, this.currentTool, this.getInkInputPolicy())) {
			return;
		}
		this.handleFallbackPointerDown(event);
	};

	private readonly handleZoomGestureTouchStart = (event: TouchEvent): void => {
		if (event.touches.length < 2) {
			return;
		}
		this.captureZoomScrollAnchor();
	};

	private readonly handleZoomGestureWheel = (event: WheelEvent): void => {
		if (!isTrackpadPinchWheel(event)) {
			return;
		}
		this.captureZoomScrollAnchor();
	};

	private readonly handleZoomGestureStart = (): void => {
		this.captureZoomScrollAnchor();
	};

	private readonly handleDocumentPointerDown = (event: PointerEvent): void => {
		if (this.handleFingerPanPointerDown(event)) {
			return;
		}
		if (this.handleCapturedInkPointerDown(event)) {
			return;
		}
		this.handleFallbackPointerDown(event);
	};

	private rememberPotentialWebKitStylusPointer(event: PointerEvent): void {
		this.clearPendingWebKitTouchPointer();
		this.pendingWebKitTouchPointer = event;
		this.pendingWebKitTouchHandle = window.setTimeout(() => {
			this.pendingWebKitTouchHandle = null;
			this.pendingWebKitTouchPointer = null;
		}, 350);
	}

	private clearPendingWebKitTouchPointer(): void {
		if (this.pendingWebKitTouchHandle !== null) {
			window.clearTimeout(this.pendingWebKitTouchHandle);
			this.pendingWebKitTouchHandle = null;
		}
		this.pendingWebKitTouchPointer = null;
	}

	private readonly handleDocumentTouchStart = (event: TouchEvent): void => {
		const pendingPointer = this.pendingWebKitTouchPointer;
		const touches = Array.from(event.changedTouches) as Array<Touch & {
			altitudeAngle?: number;
			azimuthAngle?: number;
			force?: number;
			radiusX?: number;
			radiusY?: number;
			touchType?: string;
		}>;
		const matchingTouch = pendingPointer
			? touches.find((touch) => Math.hypot(
				pendingPointer.clientX - touch.clientX,
				pendingPointer.clientY - touch.clientY
			) <= 32) ?? null
			: null;
		if (!pendingPointer || !matchingTouch || !this.annotationMode || this.getInkInputPolicy() !== "pen-mouse-only") {
			this.clearPendingWebKitTouchPointer();
			return;
		}
		const target = isDomElement(event.target) ? event.target : null;
		if (!target || !this.isPointerTargetInsidePdfPage(target)) {
			this.clearPendingWebKitTouchPointer();
			return;
		}
		event.preventDefault();
		event.stopImmediatePropagation();
		const stylusTouch = isWebKitStylusTouch(
			matchingTouch as Touch & {
				altitudeAngle?: number;
				azimuthAngle?: number;
				force?: number;
				radiusX?: number;
				radiusY?: number;
				touchType?: string;
			}
		);
		this.clearPendingWebKitTouchPointer();
		if (!stylusTouch) {
			return;
		}
		this.finishFingerPan(false);
		const surface = this.ensureSurfaceAtClientPoint(matchingTouch.clientX, matchingTouch.clientY);
		if (!surface) {
			this.scheduleSyncPages();
			return;
		}
		this.handlePointerDownForCanvas(pendingPointer, surface.overlayEl, true);
	};

	private handleFingerPanPointerDown(event: PointerEvent): boolean {
		if (
			!this.annotationMode ||
			this.activePdfPointerId !== null ||
			this.fingerPanPointerId !== null ||
			!shouldPanInkPointerEvent(event, this.currentTool, this.getInkInputPolicy())
		) {
			return false;
		}
		const target = isDomElement(event.target) ? event.target : null;
		const viewContentEl = this.getViewContentEl();
		if (!target || !viewContentEl?.contains(target) || !this.isPointerTargetInsidePdfPage(target)) {
			return false;
		}
		const surface = this.ensureSurfaceAtClientPoint(event.clientX, event.clientY);
		if (!surface) {
			return false;
		}
		const scrollEl = this.scrollParent?.isConnected ? this.scrollParent : findScrollParent(surface.pageEl);
		event.preventDefault();
		event.stopImmediatePropagation();
		this.hideToolPreview();
		this.cancelFingerPanInertia();
		this.rememberPotentialWebKitStylusPointer(event);
		this.fingerPanPointerId = event.pointerId;
		this.fingerPanCanvas = surface.overlayEl;
		this.fingerPanScrollEl = scrollEl;
		this.fingerPanLastPoint = {
			clientX: event.clientX,
			clientY: event.clientY,
			time: event.timeStamp || performance.now()
		};
		this.fingerPanPendingDelta = { x: 0, y: 0 };
		this.fingerPanVelocity = { x: 0, y: 0 };
		this.pauseCommittedRenderingForViewportMotion();
		try {
			surface.overlayEl.setPointerCapture(event.pointerId);
		} catch {
			// Document capture keeps the gesture active when WebKit declines capture.
		}
		document.addEventListener("pointermove", this.handleFingerPanPointerMove, true);
		document.addEventListener("pointerup", this.handleFingerPanPointerUp, true);
		document.addEventListener("pointercancel", this.handleFingerPanPointerCancel, true);
		return true;
	}

	private readonly handleFingerPanPointerMove = (event: PointerEvent): void => {
		if (event.pointerId !== this.fingerPanPointerId || !this.fingerPanLastPoint) {
			return;
		}
		event.preventDefault();
		event.stopImmediatePropagation();
		const now = event.timeStamp || performance.now();
		const deltaTime = Math.max(1, now - this.fingerPanLastPoint.time);
		const deltaX = this.fingerPanLastPoint.clientX - event.clientX;
		const deltaY = this.fingerPanLastPoint.clientY - event.clientY;
		this.fingerPanPendingDelta.x += deltaX;
		this.fingerPanPendingDelta.y += deltaY;
		this.fingerPanVelocity.x = this.fingerPanVelocity.x * 0.68 + (deltaX / deltaTime) * 0.32;
		this.fingerPanVelocity.y = this.fingerPanVelocity.y * 0.68 + (deltaY / deltaTime) * 0.32;
		this.fingerPanLastPoint = { clientX: event.clientX, clientY: event.clientY, time: now };
		if (this.fingerPanFrameHandle === null) {
			this.fingerPanFrameHandle = window.requestAnimationFrame(() => {
				this.fingerPanFrameHandle = null;
				this.applyPendingFingerPan();
			});
		}
	};

	private applyPendingFingerPan(): void {
		const scrollEl = this.fingerPanScrollEl;
		if (!scrollEl) {
			return;
		}
		const deltaX = this.fingerPanPendingDelta.x;
		const deltaY = this.fingerPanPendingDelta.y;
		this.fingerPanPendingDelta = { x: 0, y: 0 };
		// Browsers clamp scroll positions natively. Avoid querying scroll geometry here,
		// because those reads force WebKit to lay out the full PDF on every pan frame.
		scrollEl.scrollLeft += deltaX;
		scrollEl.scrollTop += deltaY;
	}

	private readonly handleFingerPanPointerUp = (event: PointerEvent): void => {
		if (event.pointerId !== this.fingerPanPointerId) {
			return;
		}
		event.preventDefault();
		event.stopImmediatePropagation();
		this.finishFingerPan(true);
	};

	private readonly handleFingerPanPointerCancel = (event: PointerEvent): void => {
		if (event.pointerId !== this.fingerPanPointerId) {
			return;
		}
		event.preventDefault();
		event.stopImmediatePropagation();
		this.finishFingerPan(false);
	};

	private finishFingerPan(startInertia: boolean): void {
		if (this.fingerPanFrameHandle !== null) {
			window.cancelAnimationFrame(this.fingerPanFrameHandle);
			this.fingerPanFrameHandle = null;
		}
		if (startInertia) {
			this.applyPendingFingerPan();
		} else {
			this.fingerPanPendingDelta = { x: 0, y: 0 };
		}
		document.removeEventListener("pointermove", this.handleFingerPanPointerMove, true);
		document.removeEventListener("pointerup", this.handleFingerPanPointerUp, true);
		document.removeEventListener("pointercancel", this.handleFingerPanPointerCancel, true);
		if (this.fingerPanCanvas && this.fingerPanPointerId !== null) {
			try {
				this.fingerPanCanvas.releasePointerCapture(this.fingerPanPointerId);
			} catch {
				// WebKit may release capture before pointercancel reaches the document.
			}
		}
		const scrollEl = this.fingerPanScrollEl;
		const velocity = { ...this.fingerPanVelocity };
		this.fingerPanPointerId = null;
		this.fingerPanCanvas = null;
		this.fingerPanScrollEl = null;
		this.fingerPanLastPoint = null;
		this.fingerPanPendingDelta = { x: 0, y: 0 };
		this.fingerPanVelocity = { x: 0, y: 0 };
		this.clearPendingWebKitTouchPointer();
		if (startInertia && scrollEl && Math.hypot(velocity.x, velocity.y) >= 0.04) {
			this.startFingerPanInertia(scrollEl, velocity.x, velocity.y);
		} else {
			this.resumeCommittedRenderingAfterFingerPan();
		}
	}

	private startFingerPanInertia(scrollEl: HTMLElement, velocityX: number, velocityY: number): void {
		this.cancelFingerPanInertia();
		let lastTime = performance.now();
		const step = (now: number): void => {
			const deltaTime = Math.min(32, Math.max(1, now - lastTime));
			lastTime = now;
			const previousScrollLeft = scrollEl.scrollLeft;
			const previousScrollTop = scrollEl.scrollTop;
			scrollEl.scrollLeft += velocityX * deltaTime;
			scrollEl.scrollTop += velocityY * deltaTime;
			if (scrollEl.scrollLeft === previousScrollLeft) {
				velocityX = 0;
			}
			if (scrollEl.scrollTop === previousScrollTop) {
				velocityY = 0;
			}
			const damping = Math.pow(0.9, deltaTime / 16.67);
			velocityX *= damping;
			velocityY *= damping;
			if (Math.hypot(velocityX, velocityY) < 0.02 || !scrollEl.isConnected) {
				this.fingerPanInertiaHandle = null;
				this.resumeCommittedRenderingAfterFingerPan();
				return;
			}
			this.fingerPanInertiaHandle = window.requestAnimationFrame(step);
		};
		this.fingerPanInertiaHandle = window.requestAnimationFrame(step);
	}

	private cancelFingerPanInertia(): void {
		if (this.fingerPanInertiaHandle !== null) {
			window.cancelAnimationFrame(this.fingerPanInertiaHandle);
			this.fingerPanInertiaHandle = null;
		}
	}

	private handleCapturedInkPointerDown(event: PointerEvent): boolean {
		if (!this.annotationMode || !shouldCaptureInkPointerEvent(event, this.currentTool, this.getInkInputPolicy())) {
			return false;
		}
		if (this.fingerPanPointerId !== null) {
			this.finishFingerPan(false);
		}
		const target = isDomElement(event.target) ? event.target : null;
		const viewContentEl = this.getViewContentEl();
		if (!target || !viewContentEl?.contains(target)) {
			return false;
		}
		let canvas = target.closest<HTMLCanvasElement>(`.${OVERLAY_CLASS}`) ?? null;
		if (!canvas && this.isPointerTargetInsidePdfPage(target)) {
			canvas = this.ensureSurfaceAtClientPoint(event.clientX, event.clientY)?.overlayEl ?? null;
		}
		if (!canvas || !isHtmlCanvasElement(canvas) || !viewContentEl.contains(canvas)) {
			return false;
		}

		// Claim Pencil input before the native PDF viewer can start a pan gesture.
		event.preventDefault();
		event.stopImmediatePropagation();
		if (this.activePdfPointerId === null) {
			this.handlePointerDownForCanvas(event, canvas);
		}
		return true;
	}

	private handleFallbackPointerDown(event: PointerEvent): void {
		if (!this.annotationMode || this.pointerPage !== null) {
			return;
		}
		const target = isDomElement(event.target) ? event.target : null;
		if (!target || target.closest(`.${SESSION_ROOT_CLASS}, ${TOOLBAR_SELECTORS}, .menu, .menu-item, .modal, .modal-container, .popover, .suggestion-container, .prompt, .pdf-native-annotator-popover-backdrop, .pdf-native-annotator-color-popover, .pdf-native-annotator-confirm-popover, .pdf-native-annotator-rename-popover, .pdf-native-annotator-font-popover, .pdf-native-annotator-stroke-popover, .pdf-native-annotator-page-list-popover, .pdf-native-annotator-inline-text-frame, .pdf-native-annotator-inline-text-editor, .pdf-native-annotator-inline-text-handle`)) {
			return;
		}
		if (target.closest(`.${OVERLAY_CLASS}`)) {
			return;
		}
		if (!this.isPointerTargetInsidePdfPage(target)) {
			return;
		}
		const surface = this.ensureSurfaceAtClientPoint(event.clientX, event.clientY);
		if (!surface) {
			this.refreshStatus(`Could not start ink: no page surface at pointer (${this.pageSurfaces.size} registered)`, 4000);
			this.scheduleSyncPages();
			return;
		}
		if (shouldIgnoreInkPointerEvent(event, this.currentTool, this.getInkInputPolicy())) {
			return;
		}
		event.preventDefault();
		event.stopImmediatePropagation();
		this.handlePointerDownForCanvas(event, surface.overlayEl);
	}

	private isPointerTargetInsidePdfPage(target: Element): boolean {
		const viewContentEl = this.getViewContentEl();
		if (!viewContentEl?.contains(target)) {
			return false;
		}
		const pageEl = target.closest<HTMLElement>(
			".page[data-page-number], .pdf-page[data-page-number], .pdf-native-annotator-synthetic-page[data-page-number]"
		);
		return !!pageEl && viewContentEl.contains(pageEl);
	}

	private getSurfaceAtClientPoint(clientX: number, clientY: number): PageSurface | null {
		let bestSurface: PageSurface | null = null;
		let bestArea = Number.POSITIVE_INFINITY;
		for (const surface of this.pageSurfaces.values()) {
			if (!surface.overlayEl.isConnected || window.getComputedStyle(surface.overlayEl).visibility === "hidden") {
				continue;
			}
			const rect = surface.overlayEl.getBoundingClientRect();
			if (
				clientX < rect.left ||
				clientX > rect.right ||
				clientY < rect.top ||
				clientY > rect.bottom
			) {
				continue;
			}
			const area = Math.max(1, rect.width * rect.height);
			if (area < bestArea) {
				bestArea = area;
				bestSurface = surface;
			}
		}
		return bestSurface;
	}

	private ensureSurfaceAtClientPoint(clientX: number, clientY: number): PageSurface | null {
		const existing = this.getSurfaceAtClientPoint(clientX, clientY);
		if (existing) {
			return existing;
		}
		const pageEntry = this.getPageElementAtClientPoint(clientX, clientY);
		if (!pageEntry) {
			return null;
		}
		try {
			this.ensurePageSurface(pageEntry.pageEl, pageEntry.pageNumber);
		} catch (error) {
			console.error(`freedraw-pdf: failed to create page surface for page ${pageEntry.pageNumber}`, error);
			return null;
		}
		this.applyOverlayMode();
		return this.pageSurfaces.get(pageEntry.pageNumber) ?? null;
	}

	private getPageElementAtClientPoint(clientX: number, clientY: number): { pageEl: HTMLElement; pageNumber: number } | null {
		const viewContentEl = this.getViewContentEl();
		if (!viewContentEl) {
			return null;
		}
		let bestEntry: { pageEl: HTMLElement; pageNumber: number; area: number } | null = null;
		const primaryViewerEl = this.getPrimaryPdfViewerEl(viewContentEl);
		const realPageEls = primaryViewerEl
			? Array.from(primaryViewerEl.querySelectorAll<HTMLElement>(".page[data-page-number], .pdf-page[data-page-number]"))
			: Array.from(viewContentEl.querySelectorAll<HTMLElement>(PAGE_SELECTORS));
		const syntheticPageEls = Array.from(viewContentEl.querySelectorAll<HTMLElement>(".pdf-native-annotator-synthetic-page[data-page-number]"));
		for (const pageEl of [...realPageEls, ...syntheticPageEls]) {
			if (pageEl.classList.contains("pdf-native-annotator-synthetic-page") && !pageEl.dataset.pageNumber) {
				continue;
			}
			const pageNumber = Number(pageEl.dataset.pageNumber);
			if (!Number.isFinite(pageNumber) || pageNumber <= 0) {
				continue;
			}
			const rect = pageEl.getBoundingClientRect();
			if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) {
				continue;
			}
			const area = Math.max(1, rect.width * rect.height);
			if (!bestEntry || area < bestEntry.area) {
				bestEntry = { pageEl, pageNumber, area };
			}
		}
		return bestEntry ? { pageEl: bestEntry.pageEl, pageNumber: bestEntry.pageNumber } : null;
	}
	private readonly handlePointerDown = (event: PointerEvent): void => {
		if (this.activePdfPointerId !== null) {
			if (this.activePdfPointerId !== event.pointerId) {
				event.preventDefault();
				event.stopPropagation();
			}
			return;
		}
		const canvas = isHtmlCanvasElement(event.currentTarget) ? event.currentTarget : null;
		if (!canvas) {
			this.refreshStatus("Could not start ink: pointer target is not the annotator canvas", 4000);
			return;
		}
		this.handlePointerDownForCanvas(event, canvas);
	};

	private handlePointerDownForCanvas(event: PointerEvent, canvas: HTMLCanvasElement, forceWebKitStylus = false): void {
		if (!this.annotationMode) {
			this.refreshStatus("Could not start ink: annotation mode is off", 4000);
			return;
		}
		if (!this.annotationDocument) {
			this.refreshStatus("Could not start ink: annotation document is not loaded yet", 4000);
			return;
		}

		const pageNumber = Number(canvas.dataset.pageNumber);
		if (!Number.isFinite(pageNumber) || pageNumber <= 0) {
			this.refreshStatus("Could not start ink: page number is missing from the overlay", 4000);
			this.scheduleSyncPages();
			return;
		}
		const surface = this.pageSurfaces.get(pageNumber);
		if (!surface) {
			this.refreshStatus(`Could not start ink: page ${pageNumber} surface is not ready`, 4000);
			this.scheduleSyncPages();
			return;
		}
		canvas.setCssStyles({ touchAction: this.getOverlayTouchAction() });
		if (!forceWebKitStylus && shouldIgnoreInkPointerEvent(event, this.currentTool, this.getInkInputPolicy())) {
			return;
		}
		event.preventDefault();
		const isInkInput = isInkDrawingTool(this.currentTool);
		if (isInkInput) {
			canvas.setCssStyles({ touchAction: "none" });
			this.pauseCommittedRenderingForInkInput();
		}
		this.forceFinishStalePdfInteraction("New stroke recovered previous input");
		this.webKitStylusPointerId = forceWebKitStylus ? event.pointerId : null;

		this.currentPage = pageNumber;
		if (!isInkInput) {
			this.refreshToolbar();
		}
		this.lastPdfPoint = null;
		this.lastPdfPointTime = 0;
		const pointerRect = surface.overlayEl.getBoundingClientRect();
		const point = this.getNormalizedPointFromRect(pointerRect, event);
		if (isInkDrawingTool(this.currentTool)) {
			this.renderTelemetry.recordPointerDown(this.currentTool, pageNumber, event);
		}
		if (this.inlineTextEditorEl) {
			this.finishSessionInlineTextEditor(true);
		}
		if (this.currentTool === "eraser") {
			this.updateToolPreview(event.clientX, event.clientY, true);
		}

		try {
			canvas.setPointerCapture(event.pointerId);
		} catch (error) {
			console.warn("freedraw-pdf: pointer capture unavailable", error);
		}
		this.bindPdfPointerDocumentTracking(event.pointerId, canvas, pointerRect, forceWebKitStylus);

		if (this.currentTool === "select") {
			const handle = this.getSelectionHandleHit(pageNumber, point);
			if (this.selectedTargets.length > 0 && handle) {
				this.pushHistory();
				this.dragAnchor = point;
				this.dragMoved = false;
				this.activeResizeHandle = handle;
				this.pointerPage = pageNumber;
				this.setOverlayCursor(surface, this.getCursorForHandle(handle));
				this.refreshStatus("Resize handle selected");
				return;
			}
			const selectedHit = this.getSelectedTargetHit(pageNumber, point)
				?? this.getSelectedRegionHit(pageNumber, point);
			if (this.selectedTargets.length > 0 && selectedHit) {
				this.pushHistory();
				this.dragAnchor = point;
				this.dragMoved = false;
				this.activeResizeHandle = null;
				this.pointerPage = pageNumber;
				this.setOverlayCursor(surface, "grabbing");
				this.selectedTarget = selectedHit;
				this.refreshStatus(this.selectedTargets.length > 1 ? `Moving ${this.selectedTargets.length} selections` : "Moving selection");
				return;
			}
			if (this.toolState.selectionMode === "box") {
				this.lastSelectionRegion = null;
				this.currentLasso = { page: pageNumber, points: getSelectionBoxPoints(point, point) };
				this.dragAnchor = point;
				this.dragMoved = false;
				this.activeResizeHandle = null;
				this.pointerPage = pageNumber;
				this.drawPageAnnotations(pageNumber);
				this.refreshStatus("Drag box select");
				return;
			}
			if (this.toolState.selectionMode === "lasso") {
				this.lastSelectionRegion = null;
				this.currentLasso = { page: pageNumber, points: [point] };
				this.dragAnchor = null;
				this.pointerPage = pageNumber;
				this.drawPageAnnotations(pageNumber);
				this.refreshStatus("Tracing lasso");
				return;
			}
			const hit = this.findSelectableTarget(pageNumber, point);
			if (!hit) {
				this.selectedTarget = null;
				this.selectedTargets = [];
				this.dragAnchor = null;
				this.activeResizeHandle = null;
				this.drawPageAnnotations(pageNumber);
				this.refreshStatus("Nothing selected");
				return;
			}
			this.pushHistory();
			const shouldToggleSelection = event.shiftKey || event.ctrlKey || event.metaKey;
			if (shouldToggleSelection) {
				const existing = this.selectedTargets.find((target) => target.id === hit.id && target.kind === hit.kind && target.page === hit.page);
				this.selectedTargets = existing
					? this.selectedTargets.filter((target) => !(target.id === hit.id && target.kind === hit.kind && target.page === hit.page))
					: [...this.selectedTargets, hit];
				this.selectedTarget = this.selectedTargets[0] ?? null;
			} else {
				this.selectedTarget = hit;
				this.selectedTargets = [hit];
			}
			this.lastSelectionRegion = null;
			this.dragAnchor = point;
			this.dragMoved = false;
			this.activeResizeHandle = null;
			this.pointerPage = pageNumber;
			this.setOverlayCursor(surface, "grabbing");
			this.drawPageAnnotations(pageNumber);
			this.refreshStatus(this.selectedTargets.length > 1 ? `Selected ${this.selectedTargets.length} objects` : `Selected ${hit.kind}`);
			return;
		}

		if (this.currentTool === "region") {
			this.lastSelectionRegion = null;
			this.currentLasso = { page: pageNumber, points: getSelectionBoxPoints(point, point) };
			this.dragAnchor = point;
			this.dragMoved = false;
			this.activeResizeHandle = null;
			this.pointerPage = pageNumber;
			this.drawPageAnnotations(pageNumber);
			this.refreshStatus("Drag region crop box");
			return;
		}

		if (this.currentTool === "text") {
			const hit = this.findSelectableTarget(pageNumber, point);
			if (hit?.kind === "text" && this.annotationDocument) {
				const existing = this.annotationDocument.textItems.find((entry) => entry.id === hit.id);
				if (existing) {
					try {
						canvas.releasePointerCapture(event.pointerId);
					} catch {
						// noop
					}
					this.unbindPdfPointerDocumentTracking();
					this.selectedTarget = hit;
					this.selectedTargets = [hit];
					this.lastSelectionRegion = null;
					this.syncCurrentTextStyleFromItem(existing);
					this.beginSessionInlineTextEditor(pageNumber, { x: existing.x, y: existing.y, pressure: point.pressure }, existing);
					return;
				}
			}
			this.selectedTarget = null;
			this.selectedTargets = [];
			this.lastSelectionRegion = null;
			this.currentLasso = { page: pageNumber, points: getSelectionBoxPoints(point, point) };
			this.dragAnchor = point;
			this.dragMoved = false;
			this.pointerPage = pageNumber;
			this.drawPageAnnotations(pageNumber);
			this.refreshStatus("Drag to draw a text box, release to type");
			return;
		}

		if (this.currentTool === "eraser") {
			this.pushHistory();
			this.erasingSession = true;
			this.lastEraserPoint = point;
			this.eraserSessionPoints = [point];
			this.objectErasePreviewTargets.clear();
			this.pointerPage = pageNumber;
			if (this.eraserMode === "object") {
				this.previewObjectErase(pageNumber, point, point);
			} else {
				this.retainTouchErasePixels(pageNumber);
				this.eraseCommittedLayerAtPoint(surface, point);
			}
			this.refreshStatus(`Erasing (${this.eraserMode})`);
			return;
		}

		if (isShapeTool(this.currentTool)) {
			this.pushHistory();
			const zIndex = this.getNextPageZIndex(pageNumber);
			this.currentShape = {
				id: generateId("shape"),
				page: pageNumber,
				tool: this.currentTool,
				color: this.currentColor,
				width: this.toolState.getWidth("pen"),
				widthScale: this.getStableAnnotationWidthScale(this.toolState.getWidth("pen")),
				start: point,
				end: point,
				zIndex,
				createdAt: new Date().toISOString()
			};
			this.pointerPage = pageNumber;
			this.drawPageAnnotations(pageNumber);
			return;
		}

		const strokeWidth = this.currentTool === "highlighter" ? this.toolState.getWidth("highlighter") : this.toolState.getWidth("pen");
		const zIndex = this.getNextPageZIndex(pageNumber);
		this.currentStroke = {
			id: generateId("stroke"),
			page: pageNumber,
			tool: this.currentTool,
			color: this.currentColor,
			width: strokeWidth,
			widthScale: this.getStableAnnotationWidthScale(strokeWidth),
			points: [point],
			zIndex,
			createdAt: new Date().toISOString()
		};
		this.currentStrokeRenderedPointCount = 0;
		this.pointerPage = pageNumber;
		this.drawTransientPageAnnotations(pageNumber);
		this.showDrawingNotice(`New stroke on page ${pageNumber}`, 900);
		this.refreshStatus(`Stroke started: ${this.currentTool}, page ${pageNumber}, points 1`, 900);
	}

	private hasActivePdfPointerInteraction(): boolean {
		return !!(
			this.currentStroke ||
			this.currentShape ||
			this.currentLasso ||
			this.dragAnchor ||
			this.activeResizeHandle ||
			this.erasingSession
		);
	}

	private resetStalePdfPointerInteraction(): void {
		if (this.hasActivePdfPointerInteraction()) {
			return;
		}
		if (this.pointerPage !== null || this.activePdfPointerId !== null || this.activePdfPointerCanvas !== null) {
			this.unbindPdfPointerDocumentTracking();
			this.pointerPage = null;
			this.lastEraserPoint = null;
			this.eraserSessionPoints = [];
			this.dragMoved = false;
		}
	}

	private forceFinishStalePdfInteraction(message: string): void {
		this.finishFingerPan(false);
		this.cancelFingerPanInertia();
		if (!this.hasActivePdfPointerInteraction()) {
			this.resetStalePdfPointerInteraction();
			return;
		}
		this.freezeCurrentStrokeAtRenderedFrame();
		const pageNumber = this.pointerPage ?? this.currentStroke?.page ?? this.currentShape?.page ?? this.currentLasso?.page ?? this.currentPage;
		if (this.currentStroke && this.annotationDocument && this.currentStroke.points.length > 0) {
			const committedStroke = this.currentStroke;
			const pointCount = this.currentStroke.points.length;
			this.pushStrokeAddHistory(this.currentStroke);
			this.annotationDocument.strokes.push(this.currentStroke);
			const strokeCount = this.annotationDocument.strokes.length;
			const pageNumber = committedStroke.page;
			this.promoteCurrentTransientPreview(pageNumber);
			this.currentStroke = null;
			this.currentShape = null;
			this.currentLasso = null;
			this.dragAnchor = null;
			this.activeResizeHandle = null;
			this.erasingSession = false;
			this.lastEraserPoint = null;
			this.eraserSessionPoints = [];
			this.pointerPage = null;
			this.dragMoved = false;
			this.unbindPdfPointerDocumentTracking();
			this.invalidateAnnotationPageCache();
			this.isDirty = true;
			this.scheduleSave();
			this.retainCommittedPagePixels(pageNumber);
			this.showDrawingNotice(`Stroke recorded (${pointCount} points, ${strokeCount} total)`, 1400);
			this.refreshStatus(`${message} (${pointCount} points, ${strokeCount} strokes)`);
			return;
		}
		if (this.currentShape && this.annotationDocument) {
			this.annotationDocument.shapes.push(this.currentShape);
			this.currentStroke = null;
			this.currentShape = null;
			this.currentLasso = null;
			this.dragAnchor = null;
			this.activeResizeHandle = null;
			this.erasingSession = false;
			this.lastEraserPoint = null;
			this.eraserSessionPoints = [];
			this.pointerPage = null;
			this.dragMoved = false;
			this.unbindPdfPointerDocumentTracking();
			this.markDirtyAndRedraw(message);
			return;
		}
		this.currentStroke = null;
		this.currentShape = null;
		this.currentLasso = null;
		this.dragAnchor = null;
		this.activeResizeHandle = null;
		this.erasingSession = false;
		this.lastEraserPoint = null;
		this.eraserSessionPoints = [];
		this.pointerPage = null;
		this.dragMoved = false;
		this.unbindPdfPointerDocumentTracking();
		if (pageNumber) {
			this.drawPageAnnotations(pageNumber);
		}
	}

	private commitActiveInkBeforeLayoutRefresh(): void {
		if (!this.annotationDocument) {
			return;
		}
		this.freezeCurrentStrokeAtRenderedFrame();
		if (this.currentStroke && this.currentStroke.points.length > 0) {
			const committedStroke = this.currentStroke;
			const pointCount = this.currentStroke.points.length;
			this.pushStrokeAddHistory(this.currentStroke);
			this.annotationDocument.strokes.push(this.currentStroke);
			const strokeCount = this.annotationDocument.strokes.length;
			const pageNumber = committedStroke.page;
			this.promoteCurrentTransientPreview(pageNumber);
			this.currentStroke = null;
			this.currentShape = null;
			this.currentLasso = null;
			this.dragAnchor = null;
			this.activeResizeHandle = null;
			this.erasingSession = false;
			this.lastEraserPoint = null;
			this.eraserSessionPoints = [];
			this.pointerPage = null;
			this.dragMoved = false;
			this.unbindPdfPointerDocumentTracking();
			this.invalidateAnnotationPageCache();
			this.isDirty = true;
			this.scheduleSave();
			this.retainCommittedPagePixels(pageNumber);
			this.showDrawingNotice(`Stroke recorded before layout refresh (${pointCount} points, ${strokeCount} total)`, 1600);
			this.refreshStatus(`Stroke recorded before layout refresh (${pointCount} points, ${strokeCount} strokes)`, 1200);
			return;
		}
		if (this.currentShape) {
			this.annotationDocument.shapes.push(this.currentShape);
			const pageNumber = this.currentShape.page;
			this.currentStroke = null;
			this.currentShape = null;
			this.currentLasso = null;
			this.dragAnchor = null;
			this.activeResizeHandle = null;
			this.erasingSession = false;
			this.lastEraserPoint = null;
			this.eraserSessionPoints = [];
			this.pointerPage = null;
			this.dragMoved = false;
			this.unbindPdfPointerDocumentTracking();
			this.invalidateAnnotationPageCache();
			this.isDirty = true;
			this.scheduleSave();
			this.drawPageAnnotations(pageNumber);
		}
	}

	private bindPdfPointerDocumentTracking(pointerId: number, canvas: HTMLCanvasElement, pointerRect: DOMRect, forceWebKitStylus = false): void {
		this.unbindPdfPointerDocumentTracking();
		this.activePdfPointerId = pointerId;
		this.activePdfPointerCanvas = canvas;
		this.activePdfPointerRect = pointerRect;
		this.webKitStylusPointerId = forceWebKitStylus ? pointerId : null;
		document.addEventListener("pointermove", this.handleDocumentPointerMove, true);
		document.addEventListener("pointerup", this.handleDocumentPointerUp, true);
		document.addEventListener("pointercancel", this.handleDocumentPointerCancel, true);
	}

	private unbindPdfPointerDocumentTracking(): void {
		document.removeEventListener("pointermove", this.handleDocumentPointerMove, true);
		document.removeEventListener("pointerup", this.handleDocumentPointerUp, true);
		document.removeEventListener("pointercancel", this.handleDocumentPointerCancel, true);
		this.activePdfPointerId = null;
		this.activePdfPointerCanvas = null;
		this.activePdfPointerRect = null;
		this.webKitStylusPointerId = null;
	}

	private shouldHandleDocumentPointer(event: PointerEvent): boolean {
		return this.activePdfPointerId === event.pointerId && this.activePdfPointerCanvas !== null;
	}

	private readonly handleDocumentPointerMove = (event: PointerEvent): void => {
		if (!this.shouldHandleDocumentPointer(event) || !this.activePdfPointerCanvas) {
			return;
		}
		event.preventDefault();
		event.stopImmediatePropagation();
		this.handlePointerMoveForCanvas(event, this.activePdfPointerCanvas);
	};

	private readonly handleDocumentPointerUp = (event: PointerEvent): void => {
		if (!this.shouldHandleDocumentPointer(event) || !this.activePdfPointerCanvas) {
			return;
		}
		const canvas = this.activePdfPointerCanvas;
		event.preventDefault();
		event.stopImmediatePropagation();
		this.handlePointerUpForCanvas(event, canvas);
	};

	private readonly handleDocumentPointerCancel = (event: PointerEvent): void => {
		if (!this.shouldHandleDocumentPointer(event) || !this.activePdfPointerCanvas) {
			return;
		}
		const canvas = this.activePdfPointerCanvas;
		event.preventDefault();
		event.stopImmediatePropagation();
		this.handlePointerCancelForCanvas(event, canvas);
	};

	private readonly handlePointerMove = (event: PointerEvent): void => {
		if (this.activePdfPointerId !== null && this.activePdfPointerId !== event.pointerId) {
			return;
		}
		if (this.shouldHandleDocumentPointer(event)) {
			return;
		}
		const canvas = isHtmlCanvasElement(event.currentTarget) ? event.currentTarget : null;
		if (!canvas) {
			return;
		}
		this.handlePointerMoveForCanvas(event, canvas);
	};

	private handlePointerMoveForCanvas(event: PointerEvent, canvas: HTMLCanvasElement): void {
		if (this.currentTool === "eraser") {
			this.updateToolPreview(event.clientX, event.clientY, this.erasingSession);
		}
		const pageNumber = Number(canvas.dataset.pageNumber);
		if (this.pointerPage === null) {
			return;
		}
		if (pageNumber !== this.pointerPage) {
			return;
		}

		const surface = this.pageSurfaces.get(pageNumber);
		if (!surface) {
			return;
		}

		event.preventDefault();
		if (isInkDrawingTool(this.currentTool)) {
			this.lastInkInputTimestamp = performance.now();
		}
		const points = this.getNormalizedPoints(surface, event);
		if (points.length === 0) {
			return;
		}
		const point = points[points.length - 1];
		if ((this.currentTool === "select" || this.currentTool === "text") && this.selectedTarget && this.dragAnchor && !this.currentLasso) {
			const deltaX = point.x - this.dragAnchor.x;
			const deltaY = point.y - this.dragAnchor.y;
			if (Math.abs(deltaX) > 0 || Math.abs(deltaY) > 0) {
				this.dragMoved = true;
				if (this.activeResizeHandle && this.selectedTargets.length > 0) {
					this.resizeSelectedTargets(this.selectedTargets, this.activeResizeHandle, deltaX, deltaY);
				} else {
					this.moveSelectedTargetsWithinPage(this.selectedTargets, deltaX, deltaY);
				}
				this.dragAnchor = point;
				this.scheduleInteractionRedraw(pageNumber);
			}
			return;
		}
		if (this.currentTool === "select" && this.currentLasso && this.pointerPage === pageNumber) {
			if (this.toolState.selectionMode === "box" && this.dragAnchor) {
				this.currentLasso.points = getSelectionBoxPoints(this.dragAnchor, point);
				this.dragMoved = this.dragMoved || distanceBetween(this.dragAnchor, point) >= 0.003;
				this.scheduleInteractionRedraw(pageNumber);
				return;
			}
			const previousPoint = this.currentLasso.points[this.currentLasso.points.length - 1];
			if (!previousPoint || distanceBetween(previousPoint, point) >= 0.003) {
				this.currentLasso.points.push(point);
				this.scheduleInteractionRedraw(pageNumber);
			}
			return;
		}
		if (this.currentTool === "region" && this.currentLasso && this.dragAnchor && this.pointerPage === pageNumber) {
			this.currentLasso.points = getSelectionBoxPoints(this.dragAnchor, point);
			this.dragMoved = this.dragMoved || distanceBetween(this.dragAnchor, point) >= 0.003;
			this.scheduleInteractionRedraw(pageNumber);
			return;
		}
		if (this.currentTool === "text" && this.currentLasso && this.dragAnchor && this.pointerPage === pageNumber) {
			this.currentLasso.points = getSelectionBoxPoints(this.dragAnchor, point);
			this.dragMoved = this.dragMoved || distanceBetween(this.dragAnchor, point) >= 0.003;
			this.scheduleInteractionRedraw(pageNumber);
			return;
		}
		if (this.currentTool === "eraser" && this.erasingSession) {
			for (const sample of points) {
				if (this.eraserMode === "object") {
					this.previewObjectErase(pageNumber, this.lastEraserPoint ?? sample, sample);
				} else if (this.lastEraserPoint) {
					this.eraseCommittedLayerAlongPath(surface, this.lastEraserPoint, sample);
				} else {
					this.eraseCommittedLayerAtPoint(surface, sample);
				}
				this.appendEraserSessionPoint(pageNumber, sample);
				this.lastEraserPoint = sample;
			}
			this.renderTelemetry.recordPointerSamples(event, points.length, this.eraserSessionPoints.length);
			return;
		}
		if (!this.currentStroke && !this.currentShape) {
			return;
		}
		if (this.currentShape) {
			this.currentShape.end = point;
			this.scheduleInteractionRedraw(pageNumber);
			return;
		}

		if (this.currentStroke && appendStrokePoints(this.currentStroke, points, { mergeThreshold: this.getStrokeMergeThreshold(surface) })) {
			this.renderTelemetry.recordPointerSamples(event, points.length, this.currentStroke.points.length);
			this.scheduleInteractionRedraw(pageNumber);
		}
	}

	private readonly handlePointerEnter = (event: PointerEvent): void => {
		this.handleViewPointerMove(event);
	};

	private readonly handlePointerUp = (event: PointerEvent): void => {
		if (this.activePdfPointerId !== null && this.activePdfPointerId !== event.pointerId) {
			return;
		}
		if (this.shouldHandleDocumentPointer(event)) {
			return;
		}
		const canvas = isHtmlCanvasElement(event.currentTarget) ? event.currentTarget : null;
		this.handlePointerUpForCanvas(event, canvas);
	};

	private handlePointerUpForCanvas(event: PointerEvent, canvas: HTMLCanvasElement | null): void {
		const isInkInput = isInkDrawingTool(this.currentTool);
		if (isInkInput) {
			this.lastInkInputTimestamp = performance.now();
			this.renderTelemetry.recordPointerUp(event);
		}
		const pageNumber = canvas ? Number(canvas.dataset.pageNumber) : this.pointerPage;
		if (canvas) {
			try {
				canvas.releasePointerCapture(event.pointerId);
			} catch {
				// noop
			}
			canvas.setCssStyles({ touchAction: this.getOverlayTouchAction() });
		}
		this.unbindPdfPointerDocumentTracking();
		if (isInkInput) {
			this.resumeCommittedRenderingAfterInkInput();
		}

		const hasActiveInteraction =
			(this.currentTool === "select" && this.dragAnchor !== null) ||
			(this.currentTool === "select" && this.currentLasso !== null) ||
			(this.currentTool === "text" && this.dragAnchor !== null && this.selectedTarget !== null) ||
			(this.currentTool === "region" && this.currentLasso !== null) ||
			(this.currentTool === "text" && this.currentLasso !== null) ||
			(this.currentTool === "eraser" && this.erasingSession) ||
			this.currentStroke !== null ||
			this.currentShape !== null;
		if (!hasActiveInteraction || this.pointerPage === null || pageNumber !== this.pointerPage || !this.annotationDocument) {
			this.currentStroke = null;
			this.currentShape = null;
			this.dragAnchor = null;
			this.erasingSession = false;
			this.lastEraserPoint = null;
			this.eraserSessionPoints = [];
			this.pointerPage = null;
			return;
		}
		if (this.currentTool === "eraser" && this.erasingSession && canvas) {
			const surface = this.pageSurfaces.get(pageNumber);
			if (surface) {
				const points = this.getNormalizedPoints(surface, event);
				const point = points[points.length - 1] ?? this.getNormalizedPoint(surface, event);
				for (const sample of points) {
					if (this.eraserMode === "object") {
						this.previewObjectErase(pageNumber, this.lastEraserPoint ?? sample, sample);
					} else if (this.lastEraserPoint) {
						this.eraseCommittedLayerAlongPath(surface, this.lastEraserPoint, sample);
					} else {
						this.eraseCommittedLayerAtPoint(surface, sample);
					}
					this.appendEraserSessionPoint(pageNumber, sample);
					this.lastEraserPoint = sample;
				}
				if (this.eraserMode === "object") {
					this.previewObjectErase(pageNumber, this.lastEraserPoint ?? point, point);
				} else if (this.lastEraserPoint) {
					this.eraseCommittedLayerAlongPath(surface, this.lastEraserPoint, point);
				} else {
					this.eraseCommittedLayerAtPoint(surface, point);
				}
				this.appendEraserSessionPoint(pageNumber, point);
				this.lastEraserPoint = point;
			}
		}
		if (this.currentStroke && canvas && event.pointerType === "touch") {
			const surface = this.pageSurfaces.get(pageNumber);
			if (surface) {
				const releasePoint = this.getNormalizedPoint(surface, event);
				const previousPoint = this.currentStroke.points[this.currentStroke.points.length - 1];
				if (!previousPoint || distanceBetween(previousPoint, releasePoint) >= this.getStrokeMergeThreshold(surface)) {
					appendStrokePoints(this.currentStroke, [releasePoint], { mergeThreshold: this.getStrokeMergeThreshold(surface) });
				}
				if (
					this.currentStroke.points.length <= 3 &&
					this.currentStrokeRenderedPointCount < this.currentStroke.points.length
				) {
					this.drawTransientPageAnnotations(pageNumber);
				}
			}
		}
		if (this.currentStroke || this.currentShape || this.erasingSession) {
			this.cancelPendingInteractionRedraw();
		} else {
			this.flushInteractionRedraw(pageNumber);
		}

		if (this.currentTool === "region") {
			const lasso = this.currentLasso;
			this.currentLasso = null;
			this.pointerPage = null;
			this.activeResizeHandle = null;
			this.dragAnchor = null;
			const regionRect = lasso ? normalizeRect(getPolygonBounds(lasso.points)) : null;
			this.lastSelectionRegion = regionRect ? { page: pageNumber, rect: regionRect } : null;
			this.drawAllAnnotations();
			if (this.lastSelectionRegion && this.plugin.shouldAutoCopyRegionEmbed()) {
				this.refreshStatus("Region captured. Copying embed...");
				void this.copySelectionAnnotatedEmbedBlock();
			} else {
				this.refreshStatus(this.lastSelectionRegion ? "Region captured. Use Copy embed." : "Region too small");
			}
			this.refreshToolbar();
			this.refreshToolPreviewFromLastPointer(false);
			return;
		}

		if (this.currentTool === "text") {
			if (this.selectedTarget && this.dragAnchor && !this.currentLasso) {
				this.dragAnchor = null;
				this.pointerPage = null;
				this.activeResizeHandle = null;
				if (canvas) {
					canvas.setCssStyles({ cursor: "text" });
				}
				if (this.dragMoved) {
					this.markDirtyAndRedraw("Text box updated");
				} else {
					if (this.undoStack.length > 0) {
						this.undoStack.pop();
					}
					this.drawAllAnnotations();
				}
				this.dragMoved = false;
				this.refreshToolPreviewFromLastPointer(false);
				return;
			}
			const lasso = this.currentLasso;
			const start = this.dragAnchor;
			this.currentLasso = null;
			this.pointerPage = null;
			this.activeResizeHandle = null;
			this.dragAnchor = null;
			this.drawAllAnnotations();
			const surface = this.pageSurfaces.get(pageNumber);
			if (!surface || !start) {
				return;
			}
			const rect = lasso ? normalizeRect(getPolygonBounds(lasso.points)) : null;
			const boxWidthScale = rect && this.dragMoved
				? clamp(rect.right - rect.left, 0.04, 0.9)
				: undefined;
			const boxHeightScale = rect && this.dragMoved
				? clamp(rect.bottom - rect.top, 0.026, 0.9)
				: undefined;
			const point = rect && this.dragMoved
				? { x: rect.left, y: rect.top, pressure: 0.5 }
				: start;
			void this.insertSessionTextAtPoint(pageNumber, point, boxWidthScale, boxHeightScale);
			this.dragMoved = false;
			this.refreshToolPreviewFromLastPointer(false);
			return;
		}

		if (this.currentTool === "select") {
			if (this.currentLasso) {
				const lasso = this.currentLasso;
				const boxClickPoint = this.toolState.selectionMode === "box" && !this.dragMoved
					? (this.dragAnchor ?? lasso.points[0])
					: null;
				this.currentLasso = null;
				this.pointerPage = null;
				this.activeResizeHandle = null;
				this.lastSelectionRegion = null;
				const clickHit = boxClickPoint ? this.findSelectableTarget(pageNumber, boxClickPoint) : null;
				const hits = clickHit ? [clickHit] : this.findTargetsInLasso(lasso);
				if ((event.shiftKey || event.ctrlKey || event.metaKey) && hits.length > 0) {
					const existingKeys = new Set(this.selectedTargets.map((target) => `${target.kind}:${target.page}:${target.id}`));
					this.selectedTargets = [
						...this.selectedTargets,
						...hits.filter((target) => !existingKeys.has(`${target.kind}:${target.page}:${target.id}`))
					];
				} else {
					this.selectedTargets = hits;
				}
				this.selectedTarget = this.selectedTargets[0] ?? null;
				this.dragAnchor = null;
				this.dragMoved = false;
				this.drawAllAnnotations();
				const selectionVerb = this.toolState.selectionMode === "box" ? "Box selected" : "Lasso selected";
				const emptyMessage = this.toolState.selectionMode === "box" ? "Box found nothing" : "Lasso found nothing";
				this.refreshStatus(this.selectedTargets.length > 0 ? `${selectionVerb} ${this.selectedTargets.length} objects` : emptyMessage);
				this.refreshToolbar();
				this.refreshToolPreviewFromLastPointer(false);
				return;
			}
			this.dragAnchor = null;
			this.pointerPage = null;
			this.activeResizeHandle = null;
			this.updateOverlayCursorForPointer(event);
			if (this.dragMoved) {
				this.markDirtyAndRedraw("Selection updated");
			} else {
				if (this.undoStack.length > 0) {
					this.undoStack.pop();
				}
				this.refreshStatus("Selection ready");
				this.drawAllAnnotations();
			}
			this.dragMoved = false;
			this.refreshToolPreviewFromLastPointer(false);
			return;
		}
		if (this.currentTool === "eraser") {
			const segmentErase = this.eraserMode === "segment";
			const changed = this.applyEraserSession(pageNumber);
			this.erasingSession = false;
			this.lastEraserPoint = null;
			this.pointerPage = null;
			this.eraserSessionPoints = [];
			this.objectErasePreviewTargets.clear();
			if (segmentErase) {
				this.retainTouchErasePixels(pageNumber);
				if (changed) {
					this.schedulePageRedraw(pageNumber);
				}
			}
			if (changed) {
				if (!segmentErase) {
					this.retainCommittedPagePixels(pageNumber);
				}
				this.refreshStatus(`Erased (${this.eraserMode})`);
			} else {
				if (this.undoStack.length > 0) {
					this.undoStack.pop();
				}
				this.refreshStatus("Eraser ready");
			}
			this.refreshToolPreviewFromLastPointer(false);
			return;
		}

		this.freezeCurrentStrokeAtRenderedFrame();
		const committedPreviewStroke = this.currentStroke;
		const committedPreviewShape = this.currentShape;
		if (this.currentShape) {
			this.annotationDocument.shapes.push(this.currentShape);
		} else if (this.currentStroke && this.currentStroke.points.length > 0) {
			const pointCount = this.currentStroke.points.length;
			this.refreshStatus(`Saving stroke: ${pointCount} points`, 3000);
			this.pushStrokeAddHistory(this.currentStroke);
			this.annotationDocument.strokes.push(this.currentStroke);
			this.renderTelemetry.recordStrokeCommit(pointCount, this.annotationDocument.strokes.length);
			this.showDrawingNotice(`Stroke recorded (${pointCount} points, ${this.annotationDocument.strokes.length} total)`, 1400);
			this.refreshStatus(`Stroke recorded (${pointCount} points, ${this.annotationDocument.strokes.length} strokes)`, 900);
		}
		this.invalidateAnnotationPageCache();
		this.isDirty = true;
		this.scheduleSave();
		if (committedPreviewStroke || committedPreviewShape) {
			this.promoteCurrentTransientPreview(pageNumber);
		}
		this.currentStroke = null;
		this.currentStrokeRenderedPointCount = 0;
		this.currentShape = null;
		this.pointerPage = null;
		this.refreshToolPreviewFromLastPointer(false);
		if (committedPreviewStroke) {
			this.retainCommittedPagePixels(pageNumber);
		} else {
			this.deferCommittedPageRedraw(pageNumber);
		}
		this.refreshStatus(isShapeTool(this.currentTool) ? "Shape saved" : "Stroke saved");
	}

	private readonly handlePointerCancel = (event: PointerEvent): void => {
		if (this.activePdfPointerId !== null && this.activePdfPointerId !== event.pointerId) {
			return;
		}
		if (this.shouldHandleDocumentPointer(event)) {
			return;
		}
		const canvas = isHtmlCanvasElement(event.currentTarget) ? event.currentTarget : null;
		this.handlePointerCancelForCanvas(event, canvas);
	};

	private handlePointerCancelForCanvas(event: PointerEvent, canvas: HTMLCanvasElement | null): void {
		const isInkInput = isInkDrawingTool(this.currentTool);
		if (canvas) {
			try {
				canvas.releasePointerCapture(event.pointerId);
			} catch {
				// noop
			}
			canvas.setCssStyles({ touchAction: this.getOverlayTouchAction() });
		}
		this.unbindPdfPointerDocumentTracking();
		this.renderTelemetry.recordInputCancelled();
		this.cancelActiveSessionInteraction();
		if (this.currentTool === "select") {
			const surface = this.getSurfaceAtClientPoint(event.clientX, event.clientY);
			if (surface) {
				this.updateOverlayCursorForPointer(event);
			} else if (canvas) {
				const pageNumber = Number(canvas.dataset.pageNumber);
				const canvasSurface = Number.isFinite(pageNumber) ? this.pageSurfaces.get(pageNumber) : null;
				if (canvasSurface) {
					this.setOverlayCursor(canvasSurface, this.getDefaultOverlayCursor());
				}
			}
		}
		if (isInkInput) {
			this.resumeCommittedRenderingAfterInkInput();
		}
	}

	private readonly handlePointerLeave = (): void => {
		if (!this.erasingSession) {
			this.refreshToolPreviewFromLastPointer(false);
		}
	};

	private getNormalizedPoint(surface: PageSurface, event: PointerEvent): AnnotationPoint {
		const rect = surface.overlayEl.getBoundingClientRect();
		return this.getNormalizedPointFromRect(rect, event);
	}

	private getNormalizedPointFromRect(rect: DOMRect, event: PointerEvent): AnnotationPoint {
		const width = rect.width || 1;
		const height = rect.height || 1;
		const pressure = resolvePointerPressure(
			event,
			this.lastPdfPoint,
			this.lastPdfPointTime,
			this.plugin.getInkRenderSettings().pressureMode,
			this.webKitStylusPointerId === event.pointerId
		);
		const point = {
			x: clamp((event.clientX - rect.left) / width, 0, 1),
			y: clamp((event.clientY - rect.top) / height, 0, 1),
			pressure,
			t: event.timeStamp || performance.now()
		};
		this.lastPdfPoint = { clientX: event.clientX, clientY: event.clientY };
		this.lastPdfPointTime = event.timeStamp;
		return point;
	}

	private getNormalizedPoints(surface: PageSurface, event: PointerEvent): AnnotationPoint[] {
		const rect = this.activePdfPointerCanvas === surface.overlayEl && this.activePdfPointerRect
			? this.activePdfPointerRect
			: surface.overlayEl.getBoundingClientRect();
		return getCoalescedPointerEvents(event)
			.map((sample) => this.getNormalizedPointFromRect(rect, sample));
	}

	private getStrokeMergeThreshold(surface: PageSurface): number {
		return 1 / Math.max(surface.lastWidth || surface.overlayEl.getBoundingClientRect().width || 1, 1);
	}

	private freezeCurrentStrokeAtRenderedFrame(): void {
		// Rendering is a consumer of recorded input. A delayed preview must never
		// truncate touch samples that arrived after the most recent animation frame.
	}

	private appendEraserSessionPoint(pageNumber: number, point: AnnotationPoint): void {
		const lastPoint = this.eraserSessionPoints[this.eraserSessionPoints.length - 1];
		if (!lastPoint) {
			this.eraserSessionPoints.push(point);
			return;
		}
		const minDistance = Math.max(this.getEraserThreshold(pageNumber) * 0.25, 0.0008);
		if (distanceBetween(lastPoint, point) >= minDistance) {
			this.eraserSessionPoints.push(point);
		} else {
			this.eraserSessionPoints[this.eraserSessionPoints.length - 1] = point;
		}
	}

	private getEraserSessionSegments(points: AnnotationPoint[]): { start: AnnotationPoint; end: AnnotationPoint }[] {
		if (points.length === 0) {
			return [];
		}
		if (points.length === 1) {
			return [{ start: points[0], end: points[0] }];
		}
		const segments: { start: AnnotationPoint; end: AnnotationPoint }[] = [];
		for (let index = 1; index < points.length; index += 1) {
			segments.push({ start: points[index - 1], end: points[index] });
		}
		return segments;
	}

	private applyEraserSession(pageNumber: number): boolean {
		if (!this.annotationDocument || this.eraserSessionPoints.length === 0) {
			return false;
		}
		const threshold = this.getEraserThreshold(pageNumber);
		const points = [...this.eraserSessionPoints];
		const changed = this.eraserMode === "object"
			? this.applyObjectEraserSession(pageNumber, points, threshold)
			: this.applySegmentEraserSession(pageNumber, points, threshold);
		if (changed) {
			this.invalidateAnnotationPageCache();
			this.isDirty = true;
			this.scheduleSave();
		}
		return changed;
	}

	private applyObjectEraserSession(pageNumber: number, points: AnnotationPoint[], threshold: number): boolean {
		const targets = new Map<string, SelectedTarget>();
		const addTargets = (nextTargets: SelectedTarget[]): void => {
			for (const target of nextTargets) {
				targets.set(this.getObjectEraseTargetKey(target), target);
			}
		};
		addTargets(Array.from(this.objectErasePreviewTargets.values()));
		for (const segment of this.getEraserSessionSegments(points)) {
			addTargets(this.findObjectEraseTargetsAlongPath(pageNumber, segment.start, segment.end, threshold));
		}
		const eraseTargets = Array.from(targets.values());
		const targetsMissingFromPreview = eraseTargets.filter((target) => {
			const key = this.getObjectEraseTargetKey(target);
			if (this.objectErasePreviewTargets.has(key)) {
				return false;
			}
			this.objectErasePreviewTargets.set(key, target);
			return true;
		});
		this.redrawObjectErasePreview(pageNumber, targetsMissingFromPreview);
		return this.removeEraseTargets(eraseTargets);
	}

	private previewObjectErase(pageNumber: number, start: AnnotationPoint, end: AnnotationPoint): void {
		const threshold = this.getEraserThreshold(pageNumber);
		const addedTargets: SelectedTarget[] = [];
		const addTargets = (targets: SelectedTarget[]): void => {
			for (const target of targets) {
				const key = this.getObjectEraseTargetKey(target);
				if (!this.objectErasePreviewTargets.has(key)) {
					this.objectErasePreviewTargets.set(key, target);
					addedTargets.push(target);
				}
			}
		};
		addTargets(this.findObjectEraseTargetsAlongPath(pageNumber, start, end, threshold));
		this.redrawObjectErasePreview(pageNumber, addedTargets);
	}

	private applySegmentEraserSession(pageNumber: number, points: AnnotationPoint[], threshold: number): boolean {
		if (!this.annotationDocument) {
			return false;
		}
		return eraseStrokeSegmentsAlongPath(
			this.annotationDocument,
			pageNumber,
			points,
			threshold,
			() => generateId("stroke")
		);
	}

	private removeEraseTargets(targets: SelectedTarget[]): boolean {
		if (!this.annotationDocument || targets.length === 0) {
			return false;
		}
		const textIds = new Set(targets.filter((target) => target.kind === "text").map((target) => target.id));
		const strokeIds = new Set(targets.filter((target) => target.kind === "stroke").map((target) => target.id));
		const shapeIds = new Set(targets.filter((target) => target.kind === "shape").map((target) => target.id));
		const imageIds = new Set(targets.filter((target) => target.kind === "image").map((target) => target.id));
		const beforeTextCount = this.annotationDocument.textItems.length;
		const beforeStrokeCount = this.annotationDocument.strokes.length;
		const beforeShapeCount = this.annotationDocument.shapes.length;
		const beforeImageCount = this.annotationDocument.imageItems?.length ?? 0;

		if (textIds.size > 0) {
			this.annotationDocument.textItems = this.annotationDocument.textItems.filter((item) => !textIds.has(item.id));
		}
		if (strokeIds.size > 0) {
			this.annotationDocument.strokes = this.annotationDocument.strokes.filter((stroke) => !strokeIds.has(stroke.id));
		}
		if (shapeIds.size > 0) {
			this.annotationDocument.shapes = this.annotationDocument.shapes.filter((shape) => !shapeIds.has(shape.id));
		}
		if (imageIds.size > 0 && this.annotationDocument.imageItems) {
			this.annotationDocument.imageItems = this.annotationDocument.imageItems.filter((image) => !imageIds.has(image.id));
		}

		return this.annotationDocument.textItems.length !== beforeTextCount ||
			this.annotationDocument.strokes.length !== beforeStrokeCount ||
			this.annotationDocument.shapes.length !== beforeShapeCount ||
			(this.annotationDocument.imageItems?.length ?? 0) !== beforeImageCount;
	}

	private getObjectEraseTargetKey(target: SelectedTarget): string {
		return `${target.kind}:${target.page}:${target.id}`;
	}

	private redrawObjectErasePreview(pageNumber: number, changedTargets: SelectedTarget[]): void {
		if (!this.annotationDocument || changedTargets.length === 0) {
			return;
		}
		const surface = this.pageSurfaces.get(pageNumber);
		if (!surface) {
			return;
		}
		this.ensureOverlayLayerOrder(surface);
		this.resizeOverlay(surface);
		const renderCanvas = this.getNextPageRenderSlot(surface);
		const context = renderCanvas.getContext("2d", { willReadFrequently: true });
		if (!context || !surface.overlayEl.getContext("2d")) {
			return;
		}
		const ratio = window.devicePixelRatio || 1;
		const excludedKeys = new Set(this.objectErasePreviewTargets.keys());

		context.setTransform(1, 0, 0, 1, 0, 0);
		context.clearRect(0, 0, renderCanvas.width, renderCanvas.height);
		context.setTransform(ratio, 0, 0, ratio, 0, 0);

		const bucket = this.getPageAnnotationBucket(pageNumber);
		for (const imageItem of bucket.imageItems) {
			if (!excludedKeys.has(this.getObjectEraseTargetKey({ kind: "image", id: imageItem.id, page: pageNumber }))) {
				this.drawImageAnnotation(context, surface, imageItem);
			}
		}
		const renderables = getAnnotationRenderables(bucket.strokes, bucket.textItems, bucket.shapes);
		for (const renderable of renderables) {
			if (
				excludedKeys.has(this.getObjectEraseTargetKey({
					kind: renderable.kind,
					id: renderable.annotation.id,
					page: pageNumber
				}))
			) {
				continue;
			}
			if (renderable.kind === "stroke") {
				this.drawStroke(context, surface, renderable.annotation);
			} else if (renderable.kind === "text") {
				this.drawText(context, surface, renderable.annotation);
			} else if (renderable.kind === "shape") {
				this.drawShape(context, surface, renderable.annotation);
			}
		}
		const inlinePreviewText = this.getInlineTextPreviewItem(pageNumber);
		if (inlinePreviewText) {
			this.drawText(context, surface, inlinePreviewText);
		}
		const pageSelections = this.selectedTargets.filter((target) => target.page === pageNumber);
		if (pageSelections.length > 0) {
			this.drawSelection(context, surface, pageSelections);
		}
		if (this.lastSelectionRegion?.page === pageNumber) {
			this.drawFocusedRegion(context, surface, this.lastSelectionRegion.rect);
		}
		if (this.focusedRegion && this.focusedRegionPage === pageNumber) {
			this.drawFocusedRegion(context, surface, this.focusedRegion);
		}

		this.publishRenderedCanvas(renderCanvas, surface.overlayEl);
	}

	private findObjectEraseTargetsAlongPath(
		pageNumber: number,
		start: AnnotationPoint,
		end: AnnotationPoint,
		threshold: number
	): SelectedTarget[] {
		if (!this.annotationDocument) {
			return [];
		}
		const candidates: HitCandidate[] = [];

		for (let index = this.annotationDocument.textItems.length - 1; index >= 0; index -= 1) {
			const item = this.annotationDocument.textItems[index];
			if (item.page !== pageNumber) {
				continue;
			}
			const bounds = getTextBounds(item);
			if (segmentIntersectsExpandedBounds(start, end, bounds, threshold)) {
				candidates.push({ kind: "text", id: item.id, page: pageNumber, score: distanceToRectEdge(start, bounds) });
			}
		}

		for (let index = (this.annotationDocument.imageItems ?? []).length - 1; index >= 0; index -= 1) {
			const image = this.annotationDocument.imageItems?.[index];
			if (!image || image.page !== pageNumber) {
				continue;
			}
			const bounds = this.getImageBounds(image);
			if (segmentIntersectsExpandedBounds(start, end, bounds, threshold)) {
				candidates.push({ kind: "image", id: image.id, page: pageNumber, score: distanceToRectEdge(start, bounds) });
			}
		}

		for (let index = this.annotationDocument.shapes.length - 1; index >= 0; index -= 1) {
			const shape = this.annotationDocument.shapes[index];
			if (shape.page !== pageNumber) {
				continue;
			}
			let score = Number.POSITIVE_INFINITY;
			if (shape.tool === "line") {
				score = distanceBetweenSegments(start, end, shape.start, shape.end);
			} else {
				const bounds = getShapeBounds(shape);
				if (segmentIntersectsExpandedBounds(start, end, bounds, threshold)) {
					score = Math.min(distanceToShape(start, shape), distanceToShape(end, shape));
				}
			}
			if (score <= threshold * 1.5) {
				candidates.push({ kind: "shape", id: shape.id, page: pageNumber, score });
			}
		}

		for (let index = this.annotationDocument.strokes.length - 1; index >= 0; index -= 1) {
			const stroke = this.annotationDocument.strokes[index];
			if (stroke.page !== pageNumber || stroke.points.length === 0) {
				continue;
			}
			let score = Math.min(distanceToSegment(stroke.points[0], start, end), distanceToStroke(start, stroke), distanceToStroke(end, stroke));
			for (let pointIndex = 1; pointIndex < stroke.points.length; pointIndex += 1) {
				score = Math.min(score, distanceBetweenSegments(start, end, stroke.points[pointIndex - 1], stroke.points[pointIndex]));
				if (score <= threshold) {
					break;
				}
			}
			if (score <= threshold) {
				candidates.push({ kind: "stroke", id: stroke.id, page: pageNumber, score });
			}
		}

		if (candidates.length === 0) {
			return [];
		}
		candidates.sort((left, right) => left.score - right.score);
		return candidates.map((candidate) => ({
			kind: candidate.kind,
			id: candidate.id,
			page: candidate.page
		}));
	}
	private drawAllAnnotations(): void {
		for (const pageNumber of this.pageSurfaces.keys()) {
			this.schedulePageRedraw(pageNumber);
		}
	}

	private invalidateAnnotationPageCache(): void {
		this.annotationPageCache = null;
		if (!this.annotationDocument) {
			this.strokePathCache.clear();
		}
	}

	private getPageAnnotationBucket(pageNumber: number): PageAnnotationBucket {
		if (!this.annotationDocument) {
			return { strokes: [], eraserPaths: [], textItems: [], shapes: [], imageItems: [] };
		}
		if (!this.annotationPageCache) {
			const cache = new Map<number, PageAnnotationBucket>();
			const getBucket = (page: number): PageAnnotationBucket => {
				let bucket = cache.get(page);
				if (!bucket) {
					bucket = { strokes: [], eraserPaths: [], textItems: [], shapes: [], imageItems: [] };
					cache.set(page, bucket);
				}
				return bucket;
			};
			for (const stroke of this.annotationDocument.strokes) {
				getBucket(stroke.page).strokes.push(stroke);
			}
			for (const eraserPath of this.annotationDocument.eraserPaths ?? []) {
				getBucket(eraserPath.page).eraserPaths.push(eraserPath);
			}
			for (const textItem of this.annotationDocument.textItems) {
				getBucket(textItem.page).textItems.push(textItem);
			}
			for (const shape of this.annotationDocument.shapes) {
				getBucket(shape.page).shapes.push(shape);
			}
			for (const image of this.annotationDocument.imageItems ?? []) {
				getBucket(image.page).imageItems.push(image);
			}
			this.annotationPageCache = cache;
		}
		return this.annotationPageCache.get(pageNumber) ?? { strokes: [], eraserPaths: [], textItems: [], shapes: [], imageItems: [] };
	}

	private drawPageAnnotations(pageNumber: number): void {
		if (this.isFingerPanRenderingPaused()) {
			this.pendingRedrawPages.add(pageNumber);
			return;
		}
		if (!this.annotationDocument) {
			return;
		}
		this.cancelPageRenderJob(pageNumber);

		const surface = this.pageSurfaces.get(pageNumber);
		if (!surface) {
			return;
		}

		if (!surface.overlayEl.isConnected || !surface.hostEl.isConnected) {
			return;
		}

		this.ensureOverlayLayerOrder(surface);
		this.resizeOverlay(surface);
		if (!surface.overlayEl.isConnected) {
			this.scheduleSyncPages();
			return;
		}
		const context = surface.overlayEl.getContext("2d");
		if (!context) {
			return;
		}

		const ratio = window.devicePixelRatio || 1;
		context.setTransform(ratio, 0, 0, ratio, 0, 0);
		context.clearRect(0, 0, surface.lastWidth, surface.lastHeight);

		const bucket = this.getPageAnnotationBucket(pageNumber);
		for (const imageItem of bucket.imageItems) {
			this.drawImageAnnotation(context, surface, imageItem);
		}
		const renderables = getAnnotationRenderables(bucket.strokes, bucket.textItems, bucket.shapes);
		for (const renderable of renderables) {
			if (renderable.kind === "stroke") {
				this.drawStroke(context, surface, renderable.annotation);
			} else if (renderable.kind === "text") {
				if (this.inlineTextTargetId === renderable.annotation.id && this.inlineTextPageNumber === pageNumber) {
					continue;
				}
				this.drawText(context, surface, renderable.annotation);
			} else if (renderable.kind === "shape") {
				this.drawShape(context, surface, renderable.annotation);
			}
		}
		const inlinePreviewText = this.getInlineTextPreviewItem(pageNumber);
		if (inlinePreviewText) {
			this.drawText(context, surface, inlinePreviewText);
		}
		const pageSelections = this.selectedTargets.filter((target) => target.page === pageNumber);
		if (pageSelections.length > 0) {
			this.drawSelection(context, surface, pageSelections);
		}
		if (this.lastSelectionRegion?.page === pageNumber) {
			this.drawFocusedRegion(context, surface, this.lastSelectionRegion.rect);
		}
		if (this.focusedRegion && this.focusedRegionPage === pageNumber) {
			this.drawFocusedRegion(context, surface, this.focusedRegion);
		}
		this.clearTransientLayer(surface);
		this.drawTransientPageAnnotations(pageNumber);
	}

	private drawImageAnnotation(context: CanvasRenderingContext2D, surface: PageSurface, imageItem: ImageAnnotation): void {
		const x = imageItem.x * surface.lastWidth;
		const y = imageItem.y * surface.lastHeight;
		const width = Math.max(1, imageItem.widthScale * surface.lastWidth);
		const height = Math.max(1, imageItem.heightScale * surface.lastHeight);
		let image = this.imageElementCache.get(imageItem.id);
		if (!image || image.src !== imageItem.dataUrl) {
			image = new Image();
			image.onload = () => this.schedulePageRedraw(imageItem.page);
			image.src = imageItem.dataUrl;
			this.imageElementCache.set(imageItem.id, image);
		}
		if (!image.complete || image.naturalWidth <= 0) {
			context.save();
			context.strokeStyle = "rgba(120, 120, 120, 0.45)";
			context.setLineDash([6, 4]);
			context.strokeRect(x, y, width, height);
			context.restore();
			return;
		}
		context.save();
		context.globalAlpha = 1;
		context.drawImage(image, x, y, width, height);
		context.restore();
	}

	private promoteCurrentTransientPreview(pageNumber: number): void {
		const surface = this.pageSurfaces.get(pageNumber);
		if (!surface) {
			return;
		}
		if (this.currentStroke?.page === pageNumber) {
			this.strokePathCache.delete(this.currentStroke.id);
			this.drawTransientPageAnnotations(pageNumber, true);
		} else {
			this.drawTransientPageAnnotations(pageNumber);
		}
		this.promoteTransientLayer(surface);
	}

	private promoteTransientLayer(surface: PageSurface): void {
		// A stroke may finish while a zoom replacement is still pending. Resize the
		// committed backing store without dropping its last complete frame, then
		// composite the live stroke at the same pixel scale.
		this.syncCanvasBackingSize(surface.overlayEl, surface.lastWidth, surface.lastHeight, true);
		this.syncCanvasBackingSize(surface.transientEl, surface.lastWidth, surface.lastHeight);
		const context = surface.overlayEl.getContext("2d");
		if (!context) {
			return;
		}
		context.save();
		context.setTransform(1, 0, 0, 1, 0, 0);
		context.drawImage(surface.transientEl, 0, 0);
		context.restore();
		this.clearTransientLayer(surface);
	}

	private eraseCommittedLayerAtPoint(surface: PageSurface, point: AnnotationPoint): void {
		const radius = this.getToolPreviewRadius();
		const context = surface.overlayEl.getContext("2d");
		if (!context || radius <= 0) {
			return;
		}
		const ratio = window.devicePixelRatio || 1;
		context.save();
		context.setTransform(ratio, 0, 0, ratio, 0, 0);
		context.globalCompositeOperation = "destination-out";
		context.beginPath();
		context.arc(point.x * surface.lastWidth, point.y * surface.lastHeight, radius + 1, 0, Math.PI * 2);
		context.fill();
		context.restore();
	}

	private eraseCommittedLayerAlongPath(surface: PageSurface, start: AnnotationPoint, end: AnnotationPoint): void {
		const radius = this.getToolPreviewRadius();
		const context = surface.overlayEl.getContext("2d");
		if (!context || radius <= 0) {
			return;
		}
		const ratio = window.devicePixelRatio || 1;
		context.save();
		context.setTransform(ratio, 0, 0, ratio, 0, 0);
		context.globalCompositeOperation = "destination-out";
		context.lineCap = "round";
		context.lineJoin = "round";
		context.lineWidth = Math.max(1, radius * 2);
		context.beginPath();
		context.moveTo(start.x * surface.lastWidth, start.y * surface.lastHeight);
		context.lineTo(end.x * surface.lastWidth, end.y * surface.lastHeight);
		context.stroke();
		context.restore();
	}

	private clearTransientLayer(surface: PageSurface): void {
		this.syncCanvasBackingSize(surface.transientEl, surface.lastWidth, surface.lastHeight);
		const context = surface.transientEl.getContext("2d");
		if (!context) {
			return;
		}
		const ratio = window.devicePixelRatio || 1;
		context.setTransform(ratio, 0, 0, ratio, 0, 0);
		context.clearRect(0, 0, surface.lastWidth, surface.lastHeight);
	}

	private drawTransientPageAnnotations(pageNumber: number, commitCurrentStroke = false): void {
		const surface = this.pageSurfaces.get(pageNumber);
		if (!surface) {
			return;
		}
		this.syncCanvasBackingSize(surface.transientEl, surface.lastWidth, surface.lastHeight);
		const context = surface.transientEl.getContext("2d");
		if (!context) {
			return;
		}
		const ratio = window.devicePixelRatio || 1;
		context.setTransform(ratio, 0, 0, ratio, 0, 0);
		context.clearRect(0, 0, surface.lastWidth, surface.lastHeight);
		if (this.currentStroke?.page === pageNumber) {
			const predictionStrength = commitCurrentStroke ? 0 : this.getLivePreviewPredictionStrength();
			const predictTail = predictionStrength > 0;
			this.drawStroke(context, surface, this.currentStroke, predictTail, !commitCurrentStroke, predictionStrength);
			this.currentStrokeRenderedPointCount = this.currentStroke.points.length;
		}
		if (this.currentShape?.page === pageNumber) {
			this.drawShape(context, surface, this.currentShape);
		}
		if (this.currentLasso?.page === pageNumber) {
			this.drawLasso(context, surface, this.currentLasso);
		}
	}

	private getLivePreviewPredictionStrength(): number {
		switch (this.plugin.getLivePreviewMode()) {
			case "accurate":
				return 0;
			case "balanced":
				return 0.45;
			case "smooth":
				return 1;
		}
	}

	private drawStroke(
		context: CanvasRenderingContext2D,
		surface: PageSurface,
		stroke: StrokeAnnotation,
		predictTail = false,
		livePreview = false,
		predictionStrength = 1
	): void {
		if (stroke.points.length === 0) {
			return;
		}

		const widthScale = this.resolveStoredScale(stroke.width, stroke.widthScale, MAX_STROKE_WIDTH_SCALE);
		const baseWidth = Math.max(0.75, widthScale * surface.lastWidth);

		context.save();
		context.lineCap = "round";
		context.lineJoin = "round";
		context.strokeStyle = stroke.color;
		context.fillStyle = stroke.color;
		context.globalAlpha = stroke.tool === "highlighter" ? 0.24 : 0.96;
		context.globalCompositeOperation = "source-over";

		if (stroke.tool === "highlighter") {
			this.drawReliablePdfStroke(context, surface, stroke, baseWidth, false, predictTail, livePreview, predictionStrength);
			context.restore();
			return;
		}

		this.drawReliablePdfStroke(context, surface, stroke, baseWidth, true, predictTail, livePreview, predictionStrength);
		context.restore();
	}

	private drawReliablePdfStroke(
		context: CanvasRenderingContext2D,
		surface: PageSurface,
		stroke: StrokeAnnotation,
		baseWidth: number,
		usePressure: boolean,
		predictTail: boolean,
		livePreview = false,
		predictionStrength = 1
	): void {
		if (stroke.points.length === 0) {
			return;
		}
		if (!livePreview) {
			const cachedOutline = this.getCachedStrokeOutline(surface, stroke, baseWidth, usePressure, predictTail);
			if (cachedOutline) {
				fillInkStrokeOutline(context, cachedOutline);
				return;
			}
		}
		drawSmoothInkStroke(
			context,
			stroke.points,
			surface.lastWidth,
			surface.lastHeight,
			baseWidth,
			usePressure,
			predictTail,
			{
				renderMode: livePreview ? "live" : "committed",
				predictionStrength,
				startTaper: stroke.cutStart ? 0 : undefined,
				endTaper: stroke.cutEnd ? 0 : undefined
			}
		);
	}

	private getStrokePathSignature(
		surface: PageSurface,
		stroke: StrokeAnnotation,
		baseWidth: number,
		usePressure: boolean
	): string {
		let pointHash = 2166136261;
		for (const point of stroke.points) {
			pointHash ^= Math.round(point.x * 100000);
			pointHash = Math.imul(pointHash, 16777619);
			pointHash ^= Math.round(point.y * 100000);
			pointHash = Math.imul(pointHash, 16777619);
			pointHash ^= Math.round(point.pressure * 1000);
			pointHash = Math.imul(pointHash, 16777619);
		}
		return [
			surface.lastWidth.toFixed(1),
			surface.lastHeight.toFixed(1),
			baseWidth.toFixed(2),
			usePressure ? "p" : "u",
			stroke.cutStart ? "cs" : "ns",
			stroke.cutEnd ? "ce" : "ne",
			stroke.points.length,
			pointHash >>> 0
		].join(":");
	}

	private getCachedStrokeOutline(
		surface: PageSurface,
		stroke: StrokeAnnotation,
		baseWidth: number,
		usePressure: boolean,
		predictTail: boolean
	): InkStrokeOutline | null {
		if (predictTail || stroke.points.length < 4) {
			return null;
		}
		const signature = this.getStrokePathSignature(surface, stroke, baseWidth, usePressure);
		const key = stroke.id;
		const cached = this.strokePathCache.get(key);
		if (cached?.signature === signature) {
			return cached.outline;
		}
		const outline = getSmoothInkStrokeOutline(
			stroke.points,
			surface.lastWidth,
			surface.lastHeight,
			baseWidth,
			usePressure,
			false,
			{
				renderMode: "committed",
				startTaper: stroke.cutStart ? 0 : undefined,
				endTaper: stroke.cutEnd ? 0 : undefined
			}
		);
		if (!outline) {
			this.strokePathCache.delete(key);
			return null;
		}
		this.strokePathCache.set(key, { signature, outline });
		return outline;
	}

	private drawText(context: CanvasRenderingContext2D, surface: PageSurface, textItem: TextAnnotation): void {
		context.save();
		context.fillStyle = textItem.color;
		const fontSize = getRenderedTextFontSize(this.resolveStoredFontScale(textItem), surface.lastWidth);
		const metrics = getRenderedTextLayoutMetrics(surface.lastWidth);
		const fontFamily = textItem.fontFamily ?? TEXT_FONT_FAMILIES[0];
		applyCanvasTextStyle(context, textItem, fontSize, fontFamily);
		const boxWidth = textItem.boxWidthScale && textItem.boxWidthScale > 0
			? textItem.boxWidthScale * surface.lastWidth
			: surface.lastWidth * 0.48;
		const innerWidth = Math.max(metrics.minimumInnerWidth, boxWidth - (metrics.paddingX * 2));
		const textLeft = (textItem.x * surface.lastWidth) + metrics.paddingX;
		const lineSpacing = resolveTextLineSpacing(textItem);
		const lines = getCanvasTextLines(context, textItem.text, innerWidth, resolveTextWordWrap(textItem));
		const fallbackHeight = (metrics.paddingY * 2) +
			getTextBlockHeight(fontSize, lines.length, lineSpacing) +
			metrics.boxExtraHeight;
		const boxHeight = textItem.boxHeightScale && textItem.boxHeightScale > 0
			? textItem.boxHeightScale * surface.lastHeight
			: fallbackHeight;
		const textTop = getTextBlockTop(
			textItem.y * surface.lastHeight,
			boxHeight,
			fontSize,
			lines.length,
			resolveTextVerticalAlignment(textItem),
			lineSpacing,
			metrics.paddingY
		);
		const textX = getAlignedTextX(textLeft, innerWidth, resolveTextAlignment(textItem));
		lines.forEach((line, index) => {
			context.fillText(line, textX, textTop + (index * fontSize * lineSpacing));
		});
		context.restore();
	}

	private getInlineTextPreviewItem(pageNumber: number): TextAnnotation | null {
		if (!this.annotationDocument || this.inlineTextPageNumber !== pageNumber || !this.inlineTextEditorEl || !this.inlineTextPoint) {
			return null;
		}
		const value = this.inlineTextEditorEl.value;
		if (!value.trim()) {
			return null;
		}
		const surface = this.pageSurfaces.get(pageNumber);
		const pageWidth = Math.max(surface?.lastWidth ?? 1, 1);
		const pageHeight = Math.max(surface?.lastHeight ?? 1, 1);
		const frameRect = this.inlineTextEditorFrameEl?.getBoundingClientRect() ?? null;
		const framePoint = this.getInlineTextFramePoint(pageNumber) ?? this.inlineTextPoint;
		const existing = this.inlineTextTargetId
			? this.annotationDocument.textItems.find((entry) => entry.id === this.inlineTextTargetId)
			: null;
		const boxWidthScale = frameRect ? clamp(frameRect.width / pageWidth, 0.04, 0.9) : existing?.boxWidthScale;
		const baseBoxHeightScale = frameRect ? clamp(frameRect.height / pageHeight, 0.025, 0.9) : existing?.boxHeightScale;
		const preview: TextAnnotation = {
			id: existing?.id ?? "inline-text-preview",
			page: pageNumber,
			text: value,
			x: framePoint.x,
			y: framePoint.y,
			color: this.inlineTextEditorEl.dataset.textColor || existing?.color || this.currentTextColor,
			fontSize: this.currentTextFontSize,
			fontFamily: this.currentTextFontFamily,
			fontScale: this.getStableTextFontScale(this.currentTextFontSize),
			fontWeight: this.currentTextFontWeight,
			fontStyle: this.currentTextFontStyle,
			textAlign: this.currentTextAlignment,
			verticalAlign: this.currentTextVerticalAlignment,
			lineSpacing: this.currentTextLineSpacing,
			wordWrap: this.currentTextWordWrap,
			autoFit: this.inlineTextAutoFit,
			boxWidthScale,
			boxHeightScale: baseBoxHeightScale,
			zIndex: existing?.zIndex ?? this.getNextPageZIndex(pageNumber),
			createdAt: existing?.createdAt ?? new Date().toISOString()
		};
		const measuredHeightScale = surface ? this.measureTextBoxHeightScale(surface, preview) : null;
		if (measuredHeightScale && this.inlineTextAutoFit) {
			preview.boxHeightScale = measuredHeightScale;
		}
		return preview;
	}

	private measureAutoFitTextAnnotation(
		surface: PageSurface,
		textItem: TextAnnotation
	): { width: number; height: number; lineCount: number } | null {
		const context = surface.overlayEl.getContext("2d");
		if (!context) {
			return null;
		}
		const fontSize = getRenderedTextFontSize(this.resolveStoredFontScale(textItem), surface.lastWidth);
		const metrics = getRenderedTextLayoutMetrics(surface.lastWidth);
		const fontFamily = textItem.fontFamily ?? TEXT_FONT_FAMILIES[0];
		const left = textItem.x * surface.lastWidth;
		const preferredWidth = textItem.autoFit === true
			? Math.min(320, Math.max(220, surface.lastWidth * 0.44))
			: textItem.boxWidthScale && textItem.boxWidthScale > 0
				? textItem.boxWidthScale * surface.lastWidth
				: Math.min(320, Math.max(220, surface.lastWidth * 0.44));
		const maxWidth = Math.max(
			44,
			Math.min(
				surface.lastWidth - left - 12,
				resolveTextWordWrap(textItem) ? preferredWidth : surface.lastWidth * 0.78,
				surface.lastWidth * 0.78,
				560
			)
		);
		context.save();
		applyCanvasTextStyle(context, textItem, fontSize, fontFamily);
		const size = measureAutoFitTextBox(
			context,
			textItem.text,
			fontSize,
			maxWidth,
			resolveTextLineSpacing(textItem),
			resolveTextWordWrap(textItem),
			metrics
		);
		context.restore();
		return size;
	}

	private updateAutoFitTextAnnotation(textItem: TextAnnotation, pageNumber: number): void {
		if (textItem.autoFit !== true) {
			return;
		}
		const surface = this.pageSurfaces.get(pageNumber);
		const size = surface ? this.measureAutoFitTextAnnotation(surface, textItem) : null;
		if (!surface || !size) {
			return;
		}
		textItem.boxWidthScale = clamp(size.width / Math.max(surface.lastWidth, 1), 0.04, 0.9);
		textItem.boxHeightScale = clamp(size.height / Math.max(surface.lastHeight, 1), 0.025, 0.9);
	}

	private measureTextBoxHeightScale(surface: PageSurface, textItem: TextAnnotation): number | null {
		const context = surface.overlayEl.getContext("2d");
		if (!context) {
			return null;
		}
		const fontSize = getRenderedTextFontSize(this.resolveStoredFontScale(textItem), surface.lastWidth);
		const metrics = getRenderedTextLayoutMetrics(surface.lastWidth);
		const fontFamily = textItem.fontFamily ?? TEXT_FONT_FAMILIES[0];
		const boxWidth = textItem.boxWidthScale && textItem.boxWidthScale > 0
			? textItem.boxWidthScale * surface.lastWidth
			: surface.lastWidth * 0.48;
		context.save();
		applyCanvasTextStyle(context, textItem, fontSize, fontFamily);
		const lineCount = Math.max(
			1,
			getCanvasTextLines(
				context,
				textItem.text || " ",
				Math.max(metrics.minimumInnerWidth, boxWidth - (metrics.paddingX * 2)),
				resolveTextWordWrap(textItem)
			).length
		);
		context.restore();
		const measuredHeight = (metrics.paddingY * 2) +
			getTextBlockHeight(fontSize, lineCount, resolveTextLineSpacing(textItem)) +
			metrics.boxExtraHeight;
		return clamp(measuredHeight / Math.max(surface.lastHeight, 1), 0.025, 0.9);
	}

	private updateInlineTextEditorBoxFromContent(pageNumber: number): void {
		const preview = this.getInlineTextPreviewItem(pageNumber);
		const surface = this.pageSurfaces.get(pageNumber);
		if (!surface || !this.inlineTextEditorFrameEl || !this.inlineTextEditorEl) {
			return;
		}
		if (preview && this.inlineTextAutoFit) {
			const size = this.measureAutoFitTextAnnotation(surface, preview);
			if (size) {
				this.inlineTextEditorFrameEl.setCssStyles({
					width: `${size.width}px`,
					height: `${size.height}px`
				});
				this.inlineTextEditorEl.setCssStyles({ height: "100%" });
			}
		} else if (preview?.boxHeightScale) {
			const currentHeight = preview.boxHeightScale * surface.lastHeight;
			const requiredHeightScale = this.measureTextBoxHeightScale(surface, preview);
			const requiredHeight = requiredHeightScale
				? requiredHeightScale * surface.lastHeight
				: currentHeight;
			const frameTop = Number(this.inlineTextEditorFrameEl.dataset.top) || 0;
			const availableHeight = Math.max(36, surface.lastHeight - frameTop - 8);
			const nextHeight = Math.min(Math.max(currentHeight, requiredHeight), availableHeight);
			this.inlineTextEditorFrameEl.setCssStyles({ height: `${nextHeight}px` });
			this.inlineTextEditorEl.setCssStyles({ height: "100%" });
		}
		this.updateInlineTextVerticalAlignment(pageNumber);
	}

	private updateInlineTextVerticalAlignment(pageNumber: number): void {
		const surface = this.pageSurfaces.get(pageNumber);
		const frame = this.inlineTextEditorFrameEl;
		const editor = this.inlineTextEditorEl;
		const mirror = this.inlineTextCaretMirrorEl;
		if (!surface || !frame || !editor || !mirror) {
			return;
		}
		const context = surface.overlayEl.getContext("2d");
		if (!context) {
			return;
		}
		const pageWidth = surface.pendingWidth || surface.lastWidth;
		const metrics = getRenderedTextLayoutMetrics(pageWidth);
		const fontSize = Number.parseFloat(editor.style.fontSize) || 10;
		const frameRect = frame.getBoundingClientRect();
		const preview = this.getInlineTextPreviewItem(pageNumber);
		const textStyle = preview ?? {
			fontWeight: this.currentTextFontWeight,
			fontStyle: this.currentTextFontStyle,
			textAlign: this.currentTextAlignment
		};
		context.save();
		applyCanvasTextStyle(context, textStyle, fontSize, this.currentTextFontFamily);
		const lineCount = Math.max(
			1,
			getCanvasTextLines(
				context,
				editor.value || " ",
				Math.max(metrics.minimumInnerWidth, frameRect.width - (metrics.paddingX * 2)),
				this.currentTextWordWrap
			).length
		);
		context.restore();
		const lineBoxHeight = getTextBlockHeight(fontSize, lineCount, this.currentTextLineSpacing);
		const textTop = getTextBlockTop(
			0,
			frameRect.height,
			fontSize,
			lineCount,
			this.currentTextVerticalAlignment,
			this.currentTextLineSpacing,
			metrics.paddingY
		);
		const verticalPaddingBottom = Math.max(0, frameRect.height - textTop - lineBoxHeight);
		editor.setCssStyles({
			paddingTop: `${textTop}px`,
			paddingBottom: `${verticalPaddingBottom}px`
		});
		mirror.setCssStyles({
			paddingTop: `${textTop}px`,
			paddingBottom: `${verticalPaddingBottom}px`
		});
	}

	private drawShape(context: CanvasRenderingContext2D, surface: PageSurface, shape: ShapeAnnotation): void {
		const startX = shape.start.x * surface.lastWidth;
		const startY = shape.start.y * surface.lastHeight;
		const endX = shape.end.x * surface.lastWidth;
		const endY = shape.end.y * surface.lastHeight;
		const width = endX - startX;
		const height = endY - startY;

		context.save();
		context.strokeStyle = shape.color;
		context.lineWidth = Math.max(1, this.resolveStoredScale(shape.width, shape.widthScale, MAX_STROKE_WIDTH_SCALE) * surface.lastWidth);
		context.globalAlpha = 0.96;
		context.lineCap = "round";
		context.lineJoin = "round";

		if (shape.tool === "line") {
			context.beginPath();
			context.moveTo(startX, startY);
			context.lineTo(endX, endY);
			context.stroke();
			context.restore();
			return;
		}

		if (shape.tool === "rectangle") {
			context.strokeRect(startX, startY, width, height);
			context.restore();
			return;
		}

		const centerX = startX + width / 2;
		const centerY = startY + height / 2;
		context.beginPath();
		context.ellipse(centerX, centerY, Math.abs(width) / 2, Math.abs(height) / 2, 0, 0, Math.PI * 2);
		context.stroke();
		context.restore();
	}

	private drawSelection(context: CanvasRenderingContext2D, surface: PageSurface, targets: SelectedTarget[]): void {
		const visibleTargets = targets.filter((target) => !(target.kind === "text" && target.id === this.inlineTextTargetId && target.page === this.inlineTextPageNumber));
		if (visibleTargets.length === 0) {
			return;
		}
		context.save();
		for (const target of visibleTargets) {
			const bounds = this.getTargetBounds(target);
			if (!bounds) {
				continue;
			}
			context.strokeStyle = SELECTION_OUTLINE_COLOR;
			context.lineWidth = 1;
			context.setLineDash(SELECTION_LINE_DASH);
			context.strokeRect(
				bounds.left * surface.lastWidth,
				bounds.top * surface.lastHeight,
				(bounds.right - bounds.left) * surface.lastWidth,
				(bounds.bottom - bounds.top) * surface.lastHeight
			);
		}
		if (visibleTargets.length === 1) {
			const bounds = this.getTargetBounds(visibleTargets[0]);
			if (bounds) {
				for (const handle of this.getHandlePoints(bounds)) {
					context.beginPath();
					context.fillStyle = SELECTION_HANDLE_FILL_COLOR;
					context.strokeStyle = SELECTION_OUTLINE_COLOR;
					context.setLineDash([]);
					const radius = this.getResizeHandleVisualRadius(surface);
					context.arc(handle.x * surface.lastWidth, handle.y * surface.lastHeight, radius, 0, Math.PI * 2);
					context.fill();
					context.stroke();
				}
			}
		}
		if (visibleTargets.length > 1) {
			const bounds = this.getCombinedBounds(visibleTargets);
			if (bounds) {
				context.strokeStyle = SELECTION_OUTLINE_COLOR;
				context.lineWidth = 1;
				context.setLineDash(SELECTION_LINE_DASH);
				context.strokeRect(
					bounds.left * surface.lastWidth,
					bounds.top * surface.lastHeight,
					(bounds.right - bounds.left) * surface.lastWidth,
					(bounds.bottom - bounds.top) * surface.lastHeight
				);
				for (const handle of this.getHandlePoints(bounds)) {
					context.beginPath();
					context.fillStyle = SELECTION_HANDLE_FILL_COLOR;
					context.strokeStyle = SELECTION_OUTLINE_COLOR;
					context.setLineDash([]);
					const radius = this.getResizeHandleVisualRadius(surface);
					context.arc(handle.x * surface.lastWidth, handle.y * surface.lastHeight, radius, 0, Math.PI * 2);
					context.fill();
					context.stroke();
				}
			}
		}
		context.restore();
	}

	private drawLasso(context: CanvasRenderingContext2D, surface: PageSurface, lasso: LassoSelection): void {
		if (lasso.points.length < 2) {
			return;
		}
		context.save();
		context.fillStyle = SELECTION_FILL_COLOR;
		context.strokeStyle = SELECTION_OUTLINE_COLOR;
		context.lineWidth = 1;
		context.setLineDash(SELECTION_LINE_DASH);
		context.beginPath();
		context.moveTo(lasso.points[0].x * surface.lastWidth, lasso.points[0].y * surface.lastHeight);
		for (let index = 1; index < lasso.points.length; index += 1) {
			const point = lasso.points[index];
			context.lineTo(point.x * surface.lastWidth, point.y * surface.lastHeight);
		}
		if (lasso.points.length >= 3) {
			context.closePath();
			context.fill();
		}
		context.stroke();
		context.restore();
	}

	private drawFocusedRegion(
		context: CanvasRenderingContext2D,
		surface: PageSurface,
		bounds: { left: number; top: number; right: number; bottom: number }
	): void {
		context.save();
		context.fillStyle = SELECTION_FILL_COLOR;
		context.strokeStyle = SELECTION_OUTLINE_COLOR;
		context.lineWidth = 1;
		context.setLineDash(SELECTION_LINE_DASH);
		context.fillRect(
			bounds.left * surface.lastWidth,
			bounds.top * surface.lastHeight,
			(bounds.right - bounds.left) * surface.lastWidth,
			(bounds.bottom - bounds.top) * surface.lastHeight
		);
		context.strokeRect(
			bounds.left * surface.lastWidth,
			bounds.top * surface.lastHeight,
			(bounds.right - bounds.left) * surface.lastWidth,
			(bounds.bottom - bounds.top) * surface.lastHeight
		);
		context.restore();
	}

	private getGeometryHitThreshold(pageNumber: number, pixelRadius = 9): number {
		const surface = this.pageSurfaces.get(pageNumber);
		const minDimension = Math.min(surface?.lastWidth ?? 0, surface?.lastHeight ?? 0);
		const effectiveRadius = isTabletWebKitTouchDevice() ? Math.max(pixelRadius, 14) : pixelRadius;
		return minDimension > 0 ? clamp(effectiveRadius / minDimension, 0.005, 0.032) : 0.012;
	}

	private getTextContentLineBounds(
		item: TextAnnotation,
		pageNumber: number
	): Array<{ left: number; right: number; top: number; bottom: number }> {
		const surface = this.pageSurfaces.get(pageNumber);
		const context = surface?.overlayEl.getContext("2d");
		if (!surface || !context) {
			return [getTextBounds(item)];
		}
		const fontSize = getRenderedTextFontSize(this.resolveStoredFontScale(item), surface.lastWidth);
		const metrics = getRenderedTextLayoutMetrics(surface.lastWidth);
		const fontFamily = item.fontFamily ?? TEXT_FONT_FAMILIES[0];
		const boxWidth = item.boxWidthScale && item.boxWidthScale > 0
			? item.boxWidthScale * surface.lastWidth
			: surface.lastWidth * 0.48;
		const innerWidth = Math.max(metrics.minimumInnerWidth, boxWidth - (metrics.paddingX * 2));
		const textLeft = (item.x * surface.lastWidth) + metrics.paddingX;
		context.save();
		applyCanvasTextStyle(context, item, fontSize, fontFamily);
		const lines = getCanvasTextLines(context, item.text, innerWidth, resolveTextWordWrap(item));
		const widths = lines.map((line) => context.measureText(line || " ").width);
		context.restore();
		const lineSpacing = resolveTextLineSpacing(item);
		const fallbackHeight = (metrics.paddingY * 2) +
			getTextBlockHeight(fontSize, lines.length, lineSpacing) +
			metrics.boxExtraHeight;
		const boxHeight = item.boxHeightScale && item.boxHeightScale > 0
			? item.boxHeightScale * surface.lastHeight
			: fallbackHeight;
		const textTop = getTextBlockTop(
			item.y * surface.lastHeight,
			boxHeight,
			fontSize,
			lines.length,
			resolveTextVerticalAlignment(item),
			lineSpacing,
			metrics.paddingY
		);
		const alignment = resolveTextAlignment(item);
		return widths.map((lineWidth, index) => {
			const left = alignment === "center"
				? textLeft + ((innerWidth - lineWidth) / 2)
				: alignment === "right"
					? textLeft + innerWidth - lineWidth
					: textLeft;
			const top = textTop + (index * fontSize * lineSpacing);
			return {
				left: clamp(left / surface.lastWidth, 0, 1),
				right: clamp((left + Math.max(lineWidth, 1)) / surface.lastWidth, 0, 1),
				top: clamp(top / surface.lastHeight, 0, 1),
				bottom: clamp((top + fontSize) / surface.lastHeight, 0, 1)
			};
		});
	}

	private findSelectableTarget(pageNumber: number, point: AnnotationPoint, threshold?: number): SelectedTarget | null {
		if (!this.annotationDocument) {
			return null;
		}
		const hitThreshold = threshold ?? this.getGeometryHitThreshold(pageNumber);
		const candidates: HitCandidate[] = [];

		for (let index = (this.annotationDocument.imageItems ?? []).length - 1; index >= 0; index -= 1) {
			const image = this.annotationDocument.imageItems?.[index];
			if (!image || image.page !== pageNumber) {
				continue;
			}
			const bounds = this.getImageBounds(image);
			if (pointInBounds(point, bounds, hitThreshold)) {
				const score = pointInBounds(point, bounds)
					? -0.04
					: distanceToBounds(point, bounds);
				candidates.push({ kind: "image", id: image.id, page: pageNumber, score });
			}
		}

		for (let index = this.annotationDocument.textItems.length - 1; index >= 0; index -= 1) {
			const item = this.annotationDocument.textItems[index];
			if (item.page !== pageNumber) {
				continue;
			}
			const lineBounds = this.getTextContentLineBounds(item, pageNumber);
			const hitBounds = lineBounds.filter((bounds) => pointInBounds(point, bounds, hitThreshold));
			if (hitBounds.length > 0) {
				const score = Math.min(...hitBounds.map((bounds) => pointInBounds(point, bounds)
					? -0.03
					: distanceToBounds(point, bounds)));
				candidates.push({ kind: "text", id: item.id, page: pageNumber, score });
			}
		}

		for (let index = this.annotationDocument.shapes.length - 1; index >= 0; index -= 1) {
			const shape = this.annotationDocument.shapes[index];
			if (shape.page !== pageNumber) {
				continue;
			}
			const bounds = getShapeBounds(shape);
			if (shape.tool !== "line" && pointInBounds(point, bounds)) {
				candidates.push({ kind: "shape", id: shape.id, page: pageNumber, score: -0.02 });
				continue;
			}
			if (pointInBounds(point, bounds, hitThreshold)) {
				const score = distanceToShape(point, shape);
				if (score <= hitThreshold * 1.5 || pointInBounds(point, bounds)) {
					candidates.push({ kind: "shape", id: shape.id, page: pageNumber, score });
				}
			}
		}

		for (let index = this.annotationDocument.strokes.length - 1; index >= 0; index -= 1) {
			const stroke = this.annotationDocument.strokes[index];
			if (stroke.page !== pageNumber) {
				continue;
			}
			const score = distanceToStroke(point, stroke);
			const visibleRadius = getNormalizedStrokePadding(stroke.width, stroke.widthScale);
			if (score <= hitThreshold + visibleRadius) {
				candidates.push({ kind: "stroke", id: stroke.id, page: pageNumber, score });
			}
		}

		if (candidates.length === 0) {
			return null;
		}
		candidates.sort((left, right) => left.score - right.score);
		const best = candidates[0];
		return { kind: best.kind, id: best.id, page: best.page };
	}

	private moveSelectedTarget(target: SelectedTarget, deltaX: number, deltaY: number): void {
		if (!this.annotationDocument) {
			return;
		}
		if (target.kind === "text") {
			const item = this.annotationDocument.textItems.find((entry) => entry.id === target.id);
			if (!item) {
				return;
			}
			item.x = clamp(item.x + deltaX, 0, 1);
			item.y = clamp(item.y + deltaY, 0, 1);
			return;
		}
		if (target.kind === "shape") {
			const shape = this.annotationDocument.shapes.find((entry) => entry.id === target.id);
			if (!shape) {
				return;
			}
			shape.start = {
				...shape.start,
				x: clamp(shape.start.x + deltaX, 0, 1),
				y: clamp(shape.start.y + deltaY, 0, 1)
			};
			shape.end = {
				...shape.end,
				x: clamp(shape.end.x + deltaX, 0, 1),
				y: clamp(shape.end.y + deltaY, 0, 1)
			};
			return;
		}
		if (target.kind === "image") {
			const image = (this.annotationDocument.imageItems ?? []).find((entry) => entry.id === target.id);
			if (!image) {
				return;
			}
			image.x = clamp(image.x + deltaX, 0, Math.max(0, 1 - image.widthScale));
			image.y = clamp(image.y + deltaY, 0, Math.max(0, 1 - image.heightScale));
			return;
		}
		const stroke = this.annotationDocument.strokes.find((entry) => entry.id === target.id);
		if (!stroke) {
			return;
		}
		stroke.points = stroke.points.map((strokePoint) => ({
			...strokePoint,
			x: clamp(strokePoint.x + deltaX, 0, 1),
			y: clamp(strokePoint.y + deltaY, 0, 1)
		}));
	}

	private moveSelectedTargetsWithinPage(targets: SelectedTarget[], deltaX: number, deltaY: number): void {
		const targetsByPage = new Map<number, SelectedTarget[]>();
		for (const target of targets) {
			const pageTargets = targetsByPage.get(target.page) ?? [];
			pageTargets.push(target);
			targetsByPage.set(target.page, pageTargets);
		}
		for (const pageTargets of targetsByPage.values()) {
			const bounds = this.getCombinedBounds(pageTargets);
			if (!bounds) {
				continue;
			}
			const boundedDeltaX = clamp(deltaX, -bounds.left, 1 - bounds.right);
			const boundedDeltaY = clamp(deltaY, -bounds.top, 1 - bounds.bottom);
			for (const target of pageTargets) {
				this.moveSelectedTarget(target, boundedDeltaX, boundedDeltaY);
			}
		}
	}
	private resizeSelectedTargets(targets: SelectedTarget[], handle: ResizeHandle, deltaX: number, deltaY: number): void {
		if (!this.annotationDocument || targets.length === 0) {
			return;
		}
		const bounds = this.getCombinedBounds(targets);
		if (!bounds) {
			return;
		}

		const nextBounds = {
			left: bounds.left,
			right: bounds.right,
			top: bounds.top,
			bottom: bounds.bottom
		};

		switch (handle) {
			case "nw":
				nextBounds.left = clamp(bounds.left + deltaX, 0, bounds.right - 0.01);
				nextBounds.top = clamp(bounds.top + deltaY, 0, bounds.bottom - 0.01);
				break;
			case "n":
				nextBounds.top = clamp(bounds.top + deltaY, 0, bounds.bottom - 0.01);
				break;
			case "ne":
				nextBounds.right = clamp(bounds.right + deltaX, bounds.left + 0.01, 1);
				nextBounds.top = clamp(bounds.top + deltaY, 0, bounds.bottom - 0.01);
				break;
			case "e":
				nextBounds.right = clamp(bounds.right + deltaX, bounds.left + 0.01, 1);
				break;
			case "sw":
				nextBounds.left = clamp(bounds.left + deltaX, 0, bounds.right - 0.01);
				nextBounds.bottom = clamp(bounds.bottom + deltaY, bounds.top + 0.01, 1);
				break;
			case "w":
				nextBounds.left = clamp(bounds.left + deltaX, 0, bounds.right - 0.01);
				break;
			case "s":
				nextBounds.bottom = clamp(bounds.bottom + deltaY, bounds.top + 0.01, 1);
				break;
			case "se":
				nextBounds.right = clamp(bounds.right + deltaX, bounds.left + 0.01, 1);
				nextBounds.bottom = clamp(bounds.bottom + deltaY, bounds.top + 0.01, 1);
				break;
		}

		const resizingOnlyText = targets.every((target) => target.kind === "text");
		if (this.isCornerResizeHandle(handle) && !resizingOnlyText) {
			const proposedWidthScale = (nextBounds.right - nextBounds.left) / Math.max(bounds.right - bounds.left, 0.0001);
			const proposedHeightScale = (nextBounds.bottom - nextBounds.top) / Math.max(bounds.bottom - bounds.top, 0.0001);
			const uniformScale =
				Math.abs(proposedWidthScale - 1) >= Math.abs(proposedHeightScale - 1) ? proposedWidthScale : proposedHeightScale;

			switch (handle) {
				case "nw":
					nextBounds.left = clamp(bounds.right - (bounds.right - bounds.left) * uniformScale, 0, bounds.right - 0.01);
					nextBounds.top = clamp(bounds.bottom - (bounds.bottom - bounds.top) * uniformScale, 0, bounds.bottom - 0.01);
					break;
				case "ne":
					nextBounds.right = clamp(bounds.left + (bounds.right - bounds.left) * uniformScale, bounds.left + 0.01, 1);
					nextBounds.top = clamp(bounds.bottom - (bounds.bottom - bounds.top) * uniformScale, 0, bounds.bottom - 0.01);
					break;
				case "sw":
					nextBounds.left = clamp(bounds.right - (bounds.right - bounds.left) * uniformScale, 0, bounds.right - 0.01);
					nextBounds.bottom = clamp(bounds.top + (bounds.bottom - bounds.top) * uniformScale, bounds.top + 0.01, 1);
					break;
				case "se":
					nextBounds.right = clamp(bounds.left + (bounds.right - bounds.left) * uniformScale, bounds.left + 0.01, 1);
					nextBounds.bottom = clamp(bounds.top + (bounds.bottom - bounds.top) * uniformScale, bounds.top + 0.01, 1);
					break;
			}
		}

		const widthScale = (nextBounds.right - nextBounds.left) / Math.max(bounds.right - bounds.left, 0.0001);
		const heightScale = (nextBounds.bottom - nextBounds.top) / Math.max(bounds.bottom - bounds.top, 0.0001);

		for (const target of targets) {
			this.scaleTargetWithinBounds(target, bounds, nextBounds, widthScale, heightScale);
		}
	}

	private scaleTargetWithinBounds(
		target: SelectedTarget,
		previousBounds: { left: number; right: number; top: number; bottom: number },
		nextBounds: { left: number; right: number; top: number; bottom: number },
		widthScale: number,
		heightScale: number
	): void {
		if (!this.annotationDocument) {
			return;
		}

		const transformPoint = (point: AnnotationPoint): AnnotationPoint => ({
			...point,
			x: clamp(nextBounds.left + (point.x - previousBounds.left) * widthScale, 0, 1),
			y: clamp(nextBounds.top + (point.y - previousBounds.top) * heightScale, 0, 1)
		});

		if (target.kind === "stroke") {
			const stroke = this.annotationDocument.strokes.find((entry) => entry.id === target.id);
			if (!stroke) {
				return;
			}
			stroke.points = stroke.points.map((point) => transformPoint(point));
			return;
		}

		if (target.kind === "text") {
			const item = this.annotationDocument.textItems.find((entry) => entry.id === target.id);
			if (!item) {
				return;
			}
			const currentBounds = getTextBounds(item);
			const currentWidth = Math.max(item.boxWidthScale ?? (currentBounds.right - currentBounds.left), 0.04);
			const currentHeight = Math.max(item.boxHeightScale ?? (currentBounds.bottom - currentBounds.top), 0.026);
			const anchor = transformPoint({ x: item.x, y: item.y, pressure: 0.5 });
			item.x = anchor.x;
			item.y = anchor.y;
			item.autoFit = false;
			item.manualBoxSize = true;
			item.boxWidthScale = clamp(currentWidth * widthScale, 0.04, 0.9);
			item.boxHeightScale = clamp(currentHeight * heightScale, 0.026, 0.9);
			return;
		}

		if (target.kind === "image") {
			const image = (this.annotationDocument.imageItems ?? []).find((entry) => entry.id === target.id);
			if (!image) {
				return;
			}
			const currentBounds = this.getImageBounds(image);
			image.x = clamp(nextBounds.left + (currentBounds.left - previousBounds.left) * widthScale, 0, 0.98);
			image.y = clamp(nextBounds.top + (currentBounds.top - previousBounds.top) * heightScale, 0, 0.98);
			image.widthScale = clamp(image.widthScale * widthScale, 0.02, 0.98);
			image.heightScale = clamp(image.heightScale * heightScale, 0.02, 0.98);
			image.x = clamp(image.x, 0, Math.max(0, 1 - image.widthScale));
			image.y = clamp(image.y, 0, Math.max(0, 1 - image.heightScale));
			return;
		}

		const shape = this.annotationDocument.shapes.find((entry) => entry.id === target.id);
		if (!shape) {
			return;
		}
		shape.start = transformPoint(shape.start);
		shape.end = transformPoint(shape.end);
	}

	private isCornerResizeHandle(handle: ResizeHandle): boolean {
		return handle === "nw" || handle === "ne" || handle === "sw" || handle === "se";
	}

	private getResizeHandleHitThreshold(pageNumber: number): number {
		const surface = this.pageSurfaces.get(pageNumber);
		const minDimension = Math.min(surface?.lastWidth ?? 0, surface?.lastHeight ?? 0);
		if (!minDimension) {
			return 0.022;
		}
		const pixelRadius = isTabletWebKitTouchDevice() ? 22 : 14;
		return clamp(pixelRadius / minDimension, 0.012, 0.06);
	}

	private getResizeHandleVisualRadius(surface: PageSurface): number {
		const minDimension = Math.min(surface.lastWidth, surface.lastHeight);
		if (isTabletWebKitTouchDevice()) {
			return minDimension < 520 ? 6 : 5;
		}
		return minDimension < 520 ? 4.5 : 3.5;
	}

	private getTargetBounds(target: SelectedTarget): { left: number; right: number; top: number; bottom: number } | null {
		if (!this.annotationDocument) {
			return null;
		}
		if (target.kind === "text") {
			if (target.id === this.inlineTextTargetId && target.page === this.inlineTextPageNumber) {
				const preview = this.getInlineTextPreviewItem(target.page);
				if (preview) {
					return getTextBounds(preview);
				}
			}
			const item = this.annotationDocument.textItems.find((entry) => entry.id === target.id);
			return item ? getTextBounds(item) : null;
		}
		if (target.kind === "shape") {
			const shape = this.annotationDocument.shapes.find((entry) => entry.id === target.id);
			return shape ? getShapeBounds(shape) : null;
		}
		if (target.kind === "image") {
			const image = (this.annotationDocument.imageItems ?? []).find((entry) => entry.id === target.id);
			return image ? this.getImageBounds(image) : null;
		}
		const stroke = this.annotationDocument.strokes.find((entry) => entry.id === target.id);
		return stroke ? getStrokeBounds(stroke) : null;
	}

	private getImageBounds(image: ImageAnnotation): { left: number; right: number; top: number; bottom: number } {
		return {
			left: clamp(image.x, 0, 1),
			right: clamp(image.x + image.widthScale, 0, 1),
			top: clamp(image.y, 0, 1),
			bottom: clamp(image.y + image.heightScale, 0, 1)
		};
	}

	private getCombinedBounds(targets: SelectedTarget[]): { left: number; right: number; top: number; bottom: number } | null {
		const boundsList = targets
			.map((target) => this.getTargetBounds(target))
			.filter((bounds): bounds is { left: number; right: number; top: number; bottom: number } => !!bounds);
		if (boundsList.length === 0) {
			return null;
		}
		return {
			left: Math.min(...boundsList.map((bounds) => bounds.left)),
			right: Math.max(...boundsList.map((bounds) => bounds.right)),
			top: Math.min(...boundsList.map((bounds) => bounds.top)),
			bottom: Math.max(...boundsList.map((bounds) => bounds.bottom))
		};
	}

	private getSelectionPage(): number | null {
		if (this.selectedTargets.length === 0) {
			return null;
		}
		const pages = new Set(this.selectedTargets.map((target) => target.page));
		return pages.size === 1 ? this.selectedTargets[0].page : null;
	}

	private findTargetsInLasso(lasso: LassoSelection): SelectedTarget[] {
		if (!this.annotationDocument || lasso.points.length < 3) {
			return [];
		}
		const hits: SelectedTarget[] = [];
		const polygonBounds = getPolygonBounds(lasso.points);
		if (polygonBounds.right - polygonBounds.left < 0.002 || polygonBounds.bottom - polygonBounds.top < 0.002) {
			return [];
		}
		const testPoints = (bounds: { left: number; right: number; top: number; bottom: number }) => [
			{ x: bounds.left, y: bounds.top, pressure: 0.5 },
			{ x: bounds.right, y: bounds.top, pressure: 0.5 },
			{ x: bounds.left, y: bounds.bottom, pressure: 0.5 },
			{ x: bounds.right, y: bounds.bottom, pressure: 0.5 },
			{ x: (bounds.left + bounds.right) / 2, y: (bounds.top + bounds.bottom) / 2, pressure: 0.5 }
		];

		const lassoHitsBounds = (
			bounds: { left: number; right: number; top: number; bottom: number },
			extraHit?: () => boolean
		): boolean => {
			return (
				testPoints(bounds).some((point) => this.isPointInsidePolygon(point, lasso.points)) ||
				lasso.points.some((point) => point.x >= bounds.left && point.x <= bounds.right && point.y >= bounds.top && point.y <= bounds.bottom) ||
				this.doesPolygonIntersectBounds(lasso.points, bounds) ||
				(extraHit ? extraHit() : false)
			);
		};
		const maybeAdd = (
			target: SelectedTarget,
			bounds: { left: number; right: number; top: number; bottom: number } | null,
			extraHit?: () => boolean
		): void => {
			if (!bounds) {
				return;
			}
			if (!boundsOverlap(bounds, polygonBounds)) {
				return;
			}
			if (lassoHitsBounds(bounds, extraHit)) {
				hits.push(target);
			}
		};

		for (const item of this.annotationDocument.textItems) {
			if (item.page === lasso.page) {
				const lineBounds = this.getTextContentLineBounds(item, lasso.page);
				if (lineBounds.some((bounds) => boundsOverlap(bounds, polygonBounds) && lassoHitsBounds(bounds))) {
					hits.push({ kind: "text", id: item.id, page: item.page });
				}
			}
		}
		for (const image of this.annotationDocument.imageItems ?? []) {
			if (image.page === lasso.page) {
				maybeAdd({ kind: "image", id: image.id, page: image.page }, this.getImageBounds(image));
			}
		}
		for (const shape of this.annotationDocument.shapes) {
			if (shape.page === lasso.page) {
				maybeAdd(
					{ kind: "shape", id: shape.id, page: shape.page },
					getShapeBounds(shape),
					() => this.doesPolygonIntersectShape(lasso.points, shape)
				);
			}
		}
		for (const stroke of this.annotationDocument.strokes) {
			if (stroke.page === lasso.page) {
				const bounds = getStrokeBounds(stroke);
				if (
					boundsOverlap(bounds, polygonBounds) &&
					(
						stroke.points.some((point) => this.isPointInsidePolygon(point, lasso.points)) ||
						this.doesPolygonIntersectStroke(lasso.points, stroke)
					)
				) {
					hits.push({ kind: "stroke", id: stroke.id, page: stroke.page });
				}
			}
		}

		return hits;
	}

	private doesPolygonIntersectBounds(
		polygon: AnnotationPoint[],
		bounds: { left: number; right: number; top: number; bottom: number }
	): boolean {
		const rectPoints: AnnotationPoint[] = [
			{ x: bounds.left, y: bounds.top, pressure: 0.5 },
			{ x: bounds.right, y: bounds.top, pressure: 0.5 },
			{ x: bounds.right, y: bounds.bottom, pressure: 0.5 },
			{ x: bounds.left, y: bounds.bottom, pressure: 0.5 }
		];
		return this.doPolylinesIntersectClosed(polygon, rectPoints);
	}

	private doesPolygonIntersectShape(polygon: AnnotationPoint[], shape: ShapeAnnotation): boolean {
		if (shape.tool === "line") {
			return this.doesPolygonIntersectPolyline(polygon, [shape.start, shape.end]);
		}
		return this.doesPolygonIntersectBounds(polygon, getShapeBounds(shape));
	}

	private doesPolygonIntersectStroke(polygon: AnnotationPoint[], stroke: StrokeAnnotation): boolean {
		if (stroke.points.length < 2) {
			return stroke.points.some((point) => this.isPointInsidePolygon(point, polygon));
		}
		return this.doesPolygonIntersectPolyline(polygon, stroke.points);
	}

	private doesPolygonIntersectPolyline(polygon: AnnotationPoint[], polyline: AnnotationPoint[]): boolean {
		for (let polygonIndex = 1; polygonIndex < polygon.length; polygonIndex += 1) {
			const polygonStart = polygon[polygonIndex - 1];
			const polygonEnd = polygon[polygonIndex];
			for (let lineIndex = 1; lineIndex < polyline.length; lineIndex += 1) {
				const lineStart = polyline[lineIndex - 1];
				const lineEnd = polyline[lineIndex];
				if (segmentsIntersect(polygonStart, polygonEnd, lineStart, lineEnd)) {
					return true;
				}
			}
		}
		const lastPolygonPoint = polygon[polygon.length - 1];
		const firstPolygonPoint = polygon[0];
		for (let lineIndex = 1; lineIndex < polyline.length; lineIndex += 1) {
			if (segmentsIntersect(lastPolygonPoint, firstPolygonPoint, polyline[lineIndex - 1], polyline[lineIndex])) {
				return true;
			}
		}
		return false;
	}

	private doPolylinesIntersectClosed(firstPolygon: AnnotationPoint[], secondPolygon: AnnotationPoint[]): boolean {
		return this.doesPolygonIntersectPolyline(firstPolygon, [...secondPolygon, secondPolygon[0]]);
	}

	private isPointInsidePolygon(point: AnnotationPoint, polygon: AnnotationPoint[]): boolean {
		let inside = false;
		for (let current = 0, previous = polygon.length - 1; current < polygon.length; previous = current++) {
			const currentPoint = polygon[current];
			const previousPoint = polygon[previous];
			const intersects =
				((currentPoint.y > point.y) !== (previousPoint.y > point.y)) &&
				(point.x < ((previousPoint.x - currentPoint.x) * (point.y - currentPoint.y)) / ((previousPoint.y - currentPoint.y) || 0.000001) + currentPoint.x);
			if (intersects) {
				inside = !inside;
			}
		}
		return inside;
	}

	private getHandlePoints(bounds: { left: number; right: number; top: number; bottom: number }): Array<{ handle: ResizeHandle; x: number; y: number }> {
		const midX = (bounds.left + bounds.right) / 2;
		const midY = (bounds.top + bounds.bottom) / 2;
		return [
			{ handle: "nw", x: bounds.left, y: bounds.top },
			{ handle: "n", x: midX, y: bounds.top },
			{ handle: "ne", x: bounds.right, y: bounds.top },
			{ handle: "e", x: bounds.right, y: midY },
			{ handle: "se", x: bounds.right, y: bounds.bottom },
			{ handle: "s", x: midX, y: bounds.bottom },
			{ handle: "sw", x: bounds.left, y: bounds.bottom },
			{ handle: "w", x: bounds.left, y: midY }
		];
	}

	private getHandleHit(target: SelectedTarget, point: AnnotationPoint): ResizeHandle | null {
		const bounds = this.getTargetBounds(target);
		if (!bounds) {
			return null;
		}
		const threshold = this.getResizeHandleHitThreshold(target.page);
		for (const handlePoint of this.getHandlePoints(bounds)) {
			if (distanceBetween(point, { x: handlePoint.x, y: handlePoint.y }) <= threshold) {
				return handlePoint.handle;
			}
		}
		return null;
	}

	private getSelectionHandleHit(pageNumber: number, point: AnnotationPoint): ResizeHandle | null {
		if (this.selectedTargets.length === 0) {
			return null;
		}
		if (this.selectedTargets.length === 1) {
			const target = this.selectedTarget;
			if (!target || target.page !== pageNumber) {
				return null;
			}
			return this.getHandleHit(target, point);
		}
		const pageTargets = this.selectedTargets.filter((target) => target.page === pageNumber);
		if (pageTargets.length < 2) {
			return null;
		}
		const bounds = this.getCombinedBounds(pageTargets);
		if (!bounds) {
			return null;
		}
		const threshold = this.getResizeHandleHitThreshold(pageNumber);
		for (const handlePoint of this.getHandlePoints(bounds)) {
			if (distanceBetween(point, { x: handlePoint.x, y: handlePoint.y }) <= threshold) {
				return handlePoint.handle;
			}
		}
		return null;
	}
	private getSelectedTargetHit(pageNumber: number, point: AnnotationPoint): SelectedTarget | null {
		if (!this.annotationDocument) {
			return null;
		}
		const pageTargets = this.selectedTargets.filter((target) => target.page === pageNumber);
		if (pageTargets.length === 0) {
			return null;
		}
		const threshold = this.getGeometryHitThreshold(pageNumber);
		const candidates: HitCandidate[] = [];
		for (const target of pageTargets) {
			if (target.kind === "text") {
				const item = this.annotationDocument.textItems.find((entry) => entry.id === target.id);
				if (!item) {
					continue;
				}
				const lineBounds = this.getTextContentLineBounds(item, pageNumber);
				const hitBounds = lineBounds.filter((bounds) => pointInBounds(point, bounds, threshold));
				if (hitBounds.length > 0) {
					candidates.push({
						...target,
						score: Math.min(...hitBounds.map((bounds) => pointInBounds(point, bounds) ? -0.03 : distanceToBounds(point, bounds)))
					});
				}
				continue;
			}
			if (target.kind === "shape") {
				const shape = this.annotationDocument.shapes.find((entry) => entry.id === target.id);
				if (!shape) {
					continue;
				}
				const bounds = getShapeBounds(shape);
				if (shape.tool !== "line" && pointInBounds(point, bounds)) {
					candidates.push({ ...target, score: -0.02 });
					continue;
				}
				if (pointInBounds(point, bounds, threshold)) {
					const score = distanceToShape(point, shape);
					if (score <= threshold * 1.5 || pointInBounds(point, bounds)) {
						candidates.push({ ...target, score });
					}
				}
				continue;
			}
			const stroke = this.annotationDocument.strokes.find((entry) => entry.id === target.id);
			if (!stroke) {
				continue;
			}
			const score = distanceToStroke(point, stroke);
			const visibleRadius = getNormalizedStrokePadding(stroke.width, stroke.widthScale);
			if (score <= threshold + visibleRadius) {
				candidates.push({ ...target, score });
			}
		}
		if (candidates.length === 0) {
			return null;
		}
		candidates.sort((left, right) => left.score - right.score);
		const best = candidates[0];
		return { kind: best.kind, id: best.id, page: best.page };
	}
	private getCursorForHandle(handle: ResizeHandle): string {
		switch (handle) {
			case "nw":
			case "se":
				return "nwse-resize";
			case "n":
			case "s":
				return "ns-resize";
			case "ne":
			case "sw":
				return "nesw-resize";
			case "e":
			case "w":
				return "ew-resize";
		}
	}

	private showDrawingNotice(message: string, durationMs: number): void {
		if (this.plugin.shouldShowDrawingNotices()) {
			new Notice(message, durationMs);
		}
	}

	private pushHistory(): void {
		if (!this.annotationDocument) {
			return;
		}
		this.pushHistoryEntry({ kind: "document", document: cloneDocument(this.annotationDocument) });
	}

	private pushStrokeAddHistory(stroke: StrokeAnnotation): void {
		this.pushHistoryEntry({ kind: "stroke-add", stroke: this.cloneStroke(stroke) });
	}

	private pushHistoryEntry(entry: HistoryEntry): void {
		this.undoStack.push(entry);
		if (this.undoStack.length > MAX_HISTORY) {
			this.undoStack.shift();
		}
		this.redoStack = [];
	}

	private cloneStroke(stroke: StrokeAnnotation): StrokeAnnotation {
		return JSON.parse(JSON.stringify(stroke)) as StrokeAnnotation;
	}

	private markDirtyAndRedraw(message: string): void {
		this.invalidateAnnotationPageCache();
		this.isDirty = true;
		this.scheduleSave();
		this.drawAllAnnotations();
		this.refreshStatus(message);
	}

	private scheduleSave(): void {
		if (this.autosaveHandle !== null) {
			window.clearTimeout(this.autosaveHandle);
		}
		this.autosaveHandle = window.setTimeout(() => {
			void this.flushSave();
		}, this.plugin.getAutosaveDelayMs());
	}

	private destroyPageSurfaces(): void {
		this.finishFingerPan(false);
		this.cancelFingerPanInertia();
		this.unbindPdfPointerDocumentTracking();
		for (const surface of this.pageSurfaces.values()) {
			this.pageResizeObservers.get(surface.pageNumber)?.disconnect();
			surface.overlayEl.removeEventListener("pointerenter", this.handlePointerEnter);
			surface.overlayEl.removeEventListener("pointerdown", this.handlePointerDown);
			surface.overlayEl.removeEventListener("pointermove", this.handlePointerMove);
			surface.overlayEl.removeEventListener("pointerup", this.handlePointerUp);
			surface.overlayEl.removeEventListener("pointercancel", this.handlePointerCancel);
			surface.overlayEl.removeEventListener("pointerleave", this.handlePointerLeave);
			surface.overlayEl.remove();
			surface.transientEl.remove();
		}
		this.pageResizeObservers.clear();
		this.zoomingPages.clear();
		this.pageSurfaces.clear();
		this.handleToolbarDragEnd();
		const viewContentEl = this.getViewContentEl();
		viewContentEl?.removeEventListener("touchstart", this.handleZoomGestureTouchStart, { capture: true });
		viewContentEl?.removeEventListener("wheel", this.handleZoomGestureWheel, { capture: true });
		viewContentEl?.removeEventListener("gesturestart", this.handleZoomGestureStart, { capture: true });
		viewContentEl?.removeEventListener("pointerdown", this.handleViewPointerDown, { capture: true });
		viewContentEl?.removeEventListener("pointermove", this.handleViewPointerMove);
		viewContentEl?.removeEventListener("pointerleave", this.handleViewPointerLeave);
		document.removeEventListener("pointerdown", this.handleDocumentPointerDown, true);
		document.removeEventListener("touchstart", this.handleDocumentTouchStart, true);
	}

	async diagnoseOverlayState(): Promise<void> {
		this.syncPages();
		this.forceRedrawAllAnnotations();
		const pageNumber = this.currentPage;
		const surface = this.pageSurfaces.get(pageNumber) ?? Array.from(this.pageSurfaces.values())[0] ?? null;
		if (!surface) {
			const report = {
				pageNumber,
				surfaces: this.pageSurfaces.size,
				error: "No page surface is registered"
			};
			await writeClipboardText(JSON.stringify(report, null, 2));
			this.refreshStatus("Overlay diagnostic copied: no page surface", 8000);
			new Notice("Freedraw PDF diagnostic copied to clipboard.");
			return;
		}

		const pageRect = surface.pageEl.getBoundingClientRect();
		const hostRect = surface.hostEl.getBoundingClientRect();
		const overlayRect = surface.overlayEl.getBoundingClientRect();
		const centerX = overlayRect.left + overlayRect.width / 2;
		const centerY = overlayRect.top + overlayRect.height / 2;
		const stack = document.elementsFromPoint(centerX, centerY).slice(0, 8).map((element) => ({
			tag: element.tagName.toLowerCase(),
			className: isHtmlElement(element) ? element.className : "",
			id: element.id || ""
		}));
		const bucket = this.getPageAnnotationBucket(surface.pageNumber);
		const context = surface.overlayEl.getContext("2d");
		const overlayStyle = window.getComputedStyle(surface.overlayEl);
		let alphaPixels = 0;
		if (context && surface.overlayEl.width > 0 && surface.overlayEl.height > 0) {
			const sampleWidth = Math.min(surface.overlayEl.width, 240);
			const sampleHeight = Math.min(surface.overlayEl.height, 240);
			const data = context.getImageData(0, 0, sampleWidth, sampleHeight).data;
			for (let index = 3; index < data.length; index += 4) {
				if (data[index] > 0) {
					alphaPixels += 1;
				}
			}
		}
		const report = {
			pageNumber: surface.pageNumber,
			currentPage: this.currentPage,
			annotationMode: this.annotationMode,
			surfaces: this.pageSurfaces.size,
			annotations: {
				strokes: bucket.strokes.length,
				textItems: bucket.textItems.length,
				shapes: bucket.shapes.length,
				imageItems: bucket.imageItems.length
			},
			pageRect: this.roundRectForDiagnostic(pageRect),
			hostRect: this.roundRectForDiagnostic(hostRect),
			overlayRect: this.roundRectForDiagnostic(overlayRect),
			canvas: {
				width: surface.overlayEl.width,
				height: surface.overlayEl.height,
				styleWidth: overlayStyle.width,
				styleHeight: overlayStyle.height,
				visibility: overlayStyle.visibility,
				display: overlayStyle.display,
				opacity: overlayStyle.opacity,
				pointerEvents: overlayStyle.pointerEvents,
				alphaPixels
			},
			connection: {
				pageConnected: surface.pageEl.isConnected,
				hostConnected: surface.hostEl.isConnected,
				overlayConnected: surface.overlayEl.isConnected,
				overlayParentClass: isHtmlElement(surface.overlayEl.parentElement) ? surface.overlayEl.parentElement.className : null
			},
			topStack: stack
		};
		await writeClipboardText(JSON.stringify(report, null, 2));
		this.refreshStatus(`Overlay diagnostic copied: p${surface.pageNumber}, alpha ${alphaPixels}`, 10000);
		new Notice("Freedraw PDF diagnostic copied to clipboard.");
	}

	private roundRectForDiagnostic(rect: DOMRect): { left: number; top: number; width: number; height: number; right: number; bottom: number } {
		const round = (value: number): number => Math.round(value * 10) / 10;
		return {
			left: round(rect.left),
			top: round(rect.top),
			width: round(rect.width),
			height: round(rect.height),
			right: round(rect.right),
			bottom: round(rect.bottom)
		};
	}

	private refreshStatus(message: string, durationMs = 2500): void {
		if (this.statusEl) {
			this.statusEl.textContent = message;
		}
		if (this.statusResetHandle !== null) {
			window.clearTimeout(this.statusResetHandle);
			this.statusResetHandle = null;
		}
		if (durationMs > 0) {
			this.statusResetHandle = window.setTimeout(() => {
				this.statusResetHandle = null;
				if (this.statusEl?.textContent === message) {
					this.statusEl.textContent = "";
				}
			}, durationMs);
		}
	}

	private showStartupError(message: string): void {
		this.refreshStatus(message, 6000);
		if (!this.startupErrorShown) {
			this.startupErrorShown = true;
			new Notice(message);
		}
	}
}

export default class PDFAnnotatorPlugin extends Plugin {
	private store!: AnnotationStore;
	private annotatedEmbeds!: AnnotatedEmbedController;
	private settingsController!: PDFAnnotatorSettingsController;
	private sessions = new Map<WorkspaceLeaf, NativePdfAnnotatorSession>();
	private clipboard: AnnotationClipboardPayload | null = null;

	async onload(): Promise<void> {
		this.settingsController = new PDFAnnotatorSettingsController(
			() => this.loadData(),
			(data) => this.saveData(data),
			() => {
				setInkRenderSettings(this.settingsController.getInkRenderSettings());
				for (const session of this.sessions.values()) {
					session.refreshSettings();
				}
			}
		);
		await this.settingsController.load();
		setInkRenderSettings(this.settingsController.getInkRenderSettings());
		this.store = new AnnotationStore(this.app);
		this.annotatedEmbeds = new AnnotatedEmbedController(this.app, this.store, {
			shouldShowAnnotatedEmbedHeader: () => this.shouldShowAnnotatedEmbedHeader(),
			openPdfPage: (file, pageNumber, rect) => this.openPdfPage(file, pageNumber, rect),
			writeClipboardText: (text) => this.writeClipboardText(text)
		});
		this.addSettingTab(new PDFAnnotatorSettingTab(this.app, this));
		this.registerMarkdownCodeBlockProcessor("freedraw-pdf", (source, el, context) => {
			void this.annotatedEmbeds.renderMarkdownBlock(source, el, context.sourcePath);
		});
		this.addRibbonIcon("pen-tool", "Toggle annotation mode on active PDF", async () => {
			const session = await this.ensureActivePdfSession();
			if (!session) {
				new Notice("Open a PDF in Obsidian's built-in viewer first.");
				return;
			}
			session.toggleAnnotationMode();
		});
		this.addRibbonIcon("file-plus-2", "Create blank annotatable PDF", () => {
			this.openBlankAnnotatablePdfModal();
		});
		this.addCommand({
			id: "toggle-active-pdf-annotation-mode",
			name: "Toggle annotation mode on active PDF",
			checkCallback: (checking: boolean) => {
				const canRun = !!this.getActivePdfLeaf();
				if (canRun && !checking) {
					void this.toggleActiveSessionMode();
				}
				return canRun;
			}
		});

		this.addCommand({
			id: "create-blank-annotatable-pdf",
			name: "Create blank annotatable PDF",
			callback: () => {
				this.openBlankAnnotatablePdfModal();
			}
		});

		registerSessionCommands(
			(command) => this.addCommand(command),
			() => this.getSessionForLeaf(this.getActivePdfLeaf()),
			[
				{ id: "copy-current-page-pdf-link", name: "Copy current PDF page link", run: (session) => session.copyCurrentPageLink() },
				{ id: "open-active-pdf-annotation-json", name: "Open active PDF annotation data JSON", run: (session) => session.openAnnotationDataJson() },
				{ id: "export-current-page-snapshot", name: "Export current annotated page as PNG", run: (session) => session.exportCurrentPageSnapshot() },
				{ id: "export-annotated-mixed-pdf", name: "Export annotated mixed PDF", run: (session) => session.exportAnnotatedMixedDocumentPdf() },
				{ id: "create-native-mixed-working-pdf", name: "Advanced: create native mixed working PDF", run: (session) => session.materializeNativeMixedWorkingPdf() },
				{ id: "insert-native-notebook-page-after-current", name: "Add temporary template page after current PDF page", run: (session) => session.openTemplatePageInsertModal("after") },
				{ id: "insert-native-notebook-page-before-current", name: "Add temporary template page before current PDF page", run: (session) => session.openTemplatePageInsertModal("before") }
			]
		);

		this.addCommand({
			id: "copy-current-page-annotated-embed",
			name: "Copy annotated PDF page embed",
			checkCallback: (checking: boolean) => {
				const source = this.getPreferredPdfInsertionSource();
				const canRun = !!source;
				if (canRun && !checking) {
					void this.copyAnnotatedPdfEmbedBlock(source.file, source.page);
				}
				return canRun;
			}
		});

		this.addCommand({
			id: "insert-current-page-annotated-embed",
			name: "Insert annotated PDF page embed",
			checkCallback: (checking: boolean) => {
				const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
				const source = this.getPreferredPdfInsertionSource();
				const canRun = !!markdownView && !!source;
				if (canRun && !checking) {
					this.annotatedEmbeds.insertBlock(markdownView, source.file, source.page);
				}
				return canRun;
			}
		});

		this.addCommand({
			id: "insert-selected-region-annotated-embed",
			name: "Insert annotated PDF selected region embed",
			checkCallback: (checking: boolean) => {
				const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
				const source = this.getPreferredPdfRegionInsertionSource();
				const canRun = !!markdownView && !!source;
				if (canRun && !checking) {
					this.annotatedEmbeds.insertBlock(markdownView, source.file, source.page, source.rect);
				}
				return canRun;
			}
		});

		registerSessionCommands(
			(command) => this.addCommand(command),
			() => this.getSessionForLeaf(this.getActivePdfLeaf()),
			[
				{ id: "pdf-previous-mixed-page", name: "PDF: Go to previous page", isEnabled: (session) => session.canNavigatePage(-1), run: (session) => session.goToPreviousPage() },
				{ id: "pdf-next-mixed-page", name: "PDF: Go to next page", isEnabled: (session) => session.canNavigatePage(1), run: (session) => session.goToNextPage() },
				{ id: "pdf-undo-annotation-change", name: "PDF: Undo annotation change", run: (session) => session.undo() },
				{ id: "pdf-redo-annotation-change", name: "PDF: Redo annotation change", run: (session) => session.redo() },
				{ id: "pdf-open-mixed-page-list", name: "PDF: Open mixed page list", run: (session) => session.openMixedPageList() },
				{ id: "pdf-open-go-to-page", name: "PDF: Go to page...", run: (session) => session.openGoToPage() },
				{ id: "pdf-add-template-page-end", name: "PDF: Quick add template page to end", run: (session) => session.addTemplatePageToEnd() },
				{ id: "pdf-add-template-page-before", name: "PDF: Quick add template page before current page", run: (session) => session.addTemplatePageBeforeCurrent() },
				{ id: "pdf-add-template-page-after", name: "PDF: Quick add template page after current page", run: (session) => session.addTemplatePageAfterCurrent() },
				{ id: "pdf-duplicate-current-added-page", name: "PDF: Duplicate current added page", isEnabled: (session) => session.hasCurrentAddedPage(), run: (session) => session.duplicateCurrentAddedPage() },
				{ id: "pdf-duplicate-current-added-page-structure", name: "PDF: Duplicate current added page structure only", isEnabled: (session) => session.hasCurrentAddedPage(), run: (session) => session.duplicateCurrentAddedPage(false) },
				{ id: "pdf-clear-current-added-page", name: "PDF: Clear current added page contents", isEnabled: (session) => session.hasCurrentAddedPage(), run: (session) => session.clearCurrentAddedPageContents() },
				{ id: "pdf-delete-current-added-page", name: "PDF: Move current page to Removed", run: (session) => session.deleteCurrentPage() },
				{ id: "select-all-page-annotations", name: "Select all annotations on current PDF page", run: (session) => session.selectAllCurrentPageAnnotations() },
				{ id: "duplicate-selected-annotations", name: "Duplicate selected annotations", run: (session) => session.duplicateSelectedTargets() },
				{ id: "delete-selected-annotations", name: "Delete selected annotations", run: (session) => session.deleteSelectedTargets() },
				{ id: "copy-selected-annotations", name: "Copy selected annotations", run: (session) => session.copySelectedTargets() },
				{ id: "cut-selected-annotations", name: "Cut selected annotations", run: (session) => session.cutSelectedTargets() },
				{ id: "bring-selected-annotations-to-front", name: "Bring selected annotations to front", run: (session) => session.reorderSelectedTargets("front") },
				{ id: "send-selected-annotations-to-back", name: "Send selected annotations to back", run: (session) => session.reorderSelectedTargets("back") },
				{ id: "paste-selected-annotations", name: "Paste copied annotations", isEnabled: () => this.hasClipboard(), run: (session) => session.pasteClipboard() },
				{ id: "paste-selected-annotations-in-place", name: "Paste copied annotations in place", isEnabled: () => this.hasClipboard(), run: (session) => session.pasteClipboard(true) },
				{ id: "export-selection-snapshot", name: "Export selection snapshot", run: (session) => session.exportSelectionSnapshot() },
				{ id: "copy-selection-region-reference", name: "Copy selection region reference", run: (session) => session.copySelectionRegionReference() },
				{ id: "copy-selection-annotated-embed", name: "Copy selected region annotated embed", run: (session) => session.copySelectionAnnotatedEmbedBlock() },
				{ id: "diagnose-pdf-annotation-overlay", name: "Diagnose PDF annotation overlay", run: (session) => session.diagnoseOverlayState() }
			]
		);

		this.addCommand({
			id: "open-selection-region-reference-from-clipboard",
			name: "Open selection region reference from clipboard",
			callback: () => {
				void this.openRegionReferenceFromClipboard();
			}
		});

		this.registerEvent(this.app.workspace.on("active-leaf-change", () => {
			void this.syncSessions();
		}));
		this.registerEvent(this.app.workspace.on("file-open", () => {
			void this.syncSessions();
		}));
		this.registerEvent(this.app.workspace.on("layout-change", () => {
			void Promise.all(Array.from(this.sessions.values()).map((session) => session.refreshLayoutAndFlush()));
		}));
		this.registerEvent(this.app.vault.on("rename", (abstractFile: TAbstractFile, oldPath: string) => {
			if (!(abstractFile instanceof TFile) || abstractFile.extension.toLowerCase() !== "pdf") {
				return;
			}
			void this.store.migrateForRename(abstractFile, oldPath);
		}));
		this.registerEvent(this.app.vault.on("delete", (abstractFile: TAbstractFile) => {
			if (!(abstractFile instanceof TFile) || abstractFile.extension.toLowerCase() !== "pdf") {
				return;
			}
			void this.deleteAnnotationSidecarForDeletedPdf(abstractFile);
		}));
		this.registerEvent(this.app.vault.on("modify", (file) => {
			if (file instanceof TFile) {
				this.annotatedEmbeds.refreshForPath(file.path);
			}
		}));

		void this.syncSessions();
	}

	onunload(): void {
		this.settingsController.dispose();
		for (const session of this.sessions.values()) {
			session.detach();
		}
		this.sessions.clear();
	}

	private async deleteAnnotationSidecarForDeletedPdf(file: TFile): Promise<void> {
		try {
			const deleted = await this.store.deleteForPdfPath(file.path);
			if (deleted) {
				this.annotatedEmbeds.refreshForPath(`${file.path}.annot.json`);
				new Notice(`Deleted annotation data for ${file.name}.`);
			}
		} catch (error) {
			console.error(`freedraw-pdf: failed to delete annotation data for ${file.path}`, error);
			new Notice(`Could not delete annotation data for ${file.name}.`);
		}
	}

	openBlankAnnotatablePdfModal(): void {
		new BlankAnnotatablePdfModal(this.app, (options) => {
			void this.createBlankAnnotatablePdf(options);
		}).open();
	}

	async createBlankAnnotatablePdf(options: BlankAnnotatablePdfOptions): Promise<void> {
		try {
			const activeFile = this.app.workspace.getActiveFile();
			const folderPrefix = activeFile?.parent?.path ? `${activeFile.parent.path}/` : "";
			const baseName = (options.title.trim() || "New annotatable PDF").replace(/[\\/:*?"<>|]/g, "-");
			const pageCount = clamp(Math.round(options.pageCount), 1, 200);
			let path = `${folderPrefix}${baseName}.pdf`;
			let counter = 2;
			while (this.app.vault.getAbstractFileByPath(path)) {
				path = `${folderPrefix}${baseName} ${counter}.pdf`;
				counter += 1;
			}

			const templatePage = createTemplateNotebookPage("Page 1", options.template, options.pageSize, options.paperColor);
			const renderDimensions = getNotebookPageRenderDimensions(templatePage.pageSize, BLANK_PDF_EXPORT_WIDTH_PX);
			const pages = [];
			for (let index = 0; index < pageCount; index += 1) {
				const canvas = createEl("canvas");
				canvas.width = renderDimensions.width;
				canvas.height = renderDimensions.height;
				const context = canvas.getContext("2d");
				if (!context) {
					new Notice("Could not create blank PDF canvas.");
					return;
				}
				context.fillStyle = options.paperColor || "#fffdf7";
				context.fillRect(0, 0, canvas.width, canvas.height);
				pages.push({
					widthPx: canvas.width,
					heightPx: canvas.height,
					jpegBytes: new Uint8Array(dataUrlToArrayBuffer(canvas.toDataURL("image/jpeg", 0.92)))
				});
			}
			const pdfBytes = buildPdfFromJpegPages(pages);
			const pdfBuffer = new ArrayBuffer(pdfBytes.byteLength);
			new Uint8Array(pdfBuffer).set(pdfBytes);
			const pdfFile = await this.app.vault.createBinary(path, pdfBuffer);
			const annotationDocument = createEmptyDocument(pdfFile);
			annotationDocument.nativePageTemplatesEditable = true;
			annotationDocument.pdfPageTemplates = Array.from({ length: pageCount }, (_, index) => ({
				page: index + 1,
				template: options.template,
				paperColor: options.paperColor,
				pageSize: options.pageSize
			}));
			await this.store.save(pdfFile, annotationDocument);
			new Notice(`Created ${pdfFile.name} (${pageCount} page${pageCount === 1 ? "" : "s"})`);
			await this.openPdfPage(pdfFile, 1);
		} catch (error) {
			console.error("freedraw-pdf: failed to create blank annotatable PDF", error);
			new Notice("Could not create blank annotatable PDF. Check the developer console for details.");
		}
	}

	getToolDefaults(): ToolStateSnapshot {
		return this.settingsController.getToolDefaults();
	}

	getTextColor(): string {
		return this.settingsController.getTextColor();
	}

	shouldPreferInlineToolbar(): boolean {
		return this.settingsController.getInlineToolbarPreference() && !this.isPdfPlusEnabled();
	}

	getInlineToolbarPreference(): boolean {
		return this.settingsController.getInlineToolbarPreference();
	}

	getAutosaveDelayMs(): number {
		return this.settingsController.getAutosaveDelayMs();
	}

	shouldShowRegionToolbarButton(): boolean {
		return this.settingsController.shouldShowRegionToolbarButton();
	}

	shouldShowCopyEmbedToolbarButton(): boolean {
		return this.settingsController.shouldShowCopyEmbedToolbarButton();
	}

	shouldAutoCopyRegionEmbed(): boolean {
		return this.settingsController.shouldAutoCopyRegionEmbed();
	}

	shouldShowAnnotatedEmbedHeader(): boolean {
		return this.settingsController.shouldShowAnnotatedEmbedHeader();
	}

	shouldShowDrawingNotices(): boolean {
		return this.settingsController.shouldShowDrawingNotices();
	}

	shouldShowRenderTelemetry(): boolean {
		return this.settingsController.shouldShowRenderTelemetry();
	}

	getInkInputPolicy(): InkInputPolicy {
		return this.settingsController.getInkInputPolicy();
	}

	getLivePreviewMode(): LivePreviewMode {
		return this.settingsController.getLivePreviewMode();
	}

	getInkRenderSettings(): InkRenderSettings {
		return this.settingsController.getInkRenderSettings();
	}

	getStoredPresets(): ToolPreset[] {
		return this.settingsController.getStoredPresets();
	}

	getPreferredPdfInsertionSource(): { file: TFile; page: number } | null {
		const activeSession = this.getSessionForLeaf(this.getActivePdfLeaf());
		if (activeSession?.currentFile) {
			return {
				file: activeSession.currentFile,
				page: activeSession.activePage
			};
		}
		for (const session of this.sessions.values()) {
			if (session.currentFile) {
				return {
					file: session.currentFile,
					page: session.activePage
				};
			}
		}
		return null;
	}

	getPreferredPdfRegionInsertionSource(): { file: TFile; page: number; rect: NormalizedRect } | null {
		const activeRegion = this.getSessionForLeaf(this.getActivePdfLeaf())?.getActiveRegionEmbedSource();
		if (activeRegion) {
			return activeRegion;
		}
		for (const session of this.sessions.values()) {
			const region = session.getActiveRegionEmbedSource();
			if (region) {
				return region;
			}
		}
		return null;
	}

	getClipboard(): AnnotationClipboardPayload | null {
		if (!this.clipboard) {
			return null;
		}
		return {
			strokes: this.clipboard.strokes.map((stroke) => JSON.parse(JSON.stringify(stroke)) as StrokeAnnotation),
			textItems: this.clipboard.textItems.map((item) => JSON.parse(JSON.stringify(item)) as TextAnnotation),
			shapes: this.clipboard.shapes.map((shape) => JSON.parse(JSON.stringify(shape)) as ShapeAnnotation),
			imageItems: (this.clipboard.imageItems ?? []).map((image) => JSON.parse(JSON.stringify(image)) as ImageAnnotation)
		};
	}

	setClipboard(payload: AnnotationClipboardPayload): void {
		this.clipboard = {
			strokes: payload.strokes.map((stroke) => JSON.parse(JSON.stringify(stroke)) as StrokeAnnotation),
			textItems: payload.textItems.map((item) => JSON.parse(JSON.stringify(item)) as TextAnnotation),
			shapes: payload.shapes.map((shape) => JSON.parse(JSON.stringify(shape)) as ShapeAnnotation),
			imageItems: (payload.imageItems ?? []).map((image) => JSON.parse(JSON.stringify(image)) as ImageAnnotation)
		};
		for (const session of this.sessions.values()) {
			if (session.isActive()) {
				session.refreshUiState();
			}
		}
	}

	hasClipboard(): boolean {
		return !!this.clipboard &&
			(this.clipboard.strokes.length > 0 || this.clipboard.textItems.length > 0 || this.clipboard.shapes.length > 0 || (this.clipboard.imageItems?.length ?? 0) > 0);
	}

	async openRegionReference(raw: string): Promise<boolean> {
		const reference = parseRegionReference(raw);
		if (!reference) {
			return false;
		}
		const file = this.app.vault.getAbstractFileByPath(reference.filePath);
		if (!(file instanceof TFile) || file.extension.toLowerCase() !== "pdf") {
			return false;
		}

		const leaf = this.app.workspace.getLeaf(true);
		await leaf.openFile(file);
		await this.syncSessions();
		const session = this.getSessionForLeaf(leaf);
		if (!session) {
			return false;
		}
		session.focusRegion(reference.page, reference.rect);
		return true;
	}

	async openRegionReferenceFromClipboard(): Promise<void> {
		try {
			const raw = await readClipboardText();
			const opened = await this.openRegionReference(raw);
			if (!opened) {
				new Notice("Clipboard does not contain a valid selection region reference.");
				return;
			}
			new Notice("Opened selection region reference.");
		} catch (error) {
			console.error("freedraw-pdf: failed to open region reference from clipboard", error);
			new Notice("Could not read clipboard for region reference.");
		}
	}

	updateToolPreferences(snapshot: ToolStateSnapshot, presets: ToolPreset[]): void {
		this.settingsController.updateToolPreferences(snapshot, presets);
	}

	updateTextColor(color: string): void {
		this.settingsController.updateTextColor(color);
	}

	async updateBehaviorSettings(nextSettings: Partial<Pick<PDFAnnotatorSettings, "preferInlineToolbar" | "showRegionToolbarButton" | "showCopyEmbedToolbarButton" | "autoCopyRegionEmbed" | "showAnnotatedEmbedHeader" | "showDrawingNotices" | "showRenderTelemetry" | "inkInputPolicy" | "livePreviewMode" | "inkRenderSettings" | "autosaveDelayMs">>): Promise<void> {
		await this.settingsController.updateBehaviorSettings(nextSettings);
	}

	async writeClipboardText(text: string): Promise<void> {
		await writeClipboardText(text);
	}

	buildAnnotatedPdfEmbedBlock(file: TFile, page: number, rect?: NormalizedRect | null, width = 720): string {
		return this.annotatedEmbeds.buildBlock(file, page, rect, width);
	}

	async copyAnnotatedPdfEmbedBlock(file: TFile, page: number, rect?: NormalizedRect | null): Promise<void> {
		await this.annotatedEmbeds.copyBlock(file, page, rect);
	}

	refreshAnnotatedEmbedsForPath(path: string): void {
		this.annotatedEmbeds.refreshForPath(path);
	}

	async openPdfFileAtPage(file: TFile, pageNumber: number): Promise<void> {
		await this.openPdfPage(file, pageNumber);
	}

	private async openPdfPage(file: TFile, pageNumber: number, rect?: NormalizedRect | null): Promise<void> {
		const leaf = this.app.workspace.getLeaf(true);
		await leaf.openFile(file);
		await this.syncSessions();
		const session = this.getSessionForLeaf(leaf);
		if (!session) {
			new Notice(`Opened ${file.name}. Page ${pageNumber} will be available after the PDF view finishes loading.`);
			return;
		}
		if (rect) {
			session.focusRegion(pageNumber, rect);
			return;
		}
		session.focusPage(pageNumber);
	}

	private async toggleActiveSessionMode(): Promise<void> {
		const session = await this.ensureActivePdfSession();
		if (!session) {
			new Notice("Open a PDF in Obsidian's built-in viewer first.");
			return;
		}
		session.toggleAnnotationMode();
	}

	private async ensureActivePdfSession(): Promise<NativePdfAnnotatorSession | null> {
		const leaf = this.getActivePdfLeaf();
		if (!leaf) {
			return null;
		}
		let session = this.sessions.get(leaf) ?? this.createSession(leaf);
		await session.attach();
		return session.isActive() ? session : null;
	}

	private async syncSessions(): Promise<void> {
		const keep = new Set<WorkspaceLeaf>();

		for (const leaf of this.getOpenPdfLeaves()) {
			let session = this.sessions.get(leaf);
			if (!session) {
				session = this.createSession(leaf);
			}
			await session.attach();
			keep.add(leaf);
		}

		for (const [leaf, session] of this.sessions.entries()) {
			if (!keep.has(leaf)) {
				session.detach();
				this.sessions.delete(leaf);
			}
		}
	}

	private getSessionForLeaf(leaf: WorkspaceLeaf | null): NativePdfAnnotatorSession | null {
		return leaf ? this.sessions.get(leaf) ?? null : null;
	}

	private createSession(leaf: WorkspaceLeaf): NativePdfAnnotatorSession {
		const session = new NativePdfAnnotatorSession(this, leaf, this.store);
		this.sessions.set(leaf, session);
		return session;
	}

	isPdfPlusEnabled(): boolean {
		const plugins = (this.app as App & { plugins?: { enabledPlugins?: Set<string>; plugins?: Record<string, unknown> } }).plugins;
		if (!plugins) {
			return false;
		}
		if (plugins.enabledPlugins) {
			return plugins.enabledPlugins.has("pdf-plus");
		}
		return Boolean(plugins.plugins?.["pdf-plus"]);
	}

	private getActivePdfLeaf(): WorkspaceLeaf | null {
		const leaf = this.app.workspace.getActiveViewOfType(FileView)?.leaf ?? null;
		if (!leaf) {
			return null;
		}
		return this.isPdfLeaf(leaf) ? leaf : null;
	}

	private getOpenPdfLeaves(): WorkspaceLeaf[] {
		return this.app.workspace.getLeavesOfType("pdf").filter((leaf) => this.isPdfLeaf(leaf));
	}

	private isPdfLeaf(leaf: WorkspaceLeaf): boolean {
		const view = leaf.view as PdfLikeView;
		const file = view.file;
		return !!(file && file.extension.toLowerCase() === "pdf");
	}
}
