import { App, Plugin, PluginSettingTab, Setting } from "obsidian";
import { PAPER_COLOR_PRESETS, TOOL_WIDTH_RANGES } from "../config";
import type { InkEasingMode, InkInputPolicy, InkPressureMode, InkRenderSettings, LivePreviewMode, PDFAnnotatorSettings, ToolPreset, ToolStateSnapshot } from "../types";

type SettingDefinitionCompat = {
	name: string;
	desc?: string;
	render: (setting: Setting) => void;
	visible?: () => boolean;
};

export interface PDFAnnotatorSettingsHost {
	cleanAnnotationFiles(removeOrphans: boolean): Promise<void>;
	restoreActiveAnnotationData(): Promise<void>;
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
	getQuickAddPageSettings(): PDFAnnotatorSettings["quickAddPageSettings"];
	getAutosaveDelayMs(): number;
	getToolDefaults(): ToolStateSnapshot;
	getStoredPresets(): ToolPreset[];
	updateBehaviorSettings(
		nextSettings: Partial<Pick<PDFAnnotatorSettings, "preferInlineToolbar" | "showRegionToolbarButton" | "showCopyEmbedToolbarButton" | "autoCopyRegionEmbed" | "showAnnotatedEmbedHeader" | "showDrawingNotices" | "showRenderTelemetry" | "inkInputPolicy" | "livePreviewMode" | "inkRenderSettings" | "quickAddPageSettings" | "autosaveDelayMs">>
	): Promise<void>;
	updateToolPreferences(snapshot: ToolStateSnapshot, presets: ToolPreset[]): void;
}

export class PDFAnnotatorSettingTab extends PluginSettingTab {
	private quickAddDefaultsEl: HTMLElement | null = null;
	constructor(app: App, private readonly plugin: Plugin & PDFAnnotatorSettingsHost) {
		super(app, plugin);
	}

