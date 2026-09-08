import { DEFAULT_SETTINGS, clampToolWidth, normalizeToolPresets } from "../config";
import type { InkEasingMode, InkInputPolicy, InkPressureMode, InkRenderSettings, LivePreviewMode, PDFAnnotatorSettings, ToolPreset, ToolStateSnapshot } from "../types";

type BehaviorSettingKeys = "preferInlineToolbar" | "showRegionToolbarButton" | "showCopyEmbedToolbarButton" | "autoCopyRegionEmbed" | "showAnnotatedEmbedHeader" | "showDrawingNotices" | "showRenderTelemetry" | "inkInputPolicy" | "livePreviewMode" | "inkRenderSettings" | "autosaveDelayMs";

function normalizeInkInputPolicy(value: unknown): InkInputPolicy {
	if (value === "pen-mouse-stylus-touch") {
		return "allow-touch";
	}
	return value === "pen-mouse-only" || value === "allow-touch" ? value : DEFAULT_SETTINGS.inkInputPolicy;
}

function normalizeLivePreviewMode(value: unknown): LivePreviewMode {
	const migratedValue = value === "quality" ? "smooth" : value === "fast" ? "accurate" : value;
	return migratedValue === "accurate" || migratedValue === "balanced" || migratedValue === "smooth"
		? migratedValue
		: DEFAULT_SETTINGS.livePreviewMode;
}

function normalizeColor(value: unknown, fallback: string): string {
	return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
	return typeof value === "number" && Number.isFinite(value)
		? Math.max(min, Math.min(max, value))
		: fallback;
}

function normalizeInkPressureMode(value: unknown): InkPressureMode {
	return value === "auto" || value === "stylus" || value === "simulate"
		? value
		: DEFAULT_SETTINGS.inkRenderSettings.pressureMode;
}

function normalizeInkEasingMode(value: unknown): InkEasingMode {
	return value === "ease-in" || value === "ease-out" || value === "ease-in-out" || value === "linear"
		? value
		: DEFAULT_SETTINGS.inkRenderSettings.easing;
}

export function normalizeInkRenderSettings(value: unknown): InkRenderSettings {
	const raw = value && typeof value === "object" ? value as Partial<InkRenderSettings> : {};
	return {
		thinning: clampNumber(raw.thinning, DEFAULT_SETTINGS.inkRenderSettings.thinning, -1, 1),
		streamline: clampNumber(raw.streamline, DEFAULT_SETTINGS.inkRenderSettings.streamline, 0, 1),
		smoothing: clampNumber(raw.smoothing, DEFAULT_SETTINGS.inkRenderSettings.smoothing, 0, 1),
		easing: normalizeInkEasingMode(raw.easing),
		taperStart: clampNumber(raw.taperStart, DEFAULT_SETTINGS.inkRenderSettings.taperStart, 0, 120),
		taperEnd: clampNumber(raw.taperEnd, DEFAULT_SETTINGS.inkRenderSettings.taperEnd, 0, 120),
		pressureMode: normalizeInkPressureMode(raw.pressureMode)
	};
}

export class PDFAnnotatorSettingsController {
	private settings: PDFAnnotatorSettings = this.createDefaultSettings();
	private settingsSaveHandle: number | null = null;

	constructor(
		private readonly loadData: () => Promise<unknown>,
		private readonly saveData: (data: PDFAnnotatorSettings) => Promise<void>,
		private readonly onBehaviorChanged: () => void
	) {}

