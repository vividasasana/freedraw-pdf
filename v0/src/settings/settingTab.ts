import { App, Plugin, PluginSettingTab, Setting } from "obsidian";
import { TOOL_WIDTH_RANGES } from "../config";
import type { InkEasingMode, InkInputPolicy, InkPressureMode, InkRenderSettings, LivePreviewMode, PDFAnnotatorSettings, ToolPreset, ToolStateSnapshot } from "../types";

type SettingDefinitionCompat = {
	name: string;
	desc?: string;
	render: (setting: Setting) => void;
};

export interface PDFAnnotatorSettingsHost {
	getInlineToolbarPreference(): boolean;
	shouldShowRegionToolbarButton(): boolean;
	shouldShowCopyEmbedToolbarButton(): boolean;
	shouldAutoCopyRegionEmbed(): boolean;
	shouldShowAnnotatedEmbedHeader(): boolean;
	shouldShowDrawingNotices(): boolean;
	shouldShowRenderTelemetry(): boolean;
	getInkInputPolicy(): InkInputPolicy;
	getLivePreviewMode(): LivePreviewMode;
	getInkRenderSettings(): InkRenderSettings;
	getAutosaveDelayMs(): number;
	getToolDefaults(): ToolStateSnapshot;
	getStoredPresets(): ToolPreset[];
	updateBehaviorSettings(
		nextSettings: Partial<Pick<PDFAnnotatorSettings, "preferInlineToolbar" | "showRegionToolbarButton" | "showCopyEmbedToolbarButton" | "autoCopyRegionEmbed" | "showAnnotatedEmbedHeader" | "showDrawingNotices" | "showRenderTelemetry" | "inkInputPolicy" | "livePreviewMode" | "inkRenderSettings" | "autosaveDelayMs">>
	): Promise<void>;
	updateToolPreferences(snapshot: ToolStateSnapshot, presets: ToolPreset[]): void;
}

export class PDFAnnotatorSettingTab extends PluginSettingTab {
	constructor(app: App, private readonly plugin: Plugin & PDFAnnotatorSettingsHost) {
		super(app, plugin);
	}

