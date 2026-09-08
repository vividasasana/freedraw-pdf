import type { PDFAnnotatorSettings, ToolPreset, ToolPresetKind, ToolStateSnapshot } from "./types";

export const ANNOTATION_FILE_SUFFIX = ".annot.json";
export const MAX_HISTORY = 100;
export const PAGE_VIRTUALIZATION_MARGIN = 0;
export const ZOOM_SETTLE_DELAY_MS = 120;
export const SESSION_ROOT_CLASS = "pdf-native-annotator-ui";
export const OVERLAY_CLASS = "pdf-native-annotator-overlay";
export const PAGE_SELECTORS = [
	".pdfViewer .page[data-page-number]",
	".page[data-page-number]",
	".pdf-page[data-page-number]"
].join(", ");
export const PAGE_HOST_SELECTORS = [
	".canvasWrapper",
	".page canvas",
	".pdf-page canvas"
].join(", ");
export const TOOLBAR_SELECTORS = [
	".pdf-toolbar"
].join(", ");

export const TOOL_WIDTH_RANGES: Record<ToolPresetKind, { min: number; max: number; step: number }> = {
	pen: { min: 1, max: 48, step: 0.5 },
	highlighter: { min: 4, max: 64, step: 0.5 },
	eraser: { min: 4, max: 80, step: 1 }
};

export function clampToolWidth(kind: ToolPresetKind, width: number): number {
	const range = TOOL_WIDTH_RANGES[kind];
	const finiteWidth = Number.isFinite(width) ? width : DEFAULT_TOOL_STATE.widths[kind];
	return Math.max(range.min, Math.min(range.max, finiteWidth));
}

export const DEFAULT_TOOL_PRESETS: ToolPreset[] = [
	{ id: "pen-slot-1", label: "Pen 1", kind: "pen", color: "#ff6b57", width: 3, opacity: 0.96 },
	{ id: "pen-slot-2", label: "Pen 2", kind: "pen", color: "#55b4ff", width: 5, opacity: 0.96 },
	{ id: "pen-slot-3", label: "Pen 3", kind: "pen", color: "#a855f7", width: 8, opacity: 0.96 },
	{ id: "highlight-slot-1", label: "Highlighter 1", kind: "highlighter", color: "#ffcb47", width: 12, opacity: 0.24 },
	{ id: "highlight-slot-2", label: "Highlighter 2", kind: "highlighter", color: "#6bcf8a", width: 16, opacity: 0.22 },
	{ id: "highlight-slot-3", label: "Highlighter 3", kind: "highlighter", color: "#8fdff0", width: 20, opacity: 0.22 },
	{ id: "eraser-slot-1", label: "Eraser 1", kind: "eraser", color: "#ffffff", width: 10, opacity: 1 },
	{ id: "eraser-slot-2", label: "Eraser 2", kind: "eraser", color: "#ffffff", width: 18, opacity: 1 },
	{ id: "eraser-slot-3", label: "Eraser 3", kind: "eraser", color: "#ffffff", width: 30, opacity: 1 }
];

export const TEXT_FONT_FAMILIES = [
	"Segoe UI",
	"Georgia",
	"Times New Roman",
	"Verdana",
	"Courier New"
];

export const TEXT_FONT_SIZES = [12, 14, 16, 18, 20, 24, 28, 32, 40, 48];

export const TEXT_COLOR_PRESETS = [
	{ color: "#202124", label: "Black" },
	{ color: "#ff6b57", label: "Coral" },
	{ color: "#ffcb47", label: "Yellow" },
	{ color: "#55b4ff", label: "Blue" },
	{ color: "#6bcf8a", label: "Green" },
	{ color: "#a855f7", label: "Violet" }
];

export const PAPER_COLOR_PRESETS = [
	{ label: "Cream", color: "#fffdf7" },
	{ label: "White", color: "#ffffff" },
	{ label: "Soft yellow", color: "#fff7cc" },
	{ label: "Blue tint", color: "#eef6ff" },
	{ label: "Green tint", color: "#effaf0" },
	{ label: "Gray", color: "#f3f3f3" }
];

export const DEFAULT_TOOL_STATE: ToolStateSnapshot = {
	activeTool: "pen",
	activeColor: "#ff6b57",
	activeOpacity: 0.96,
	eraserMode: "segment",
	selectionMode: "single",
	selectedPresetId: "pen-slot-1",
	selectedPresetIds: {
		pen: "pen-slot-1",
		highlighter: "highlight-slot-1",
		eraser: "eraser-slot-2"
	},
	widths: {
		pen: 4,
		highlighter: 12,
		eraser: 18
	}
};

export const DEFAULT_SETTINGS: PDFAnnotatorSettings = {
	pressureCaptureVersion: 1,
	toolDefaults: {
		...DEFAULT_TOOL_STATE,
		selectedPresetIds: { ...(DEFAULT_TOOL_STATE.selectedPresetIds ?? {}) },
		widths: { ...DEFAULT_TOOL_STATE.widths }
	},
	presets: DEFAULT_TOOL_PRESETS.map((preset) => ({ ...preset })),
	textColor: TEXT_COLOR_PRESETS[0].color,
	preferInlineToolbar: true,
	showRegionToolbarButton: false,
	showCopyEmbedToolbarButton: false,
	autoCopyRegionEmbed: true,
	showAnnotatedEmbedHeader: false,
	showDrawingNotices: false,
	showRenderTelemetry: false,
	inkInputPolicy: "allow-touch",
	livePreviewMode: "balanced",
	inkRenderSettings: {
		thinning: 0.5,
		streamline: 0.5,
		smoothing: 0.5,
		easing: "linear",
		taperStart: 0,
		taperEnd: 0,
		pressureMode: "auto"
	},
	autosaveDelayMs: 600
};

export function normalizeToolPresets(presets: ToolPreset[] | undefined): ToolPreset[] {
	const incoming = Array.isArray(presets) ? presets : [];
	const normalized: ToolPreset[] = [];
	for (const kind of ["pen", "highlighter", "eraser"] as ToolPresetKind[]) {
		const defaults = DEFAULT_TOOL_PRESETS.filter((preset) => preset.kind === kind);
		const saved = incoming.filter((preset) => preset.kind === kind);
		for (let index = 0; index < defaults.length; index += 1) {
			const fallback = defaults[index];
			const stored = incoming.find((preset) => preset.id === fallback.id) ?? saved[index];
			normalized.push({
				...fallback,
				color: stored?.color ?? fallback.color,
				width: clampToolWidth(kind, typeof stored?.width === "number" ? stored.width : fallback.width),
				opacity: typeof stored?.opacity === "number" ? stored.opacity : fallback.opacity
			});
		}
	}
	return normalized;
}