	async load(): Promise<void> {
		const loaded = await this.loadData() as Partial<PDFAnnotatorSettings> | null | undefined;
		const toolDefaults: Partial<ToolStateSnapshot> = loaded?.toolDefaults ?? {};
		const loadedWidths = toolDefaults.widths;
		const normalizedPresets = normalizeToolPresets(loaded?.presets);
		const shouldMigrateLegacyPressure = loaded?.pressureCaptureVersion !== 1;
		const loadedLivePreviewMode = (loaded as { livePreviewMode?: unknown } | null | undefined)?.livePreviewMode;
		const shouldMigrateLegacyPreview = loadedLivePreviewMode === "quality" || loadedLivePreviewMode === "fast";
		const inkRenderSettings = normalizeInkRenderSettings(loaded?.inkRenderSettings);
		if (shouldMigrateLegacyPressure && inkRenderSettings.pressureMode === "simulate") {
			inkRenderSettings.pressureMode = "auto";
		}
		this.settings = {
			pressureCaptureVersion: 1,
			toolDefaults: {
				...DEFAULT_SETTINGS.toolDefaults,
				...toolDefaults,
				selectedPresetIds: {
					...(DEFAULT_SETTINGS.toolDefaults.selectedPresetIds ?? {}),
					...(toolDefaults.selectedPresetIds ?? {})
				},
				widths: {
					pen: clampToolWidth("pen", loadedWidths?.pen ?? DEFAULT_SETTINGS.toolDefaults.widths.pen),
					highlighter: clampToolWidth("highlighter", loadedWidths?.highlighter ?? DEFAULT_SETTINGS.toolDefaults.widths.highlighter),
					eraser: clampToolWidth("eraser", loadedWidths?.eraser ?? DEFAULT_SETTINGS.toolDefaults.widths.eraser)
				}
			},
			presets: normalizedPresets,
			textColor: normalizeColor(loaded?.textColor, DEFAULT_SETTINGS.textColor),
			preferInlineToolbar: typeof loaded?.preferInlineToolbar === "boolean" ? loaded.preferInlineToolbar : DEFAULT_SETTINGS.preferInlineToolbar,
			showRegionToolbarButton: typeof loaded?.showRegionToolbarButton === "boolean" ? loaded.showRegionToolbarButton : DEFAULT_SETTINGS.showRegionToolbarButton,
			showCopyEmbedToolbarButton: typeof loaded?.showCopyEmbedToolbarButton === "boolean" ? loaded.showCopyEmbedToolbarButton : DEFAULT_SETTINGS.showCopyEmbedToolbarButton,
			autoCopyRegionEmbed: typeof loaded?.autoCopyRegionEmbed === "boolean" ? loaded.autoCopyRegionEmbed : DEFAULT_SETTINGS.autoCopyRegionEmbed,
			showAnnotatedEmbedHeader: typeof loaded?.showAnnotatedEmbedHeader === "boolean" ? loaded.showAnnotatedEmbedHeader : DEFAULT_SETTINGS.showAnnotatedEmbedHeader,
			showDrawingNotices: typeof loaded?.showDrawingNotices === "boolean" ? loaded.showDrawingNotices : DEFAULT_SETTINGS.showDrawingNotices,
			showRenderTelemetry: typeof loaded?.showRenderTelemetry === "boolean" ? loaded.showRenderTelemetry : DEFAULT_SETTINGS.showRenderTelemetry,
			inkInputPolicy: normalizeInkInputPolicy(loaded?.inkInputPolicy),
			livePreviewMode: normalizeLivePreviewMode(loadedLivePreviewMode),
			inkRenderSettings,
			legacyInkRenderSettings: normalizeInkRenderSettings(loaded?.legacyInkRenderSettings ?? inkRenderSettings),
			autosaveDelayMs: typeof loaded?.autosaveDelayMs === "number" ? loaded.autosaveDelayMs : DEFAULT_SETTINGS.autosaveDelayMs
		};
		if (!loaded?.legacyInkRenderSettings || shouldMigrateLegacyPressure || shouldMigrateLegacyPreview || JSON.stringify(loaded?.presets ?? []) !== JSON.stringify(normalizedPresets)) {
			this.scheduleSave();
		}
	}

	dispose(): void {
		if (this.settingsSaveHandle !== null) {
			window.clearTimeout(this.settingsSaveHandle);
			this.settingsSaveHandle = null;
		}
	}

	getToolDefaults(): ToolStateSnapshot {
		return {
			...this.settings.toolDefaults,
			selectedPresetIds: { ...(this.settings.toolDefaults.selectedPresetIds ?? {}) },
			widths: { ...this.settings.toolDefaults.widths }
		};
	}

	getLegacyInkRenderSettings(): InkRenderSettings {
		return { ...(this.settings.legacyInkRenderSettings ?? this.settings.inkRenderSettings) };
	}

	getTextColor(): string {
		return this.settings.textColor;
	}

	getInlineToolbarPreference(): boolean {
		return this.settings.preferInlineToolbar;
	}