	getSettingDefinitions(): SettingDefinitionCompat[] {
		return [
			{
				name: "Toolbar placement",
				desc: "Keep annotation controls inside the PDF toolbar, or use a floating toolbar when another extension causes overlap.",
				render: (setting) => {
					setting
						.setName("Toolbar placement")
						.setDesc("Keep annotation controls inside the PDF toolbar, or use a floating toolbar when another extension causes overlap.")
						.addDropdown((dropdown) => {
							dropdown
								.addOption("inline", "Inside PDF toolbar")
								.addOption("floating", "Floating")
								.setValue(this.plugin.getInlineToolbarPreference() ? "inline" : "floating")
								.onChange(async (value) => {
									await this.plugin.updateBehaviorSettings({ preferInlineToolbar: value === "inline" });
								});
						});
				}
			},
			{
				name: "Region capture button",
				desc: "Show Region directly in the toolbar. When hidden, Region remains available from More.",
				render: (setting) => {
					setting
						.setName("Region capture button")
						.setDesc("Show Region directly in the toolbar. When hidden, Region remains available from More.")
						.addToggle((toggle) => {
							toggle
								.setValue(this.plugin.shouldShowRegionToolbarButton())
								.onChange(async (value) => {
									await this.plugin.updateBehaviorSettings({ showRegionToolbarButton: value });
								});
						});
				}
			},
			{
				name: "Copy embed button",
				desc: "Show Copy embed after selecting a region. When hidden, the action remains in the Region menu.",
				render: (setting) => {
					setting
						.setName("Copy embed button")
						.setDesc("Show Copy embed after selecting a region. When hidden, the action remains in the Region menu.")
						.addToggle((toggle) => {
							toggle
								.setValue(this.plugin.shouldShowCopyEmbedToolbarButton())
								.onChange(async (value) => {
									await this.plugin.updateBehaviorSettings({ showCopyEmbedToolbarButton: value });
								});
					});
				}
			},
			{
				name: "Automatic region embed copy",
				desc: "Copy the annotated Markdown embed block as soon as a region is captured.",
				render: (setting) => {
					setting
						.setName("Automatic region embed copy")
						.setDesc("Copy the annotated Markdown embed block as soon as a region is captured.")
						.addToggle((toggle) => {
							toggle
								.setValue(this.plugin.shouldAutoCopyRegionEmbed())
								.onChange(async (value) => {
									await this.plugin.updateBehaviorSettings({ autoCopyRegionEmbed: value });
								});
						});
				}
			},
			{
				name: "Embed controls",
				desc: "Show the title and Open, Refresh, and Copy controls above annotated PDF embeds in notes.",
				render: (setting) => {
					setting
						.setName("Embed controls")
						.setDesc("Show the title and Open, Refresh, and Copy controls above annotated PDF embeds in notes.")
						.addToggle((toggle) => {
							toggle
								.setValue(this.plugin.shouldShowAnnotatedEmbedHeader())
								.onChange(async (value) => {
									await this.plugin.updateBehaviorSettings({ showAnnotatedEmbedHeader: value });
								});
						});
				}
			},
			{
				name: "Action notices",
				desc: "Show brief confirmations after drawing, undo, and redo actions.",
				render: (setting) => {
					setting
						.setName("Action notices")
						.setDesc("Show brief confirmations after drawing, undo, and redo actions.")
						.addToggle((toggle) => {
							toggle
								.setValue(this.plugin.shouldShowDrawingNotices())
								.onChange(async (value) => {
									await this.plugin.updateBehaviorSettings({ showDrawingNotices: value });
								});
						});
				}
			},
			{
				name: "Rendering diagnostics",
				desc: "Show live input and rendering timings. Enable only while investigating drawing problems.",
				render: (setting) => {
					setting
						.setName("Rendering diagnostics")
						.setDesc("Show live input and rendering timings. Enable only while investigating drawing problems.")
						.addToggle((toggle) => {
							toggle
								.setValue(this.plugin.shouldShowRenderTelemetry())
								.onChange(async (value) => {
									await this.plugin.updateBehaviorSettings({ showRenderTelemetry: value });
								});
						});
				}
			},
			{
				name: "Finger input",
				desc: "Choose what one finger does on the page. Apple Pencil and mouse draw in both modes.",
				render: (setting) => {
					setting
						.setName("Finger input")
						.setDesc("Choose what one finger does on the page. Apple Pencil and mouse draw in both modes.")
						.addDropdown((dropdown) => {
							dropdown
								.addOption("allow-touch", "Draw with finger")
								.addOption("pen-mouse-only", "Pan with finger")
								.setValue(this.plugin.getInkInputPolicy())
								.onChange(async (value) => {
									await this.plugin.updateBehaviorSettings({ inkInputPolicy: value as InkInputPolicy });
								});
						});
				}
			},
			{
				name: "Stroke preview",
				desc: "Balance an exact match to the saved stroke against a smoother, more responsive tip. Pressure rendering stays enabled in every mode.",
				render: (setting) => {
					setting
						.setName("Stroke preview")
						.setDesc("Balance an exact match to the saved stroke against a smoother, more responsive tip. Pressure rendering stays enabled in every mode.")
						.addDropdown((dropdown) => {
							dropdown
								.addOption("accurate", "Closest to saved")
								.addOption("balanced", "Balanced")
								.addOption("smooth", "Smoothest")
								.setValue(this.plugin.getLivePreviewMode())
								.onChange(async (value) => {
									await this.plugin.updateBehaviorSettings({ livePreviewMode: value as LivePreviewMode });
								});
						});
				}
			},
			...this.getInkSettingDefinitions(),
			...this.getDefaultToolSettingDefinitions()
		];
	}