	// Share row renderers between searchable groups and the pre-1.13 fallback.
	private buildSettingRows(): SettingDefinitionCompat[] {
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
				desc: "Show brief notices for drawing, saving, undo, and redo. Save failures are always shown.",
				render: (setting) => {
					setting
						.setName("Action notices")
						.setDesc("Show brief notices for drawing, saving, undo, and redo. Save failures are always shown.")
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
				desc: "Choose a fast preview, an accurate preview, or automatic smoothing. Pencil pressure stays enabled in every mode.",
				render: (setting) => {
					setting
						.setName("Stroke preview")
						.setDesc("Fast uses fewer curve subdivisions while writing. Accurate matches saved geometry. Smoothest uses the automatic smoothing mode. New ink follows measured Pencil contact with continuous curves; older ink retains adaptive tip prediction. Pencil pressure stays enabled.")
						.addDropdown((dropdown) => {
							dropdown
								.addOption("fast", "Fast")
								.addOption("accurate", "Accurate")
								.addOption("auto-smooth", "Smoothest")
								.setValue(this.plugin.getLivePreviewMode())
								.onChange(async (value) => {
									await this.plugin.updateBehaviorSettings({ livePreviewMode: value as LivePreviewMode });
								});
						});
				}
			},
			...this.getInkSettingDefinitions(),
			...this.getQuickAddPageSettingDefinitions(),
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
				desc: "Pens always use reported pressure. Choose how mouse and finger pressure is handled for new strokes.",
				render: (setting) => {
					setting
						.setName("Pressure input")
						.setDesc("Pens always use reported pressure, retaining the last pressure if unavailable. Drawing speed applies only to mouse and finger input. Applies to new strokes.")
						.addDropdown((dropdown) => {
							dropdown
								.addOption("auto", "Automatic")
								.addOption("simulate", "Drawing speed (mouse / finger)")
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
						.setName("Pressure sensitivity")
						.setDesc("0 keeps a constant width. Higher values make firmer Pencil pressure increase width more strongly. Applies to new strokes.")
						.addSlider((slider) => {
							slider
								.setLimits(0, 1, 0.05)
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
				desc: "0 disables path stabilization. Higher values smooth hand wobble more strongly and follow the pen less immediately. Changes apply only to new strokes.",
				render: (setting) => {
					setting
						.setName("Stabilization")
						.setDesc("0 disables path stabilization. Higher values smooth hand wobble more strongly and follow the pen less immediately. Changes apply only to new strokes.")
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
				name: "Width smoothing mode",
				desc: "Extra smooth gently blends nearby pressure changes while following your Pencil pressure.",
				render: (setting) => {
					setting.setName("Width smoothing mode")
						.setDesc("Extra smooth follows Pencil pressure with a small local blend to soften sudden width changes. Applies to new strokes.")
						.addDropdown((dropdown) => {
							dropdown.addOption("original", "Original")
								.addOption("extra-smooth", "Extra smooth")
								.setValue(this.plugin.getInkRenderSettings().widthSmoothing ?? "extra-smooth")
								.onChange(async (value) => {
									await updateInkRenderSettings({ widthSmoothing: value === "original" ? "original" : "extra-smooth" });
								});
						});
				}
			},
			{
				name: "Stroke smoothing",
				desc: "Round corners and soften neighbouring width transitions. Applies to new strokes.",
				render: (setting) => {
					setting
						.setName("Stroke smoothing")
						.setDesc("Higher values round corners more and soften width transitions. Extra smooth keeps pressure changes local; Original preserves peak widths. Applies to new strokes; stabilization controls hand wobble.")
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

	private getQuickAddPageSettingDefinitions(): SettingDefinitionCompat[] {
		const update = async (patch: Partial<PDFAnnotatorSettings["quickAddPageSettings"]>) => {
			await this.plugin.updateBehaviorSettings({ quickAddPageSettings: { ...this.plugin.getQuickAddPageSettings(), ...patch, source: "previous" } });
		};
		return [

			{ name: "Quick-add template", render: setting => { setting.setName("Default template")
				.setDesc("Template used for new annotatable PDFs and the first added page.")
				.addDropdown(dropdown => dropdown.addOption("blank", "Blank").addOption("ruled", "Ruled").addOption("grid", "Grid").addOption("dot", "Dotted")
					.setValue(this.plugin.getQuickAddPageSettings().template).onChange(value => update({ template: value as PDFAnnotatorSettings["quickAddPageSettings"]["template"] }))); } },
			{ name: "Quick-add paper colour", render: setting => {
				let syncDropdown: ((color: string) => void) | undefined;
				let syncPicker: ((color: string) => void) | undefined;
				const selectColor = async (color: string): Promise<void> => {
					syncDropdown?.(color);
					syncPicker?.(color);
					await update({ paperColor: color });
				};
				setting.setName("Default paper colour")
					.setDesc("Paper colour used for new annotatable PDFs and the first added page.")
					.addDropdown(dropdown => {
						PAPER_COLOR_PRESETS.forEach(preset => { dropdown.addOption(preset.color, preset.label); });
						let customOption: HTMLOptionElement | null = null;
						syncDropdown = color => {
							const preset = PAPER_COLOR_PRESETS.find(entry => entry.color.toLowerCase() === color.toLowerCase());
							if (!preset) {
								if (customOption) customOption.value = color;
								else {
									dropdown.addOption(color, "Custom colour");
									customOption = Array.from(dropdown.selectEl.options).find(option => option.value === color) ?? null;
								}
							}
							dropdown.setValue(preset?.color ?? color);
						};
						syncDropdown(this.plugin.getQuickAddPageSettings().paperColor);
						dropdown.onChange(selectColor);
					})
					.addColorPicker(picker => {
						picker.setValue(this.plugin.getQuickAddPageSettings().paperColor).onChange(selectColor);
						syncPicker = color => { picker.setValue(color); };
					});
			} },
			{ name: "Automatic page style", render: setting => {
				setting.setName("").setDesc("The first page uses these defaults. Later pages follow the latest template or colour change anywhere in this PDF.");
				setting.settingEl.addClass("freedraw-pdf-quick-add-note");
			} }
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

	private renderSettingsSection(containerEl: HTMLElement, name: string): HTMLElement {
		const section = containerEl.createEl("section", { cls: "freedraw-pdf-settings-section" });
		const heading = new Setting(section).setName(name).setHeading();
		heading.settingEl.addClass("freedraw-pdf-settings-section-heading");
		return section.createDiv({ cls: "freedraw-pdf-settings-group" });
	}

	private syncQuickAddDefaultFields(): void {
		if (this.quickAddDefaultsEl) this.quickAddDefaultsEl.hidden = false;
		// 1.13+ updates visibility in place, preserving focus and scroll.
		const tab = this as PluginSettingTab & { refreshDomState?: () => void };
		tab.refreshDomState?.();
	}

	private getFileManagementRows(): SettingDefinitionCompat[] {
		return [
			{ name: "Recover annotations from JSON", render: setting => { setting.setName("Recover annotations from JSON")
			.setDesc("Replace the active PDF's annotation layer with an earlier copy from the same folder. Current data is backed up. Use Combine JSON to add missing strokes.")
			.addButton(button => button.setButtonText("Choose recovery").onClick(() => this.plugin.restoreActiveAnnotationData())); } },
			{ name: "Combine annotation JSON files", render: setting => { setting.setName("Combine annotation JSON files")
			.setDesc("Choose one PDF, a folder, or the whole vault. Add missing strokes, keeping different versions as separate stacked strokes. Combined recovery copies move to trash after saving.")
			.addButton(button => button.setButtonText("Combine JSON").onClick(async () => {
				button.setDisabled(true);
				try { await this.plugin.cleanAnnotationFiles(false); } finally { button.setDisabled(false); }
			})); } },
			{ name: "Remove data for deleted PDFs", render: setting => { setting.setName("Remove data for deleted PDFs")
			.setDesc("Remove leftover annotation and recovery JSONs whose PDF is missing. Starts with the whole vault; you can limit it to a folder or PDF. You confirm before files move to trash.")
			.addButton(button => button.setButtonText("Clean deleted PDFs").onClick(async () => {
				button.setDisabled(true);
				try { await this.plugin.cleanAnnotationFiles(true); } finally { button.setDisabled(false); }
			})); } }
		];
	}

	// Structural compatibility keeps the minimum supported API at 1.12.
	// Obsidian 1.13+ renders and indexes these native groups; older versions use display().
	getSettingDefinitions(): { type: "group"; heading: string; cls: string; items: SettingDefinitionCompat[] }[] {
		const rows = new Map([...this.buildSettingRows(), ...this.getFileManagementRows()].map(row => [row.name, row]));
		for (const name of ["Quick-add template", "Quick-add paper colour", "Automatic page style"]) {
			const row = rows.get(name);
			if (row) row.visible = () => true;
		}
		const groups: [string, string[]][] = [
			["Drawing input", ["Finger input", "Stroke preview"]],
			["Pen pressure", ["Pressure input", "Stroke width response", "Pressure curve"]],
			["Stroke smoothing", ["Stabilization", "Width smoothing mode", "Stroke smoothing"]],
			["Tool sizes", ["Pen width", "Highlighter width", "Eraser size"]],
			["Stroke ends", ["Taper start", "Taper end"]],
			["Pages / Quick add", ["Quick-add template", "Quick-add paper colour", "Automatic page style"]],
			["Toolbar", ["Toolbar placement", "Region capture button", "Copy embed button"]],
			["Markdown embeds", ["Automatic region embed copy", "Embed controls"]],
			["Saving", ["Save delay"]],
			["File management", ["Recover annotations from JSON", "Combine annotation JSON files", "Remove data for deleted PDFs"]],
			["Debug", ["Action notices", "Rendering diagnostics"]]
		];
		return groups.map(([heading, names]) => ({
			type: "group", heading, cls: "freedraw-pdf-settings-native-group",
			items: names.map(name => rows.get(name)).filter((row): row is SettingDefinitionCompat => !!row)
		}));
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.addClass("freedraw-pdf-settings");
		const definitions = new Map(this.buildSettingRows().map(definition => [definition.name, definition]));
		const renderSection = (name: string, names: string[]) => {
			const body = this.renderSettingsSection(containerEl, name);
			this.renderSettingDefinitions(body, definitions, names);
			return body;
		};
		renderSection("Drawing input", ["Finger input", "Stroke preview"]);
		renderSection("Pen pressure", ["Pressure input", "Stroke width response", "Pressure curve"]);
		renderSection("Stroke smoothing", ["Stabilization", "Width smoothing mode", "Stroke smoothing"]);
		renderSection("Tool sizes", ["Pen width", "Highlighter width", "Eraser size"]);
		renderSection("Stroke ends", ["Taper start", "Taper end"]);
		const pages = renderSection("Pages / Quick add", []);
		this.quickAddDefaultsEl = pages.createDiv({ cls: "freedraw-pdf-quick-add-defaults" });
		this.renderSettingDefinitions(this.quickAddDefaultsEl, definitions, ["Quick-add template", "Quick-add paper colour", "Automatic page style"]);
		this.syncQuickAddDefaultFields();
		renderSection("Toolbar", ["Toolbar placement", "Region capture button", "Copy embed button"]);
		renderSection("Markdown embeds", ["Automatic region embed copy", "Embed controls"]);
		renderSection("Saving", ["Save delay"]);
		const files = this.renderSettingsSection(containerEl, "File management");
		for (const row of this.getFileManagementRows()) row.render(new Setting(files));
		renderSection("Debug", ["Action notices", "Rendering diagnostics"]);
	}
}