	getAutosaveDelayMs(): number {
		return this.settings.autosaveDelayMs;
	}

	shouldShowRegionToolbarButton(): boolean {
		return this.settings.showRegionToolbarButton;
	}

	shouldShowCopyEmbedToolbarButton(): boolean {
		return this.settings.showCopyEmbedToolbarButton;
	}

	shouldAutoCopyRegionEmbed(): boolean {
		return this.settings.autoCopyRegionEmbed;
	}

	shouldShowAnnotatedEmbedHeader(): boolean {
		return this.settings.showAnnotatedEmbedHeader;
	}

	shouldShowDrawingNotices(): boolean {
		return this.settings.showDrawingNotices;
	}

	shouldShowRenderTelemetry(): boolean {
		return this.settings.showRenderTelemetry;
	}

	getInkInputPolicy(): InkInputPolicy {
		return this.settings.inkInputPolicy;
	}

	getLivePreviewMode(): LivePreviewMode {
		return this.settings.livePreviewMode;
	}

	getInkRenderSettings(): InkRenderSettings {
		return { ...this.settings.inkRenderSettings };
	}

	getStoredPresets(): ToolPreset[] {
		return this.settings.presets.map((preset) => ({ ...preset }));
	}

	updateToolPreferences(snapshot: ToolStateSnapshot, presets: ToolPreset[]): void {
		this.settings.toolDefaults = {
			...snapshot,
			selectedPresetIds: { ...(snapshot.selectedPresetIds ?? {}) },
			widths: {
				pen: clampToolWidth("pen", snapshot.widths.pen),
				highlighter: clampToolWidth("highlighter", snapshot.widths.highlighter),
				eraser: clampToolWidth("eraser", snapshot.widths.eraser)
			}
		};
		this.settings.presets = normalizeToolPresets(presets);
		this.scheduleSave();
	}

	updateTextColor(color: string): void {
		this.settings.textColor = normalizeColor(color, this.settings.textColor);
		this.scheduleSave();
	}

	async updateBehaviorSettings(nextSettings: Partial<Pick<PDFAnnotatorSettings, BehaviorSettingKeys>>): Promise<void> {
		this.settings = {
			...this.settings,
			...nextSettings
		};
		this.scheduleSave();
		this.onBehaviorChanged();
	}

	private createDefaultSettings(): PDFAnnotatorSettings {
		return {
			pressureCaptureVersion: DEFAULT_SETTINGS.pressureCaptureVersion,
			toolDefaults: {
				...DEFAULT_SETTINGS.toolDefaults,
				selectedPresetIds: { ...(DEFAULT_SETTINGS.toolDefaults.selectedPresetIds ?? {}) },
				widths: { ...DEFAULT_SETTINGS.toolDefaults.widths }
			},
			presets: DEFAULT_SETTINGS.presets.map((preset) => ({ ...preset })),
			textColor: DEFAULT_SETTINGS.textColor,
			preferInlineToolbar: DEFAULT_SETTINGS.preferInlineToolbar,
			showRegionToolbarButton: DEFAULT_SETTINGS.showRegionToolbarButton,
			showCopyEmbedToolbarButton: DEFAULT_SETTINGS.showCopyEmbedToolbarButton,
			autoCopyRegionEmbed: DEFAULT_SETTINGS.autoCopyRegionEmbed,
			showAnnotatedEmbedHeader: DEFAULT_SETTINGS.showAnnotatedEmbedHeader,
			showDrawingNotices: DEFAULT_SETTINGS.showDrawingNotices,
			showRenderTelemetry: DEFAULT_SETTINGS.showRenderTelemetry,
			inkInputPolicy: DEFAULT_SETTINGS.inkInputPolicy,
			livePreviewMode: DEFAULT_SETTINGS.livePreviewMode,
			inkRenderSettings: { ...DEFAULT_SETTINGS.inkRenderSettings },
			autosaveDelayMs: DEFAULT_SETTINGS.autosaveDelayMs
		};
	}

	private scheduleSave(): void {
		if (this.settingsSaveHandle !== null) {
			window.clearTimeout(this.settingsSaveHandle);
		}
		this.settingsSaveHandle = window.setTimeout(() => {
			this.settingsSaveHandle = null;
			void this.saveData(this.settings);
		}, 150);
	}
}