	private getInkSettingDefinitions(): SettingDefinitionCompat[] {
		const updateInkRenderSettings = async (patch: Partial<InkRenderSettings>): Promise<void> => {
			await this.plugin.updateBehaviorSettings({
				inkRenderSettings: {
					...this.plugin.getInkRenderSettings(),
					...patch
				}
			});
		};
		return [
			{
				name: "Pressure input",
				desc: "Use drawing speed on any device, or pressure reported by an active stylus such as Apple Pencil.",
				render: (setting) => {
					setting
						.setName("Pressure input")
						.setDesc("Use drawing speed on any device, or pressure reported by an active stylus such as Apple Pencil.")
						.addDropdown((dropdown) => {
							dropdown
								.addOption("auto", "Automatic")
								.addOption("simulate", "Drawing speed")
								.addOption("stylus", "Stylus pressure")
								.setValue(this.plugin.getInkRenderSettings().pressureMode)
								.onChange(async (value) => {
									await updateInkRenderSettings({ pressureMode: value as InkPressureMode });
								});
						});
				}
			},
			{
				name: "Stroke width response",
				desc: "How strongly pressure changes line width. Higher values produce more variation.",
				render: (setting) => {
					setting
						.setName("Stroke width response")
						.setDesc("How strongly pressure changes line width. Higher values produce more variation.")
						.addSlider((slider) => {
							slider
								.setLimits(-1, 1, 0.05)
								.setValue(this.plugin.getInkRenderSettings().thinning)
								.setDynamicTooltip()
								.onChange(async (value) => {
									await updateInkRenderSettings({ thinning: value });
								});
						});
				}
			},
			{
				name: "Stabilization",
				desc: "Reduce hand wobble. Higher values are steadier but follow movement less immediately.",
				render: (setting) => {
					setting
						.setName("Stabilization")
						.setDesc("Reduce hand wobble. Higher values are steadier but follow movement less immediately.")
						.addSlider((slider) => {
							slider
								.setLimits(0, 1, 0.05)
								.setValue(this.plugin.getInkRenderSettings().streamline)
								.setDynamicTooltip()
								.onChange(async (value) => {
									await updateInkRenderSettings({ streamline: value });
								});
						});
				}
			},
			{
				name: "Stroke smoothing",
				desc: "Round sharp changes in the freehand outline.",
				render: (setting) => {
					setting
						.setName("Stroke smoothing")
						.setDesc("Round sharp changes in the freehand outline.")
						.addSlider((slider) => {
							slider
								.setLimits(0, 1, 0.05)
								.setValue(this.plugin.getInkRenderSettings().smoothing)
								.setDynamicTooltip()
								.onChange(async (value) => {
									await updateInkRenderSettings({ smoothing: value });
								});
						});
				}
			},
			{
				name: "Pressure curve",
				desc: "Choose how gradually pressure changes are applied to line width.",
				render: (setting) => {
					setting
						.setName("Pressure curve")
						.setDesc("Choose how gradually pressure changes are applied to line width.")
						.addDropdown((dropdown) => {
							dropdown
								.addOption("linear", "Linear")
								.addOption("ease-in", "Ease in")
								.addOption("ease-out", "Ease out")
								.addOption("ease-in-out", "Ease in-out")
								.setValue(this.plugin.getInkRenderSettings().easing)
								.onChange(async (value) => {
									await updateInkRenderSettings({ easing: value as InkEasingMode });
								});
						});
				}
			},
			{
				name: "Taper start",
				desc: "How far the beginning narrows. 0 keeps a flat start.",
				render: (setting) => this.renderInkSlider(setting, "Taper start", "How far the beginning narrows. 0 keeps a flat start.", "taperStart", updateInkRenderSettings)
			},
			{
				name: "Taper end",
				desc: "How far the ending narrows. 0 keeps a flat end.",
				render: (setting) => this.renderInkSlider(setting, "Taper end", "How far the ending narrows. 0 keeps a flat end.", "taperEnd", updateInkRenderSettings)
			},
			{
				name: "Save delay",
				desc: "Wait after the last edit before saving annotation data. Lower values save sooner.",
				render: (setting) => {
					setting
						.setName("Save delay")
						.setDesc("Wait after the last edit before saving annotation data. Lower values save sooner.")
						.addSlider((slider) => {
							slider
								.setLimits(200, 2000, 100)
								.setValue(this.plugin.getAutosaveDelayMs())
								.setDynamicTooltip()
								.onChange(async (value) => {
									await this.plugin.updateBehaviorSettings({ autosaveDelayMs: value });
								});
						});
				}
			}
		];
	}

	private renderInkSlider(
		setting: Setting,
		name: string,
		desc: string,
		key: "taperStart" | "taperEnd",
		updateInkRenderSettings: (patch: Partial<InkRenderSettings>) => Promise<void>
	): void {
		setting
			.setName(name)
			.setDesc(desc)
			.addSlider((slider) => {
				slider
					.setLimits(0, 120, 1)
					.setValue(this.plugin.getInkRenderSettings()[key])
					.setDynamicTooltip()
					.onChange(async (value) => {
						await updateInkRenderSettings({ [key]: value });
					});
			});
	}

	private getDefaultToolSettingDefinitions(): SettingDefinitionCompat[] {
		return [
			{
				name: "Pen width",
				desc: "Starting width for new pen strokes.",
				render: (setting) => this.renderDefaultWidthSetting(setting, "Pen width", "Starting width for new pen strokes.", "pen", TOOL_WIDTH_RANGES.pen.min, TOOL_WIDTH_RANGES.pen.max)
			},
			{
				name: "Highlighter width",
				desc: "Starting width for new highlighter strokes.",
				render: (setting) => this.renderDefaultWidthSetting(setting, "Highlighter width", "Starting width for new highlighter strokes.", "highlighter", TOOL_WIDTH_RANGES.highlighter.min, TOOL_WIDTH_RANGES.highlighter.max)
			},
			{
				name: "Eraser size",
				desc: "Starting contact area for the eraser.",
				render: (setting) => this.renderDefaultWidthSetting(setting, "Eraser size", "Starting contact area for the eraser.", "eraser", TOOL_WIDTH_RANGES.eraser.min, TOOL_WIDTH_RANGES.eraser.max)
			}
		];
	}

	private renderDefaultWidthSetting(setting: Setting, name: string, desc: string, tool: "pen" | "highlighter" | "eraser", min: number, max: number): void {
		setting
			.setName(name)
			.setDesc(desc)
			.addSlider((slider) => {
				slider
					.setLimits(min, max, TOOL_WIDTH_RANGES[tool].step)
					.setValue(this.plugin.getToolDefaults().widths[tool])
					.setDynamicTooltip()
					.onChange((value) => {
						const next = this.plugin.getToolDefaults();
						next.widths[tool] = value;
						this.plugin.updateToolPreferences(next, this.plugin.getStoredPresets());
					});
			});
	}

	private renderSettingDefinitions(
		containerEl: HTMLElement,
		definitions: Map<string, SettingDefinitionCompat>,
		names: string[]
	): void {
		for (const name of names) {
			const definition = definitions.get(name);
			if (!definition) {
				continue;
			}
			definition.render(new Setting(containerEl));
		}
	}

	private renderSettingsSection(
		containerEl: HTMLElement,
		name: string,
		description: string
	): void {
		new Setting(containerEl)
			.setName(name)
			.setHeading();
		containerEl.createEl("p", {
			cls: "freedraw-pdf-settings-section-description",
			text: description
		});
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.addClass("freedraw-pdf-settings");

		const definitions = new Map(
			this.getSettingDefinitions().map((definition) => [definition.name, definition])
		);

		new Setting(containerEl)
			.setName("Drawing and annotation")
			.setHeading();
		containerEl.createEl("p", {
			cls: "freedraw-pdf-settings-intro",
			text: "Choose how drawing feels and which controls stay visible. Changes apply to open PDFs immediately."
		});

		this.renderSettingsSection(
			containerEl,
			"Input",
			"Set what finger, stylus, and mouse input do while annotation mode is active."
		);
		this.renderSettingDefinitions(containerEl, definitions, [
			"Finger input",
			"Stroke preview",
			"Pressure input"
		]);

		this.renderSettingsSection(
			containerEl,
			"Tool defaults",
			"Choose the starting size used when each tool is selected."
		);
		this.renderSettingDefinitions(containerEl, definitions, [
			"Pen width",
			"Highlighter width",
			"Eraser size"
		]);

		this.renderSettingsSection(
			containerEl,
			"Toolbar",
			"Keep frequent actions visible and move optional controls into menus."
		);
		this.renderSettingDefinitions(containerEl, definitions, [
			"Toolbar placement",
			"Region capture button",
			"Copy embed button"
		]);

		this.renderSettingsSection(
			containerEl,
			"Markdown embeds",
			"Control the appearance of annotated PDF previews placed in notes."
		);
		this.renderSettingDefinitions(containerEl, definitions, [
			"Automatic region embed copy",
			"Embed controls"
		]);

		this.renderSettingsSection(
			containerEl,
			"Saving and feedback",
			"Control when annotation data is saved and how actions are confirmed."
		);
		this.renderSettingDefinitions(containerEl, definitions, [
			"Save delay",
			"Action notices"
		]);

		const advancedEl = containerEl.createEl("details", {
			cls: "freedraw-pdf-settings-advanced"
		});
		advancedEl.createEl("summary", { text: "Advanced ink tuning" });
		advancedEl.createEl("p", {
			text: "Adjust stroke geometry only when the default ink feel needs fine tuning."
		});
		const advancedBodyEl = advancedEl.createDiv({
			cls: "freedraw-pdf-settings-advanced-body"
		});
		this.renderSettingDefinitions(advancedBodyEl, definitions, [
			"Stroke width response",
			"Stabilization",
			"Stroke smoothing",
			"Pressure curve",
			"Taper start",
			"Taper end"
		]);

		this.renderSettingsSection(
			containerEl,
			"Troubleshooting",
			"Leave diagnostics off during normal use."
		);
		this.renderSettingDefinitions(containerEl, definitions, ["Rendering diagnostics"]);
		return;

		new Setting(containerEl)
			.setName("freedraw-pdf")
			.setHeading();

		new Setting(containerEl)
			.setName("Prefer native PDF toolbar")
			.setDesc("Mount controls into Obsidian's native PDF toolbar when available. If another PDF toolbar extension is active, freedraw-pdf can fall back to the floating toolbar to avoid control conflicts.")
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.getInlineToolbarPreference())
					.onChange(async (value) => {
						await this.plugin.updateBehaviorSettings({ preferInlineToolbar: value });
					});
			});

		new Setting(containerEl)
			.setName("Show Region embed toolbar button")
			.setDesc("Show the crop/screenshot-style region capture tool directly in the PDF toolbar. When off, use the freedraw-pdf overflow menu instead.")
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.shouldShowRegionToolbarButton())
					.onChange(async (value) => {
						await this.plugin.updateBehaviorSettings({ showRegionToolbarButton: value });
					});
			});

		new Setting(containerEl)
			.setName("Show Copy embed toolbar button")
			.setDesc("Show a direct Copy embed button after a region has been captured. When off, the same action remains available from the Region menu.")
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.shouldShowCopyEmbedToolbarButton())
					.onChange(async (value) => {
						await this.plugin.updateBehaviorSettings({ showCopyEmbedToolbarButton: value });
					});
			});

		new Setting(containerEl)
			.setName("Show annotated embed header")
			.setDesc("Show title and Open/Refresh/Copy block controls above annotated PDF embeds in markdown. Off by default for a clean screenshot-like display.")
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.shouldShowAnnotatedEmbedHeader())
					.onChange(async (value) => {
						await this.plugin.updateBehaviorSettings({ showAnnotatedEmbedHeader: value });
					});
			});

		new Setting(containerEl)
			.setName("Show drawing notices")
			.setDesc("Show temporary notices for stroke recording and undo/redo actions.")
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.shouldShowDrawingNotices())
					.onChange(async (value) => {
						await this.plugin.updateBehaviorSettings({ showDrawingNotices: value });
					});
			});

		new Setting(containerEl)
			.setName("Show rendering diagnostics")
			.setDesc("Show the temporary input and rendering telemetry overlay. Off by default.")
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.shouldShowRenderTelemetry())
					.onChange(async (value) => {
						await this.plugin.updateBehaviorSettings({ showRenderTelemetry: value });
					});
			});

		new Setting(containerEl)
			.setName("Ink input mode")
			.setDesc("Choose whether one finger draws or pans. Apple Pencil and mouse draw in both modes.")
			.addDropdown((dropdown) => {
				dropdown
					.addOption("allow-touch", "Finger draws")
					.addOption("pen-mouse-only", "Finger pans")
					.setValue(this.plugin.getInkInputPolicy())
					.onChange(async (value) => {
						await this.plugin.updateBehaviorSettings({ inkInputPolicy: value as InkInputPolicy });
					});
			});

		new Setting(containerEl)
			.setName("Ink rendering")
			.setDesc("These values are passed to perfect-freehand. Higher streamline/smoothing values make strokes cleaner but can add visual lag or soften corners.")
			.setHeading();

		new Setting(containerEl)
			.setName("Live stroke preview")
			.setDesc("Balance an exact match to the saved stroke against a smoother, more responsive tip. Pressure rendering stays enabled in every mode.")
			.addDropdown((dropdown) => {
				dropdown
					.addOption("accurate", "Closest to saved")
					.addOption("balanced", "Balanced")
					.addOption("smooth", "Smoothest")
					.setValue(this.plugin.getLivePreviewMode())
					.onChange(async (value) => {
						await this.plugin.updateBehaviorSettings({ livePreviewMode: value as LivePreviewMode });
					});
			});

		const updateInkRenderSettings = async (patch: Partial<InkRenderSettings>): Promise<void> => {
			await this.plugin.updateBehaviorSettings({
				inkRenderSettings: {
					...this.plugin.getInkRenderSettings(),
					...patch
				}
			});
		};

		const inkRenderSettings = this.plugin.getInkRenderSettings();

		new Setting(containerEl)
			.setName("Pressure mode")
			.setDesc("Automatic uses Pencil pressure when available and drawing speed for other input.")
			.addDropdown((dropdown) => {
				dropdown
					.addOption("auto", "Automatic")
					.addOption("simulate", "Simulate pressure from mouse/stroke speed")
					.addOption("stylus", "Use stylus pressure")
					.setValue(inkRenderSettings.pressureMode)
					.onChange(async (value) => {
						await updateInkRenderSettings({ pressureMode: value as InkPressureMode });
					});
			});

		new Setting(containerEl)
			.setName("Thinning")
			.setDesc("How much pressure changes stroke width. Demo-like value: 0.5.")
			.addSlider((slider) => {
				slider
					.setLimits(-1, 1, 0.05)
					.setValue(inkRenderSettings.thinning)
					.setDynamicTooltip()
					.onChange(async (value) => {
						await updateInkRenderSettings({ thinning: value });
					});
			});

		new Setting(containerEl)
			.setName("Streamline")
			.setDesc("How strongly the line follows a stabilized path. Higher values are smoother but less immediate.")
			.addSlider((slider) => {
				slider
					.setLimits(0, 1, 0.05)
					.setValue(inkRenderSettings.streamline)
					.setDynamicTooltip()
					.onChange(async (value) => {
						await updateInkRenderSettings({ streamline: value });
					});
			});

		new Setting(containerEl)
			.setName("Smoothing")
			.setDesc("How rounded the freehand outline becomes.")
			.addSlider((slider) => {
				slider
					.setLimits(0, 1, 0.05)
					.setValue(inkRenderSettings.smoothing)
					.setDynamicTooltip()
					.onChange(async (value) => {
						await updateInkRenderSettings({ smoothing: value });
					});
			});

		new Setting(containerEl)
			.setName("Easing")
			.setDesc("Pressure response curve used by the stroke outline.")
			.addDropdown((dropdown) => {
				dropdown
					.addOption("linear", "Linear")
					.addOption("ease-in", "Ease in")
					.addOption("ease-out", "Ease out")
					.addOption("ease-in-out", "Ease in-out")
					.setValue(inkRenderSettings.easing)
					.onChange(async (value) => {
						await updateInkRenderSettings({ easing: value as InkEasingMode });
					});
			});

		new Setting(containerEl)
			.setName("Taper start")
			.setDesc("Start taper length in pixels. 0 keeps the start capped.")
			.addSlider((slider) => {
				slider
					.setLimits(0, 120, 1)
					.setValue(inkRenderSettings.taperStart)
					.setDynamicTooltip()
					.onChange(async (value) => {
						await updateInkRenderSettings({ taperStart: value });
					});
			});

		new Setting(containerEl)
			.setName("Taper end")
			.setDesc("End taper length in pixels. 0 keeps the end capped.")
			.addSlider((slider) => {
				slider
					.setLimits(0, 120, 1)
					.setValue(inkRenderSettings.taperEnd)
					.setDynamicTooltip()
					.onChange(async (value) => {
						await updateInkRenderSettings({ taperEnd: value });
					});
			});

		new Setting(containerEl)
			.setName("Autosave delay")
			.setDesc("Delay before annotation edits are written to the sidecar file.")
			.addSlider((slider) => {
				slider
					.setLimits(200, 2000, 100)
					.setValue(this.plugin.getAutosaveDelayMs())
					.setDynamicTooltip()
					.onChange(async (value) => {
						await this.plugin.updateBehaviorSettings({ autosaveDelayMs: value });
					});
			});

		const defaults = this.plugin.getToolDefaults();

		new Setting(containerEl)
			.setName("Default pen width")
			.setDesc("Starting width for new pen strokes.")
			.addSlider((slider) => {
				slider
					.setLimits(TOOL_WIDTH_RANGES.pen.min, TOOL_WIDTH_RANGES.pen.max, TOOL_WIDTH_RANGES.pen.step)
					.setValue(defaults.widths.pen)
					.setDynamicTooltip()
					.onChange((value) => {
						const next = this.plugin.getToolDefaults();
						next.widths.pen = value;
						this.plugin.updateToolPreferences(next, this.plugin.getStoredPresets());
					});
			});

		new Setting(containerEl)
			.setName("Default highlighter width")
			.setDesc("Starting width for new highlighter strokes.")
			.addSlider((slider) => {
				slider
					.setLimits(TOOL_WIDTH_RANGES.highlighter.min, TOOL_WIDTH_RANGES.highlighter.max, TOOL_WIDTH_RANGES.highlighter.step)
					.setValue(defaults.widths.highlighter)
					.setDynamicTooltip()
					.onChange((value) => {
						const next = this.plugin.getToolDefaults();
						next.widths.highlighter = value;
						this.plugin.updateToolPreferences(next, this.plugin.getStoredPresets());
					});
			});

		new Setting(containerEl)
			.setName("Default eraser width")
			.setDesc("Starting size for the eraser tool.")
			.addSlider((slider) => {
				slider
					.setLimits(TOOL_WIDTH_RANGES.eraser.min, TOOL_WIDTH_RANGES.eraser.max, TOOL_WIDTH_RANGES.eraser.step)
					.setValue(defaults.widths.eraser)
					.setDynamicTooltip()
					.onChange((value) => {
						const next = this.plugin.getToolDefaults();
						next.widths.eraser = value;
						this.plugin.updateToolPreferences(next, this.plugin.getStoredPresets());
					});
			});
	}
}
