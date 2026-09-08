import { DEFAULT_TOOL_PRESETS, DEFAULT_TOOL_STATE, clampToolWidth } from "../config";
import type {
	AnnotationTool,
	EraserMode,
	PreviewStateSnapshot,
	SelectionMode,
	ShapeTool,
	ToolPreset,
	ToolPresetKind,
	ToolStateSnapshot
} from "../types";

export function isShapeTool(tool: AnnotationTool): tool is ShapeTool {
	return tool === "rectangle" || tool === "ellipse" || tool === "line";
}

export class ToolStateController {
	private readonly presets = new Map<string, ToolPreset>();
	private state: ToolStateSnapshot;

	constructor(presets: ToolPreset[], initialState?: Partial<ToolStateSnapshot>) {
		for (const preset of presets) {
			this.presets.set(preset.id, preset);
		}
		this.state = {
			...DEFAULT_TOOL_STATE,
			...initialState,
			selectedPresetIds: {
				...DEFAULT_TOOL_STATE.selectedPresetIds,
				...(initialState?.selectedPresetIds ?? {})
			},
			widths: {
				...DEFAULT_TOOL_STATE.widths,
				...(initialState?.widths ?? {})
			}
		};
		this.state.widths = {
			pen: clampToolWidth("pen", this.state.widths.pen),
			highlighter: clampToolWidth("highlighter", this.state.widths.highlighter),
			eraser: clampToolWidth("eraser", this.state.widths.eraser)
		};
		if (this.state.selectionMode !== "single" && this.state.selectionMode !== "box" && this.state.selectionMode !== "lasso") {
			this.state.selectionMode = "single";
		}
		if (!initialState?.selectedPresetIds && initialState?.selectedPresetId) {
			const migratedPreset = this.presets.get(initialState.selectedPresetId);
			if (migratedPreset) {
				this.state.selectedPresetIds = {
					...this.state.selectedPresetIds,
					[migratedPreset.kind]: migratedPreset.id
				};
			}
		}
		if (!this.state.selectedPresetIds?.pen || !this.presets.has(this.state.selectedPresetIds.pen)) {
			this.state.selectedPresetIds = {
				...this.state.selectedPresetIds,
				pen: this.getPresetsByKind("pen")[0]?.id ?? "pen-slot-1"
			};
		}
		if (!this.state.selectedPresetIds?.highlighter || !this.presets.has(this.state.selectedPresetIds.highlighter)) {
			this.state.selectedPresetIds = {
				...this.state.selectedPresetIds,
				highlighter: this.getPresetsByKind("highlighter")[0]?.id ?? "highlight-slot-1"
			};
		}
		if (!this.state.selectedPresetIds?.eraser || !this.presets.has(this.state.selectedPresetIds.eraser)) {
			this.state.selectedPresetIds = {
				...this.state.selectedPresetIds,
				eraser: this.getPresetsByKind("eraser")[1]?.id ?? this.getPresetsByKind("eraser")[0]?.id ?? "eraser-slot-2"
			};
		}
		this.state.selectedPresetIds = {
			...this.state.selectedPresetIds,
			pen: this.getVisiblePresetId("pen", this.state.selectedPresetIds?.pen),
			highlighter: this.getVisiblePresetId("highlighter", this.state.selectedPresetIds?.highlighter),
			eraser: this.getVisiblePresetId("eraser", this.state.selectedPresetIds?.eraser)
		};
		if (this.state.selectedPresetId && this.presets.has(this.state.selectedPresetId)) {
			const selectedPresetId = this.state.selectedPresetId;
			this.state.selectedPresetId = null;
			this.applyPreset(selectedPresetId);
		} else {
			const defaultPreset = presets[0];
			if (defaultPreset) {
				this.applyPreset(defaultPreset.id);
			}
		}
	}

	get snapshot(): ToolStateSnapshot {
		return {
			...this.state,
			selectedPresetIds: { ...(this.state.selectedPresetIds ?? {}) },
			widths: { ...this.state.widths }
		};
	}

	get allPresets(): ToolPreset[] {
		return Array.from(this.presets.values()).map((preset) => ({ ...preset }));
	}

	get presetsSnapshot(): ToolPreset[] {
		return this.allPresets;
	}

	getPresetsByKind(kind: ToolPresetKind): ToolPreset[] {
		return Array.from(this.presets.values())
			.filter((preset) => preset.kind === kind)
			.slice(0, 3)
			.map((preset) => ({ ...preset }));
	}

	private getVisiblePresetId(kind: ToolPresetKind, presetId: string | null | undefined): string {
		const visiblePresets = this.getPresetsByKind(kind);
		if (presetId && visiblePresets.some((preset) => preset.id === presetId)) {
			return presetId;
		}
		return visiblePresets[0]?.id ?? DEFAULT_TOOL_PRESETS.find((preset) => preset.kind === kind)?.id ?? "";
	}

	get activeTool(): AnnotationTool {
		return this.state.activeTool;
	}

	get activeColor(): string {
		return this.state.activeColor;
	}

	get activeOpacity(): number {
		return this.state.activeOpacity;
	}

	get eraserMode(): EraserMode {
		return this.state.eraserMode;
	}

	get selectionMode(): SelectionMode {
		return this.state.selectionMode;
	}

	get selectedPresetId(): string | null {
		if (this.state.activeTool === "pen" || this.state.activeTool === "highlighter" || this.state.activeTool === "eraser") {
			return this.state.selectedPresetIds?.[this.state.activeTool] ?? this.state.selectedPresetId;
		}
		return this.state.selectedPresetId;
	}

	setActiveTool(tool: AnnotationTool): void {
		if (tool === "pen" || tool === "highlighter" || tool === "eraser") {
			const presetId = this.state.selectedPresetIds?.[tool];
			if (presetId && this.presets.has(presetId)) {
				this.applyPreset(presetId);
				return;
			}
		}
		this.state.activeTool = tool;
		if (tool === "pen" || tool === "highlighter") {
			this.state.activeOpacity = tool === "highlighter" ? 0.24 : 0.96;
		}
	}

	setColor(color: string): void {
		this.state.activeColor = color;
		this.syncSelectedPreset();
	}

	setEraserMode(mode: EraserMode): void {
		this.state.eraserMode = mode;
	}

	setSelectionMode(mode: SelectionMode): void {
		this.state.selectionMode = mode;
	}

	getWidth(tool = this.state.activeTool): number {
		if (tool === "highlighter") {
			return this.state.widths.highlighter;
		}
		if (tool === "eraser") {
			return this.state.widths.eraser;
		}
		return this.state.widths.pen;
	}

	setWidth(width: number, tool = this.state.activeTool): void {
		const targetTool = isShapeTool(tool) ? "pen" : tool;
		if (targetTool === "highlighter") {
			this.state.widths.highlighter = clampToolWidth("highlighter", width);
			this.syncSelectedPreset();
			return;
		}
		if (targetTool === "eraser") {
			this.state.widths.eraser = clampToolWidth("eraser", width);
			this.syncSelectedPreset();
			return;
		}
		this.state.widths.pen = clampToolWidth("pen", width);
		this.syncSelectedPreset();
	}

	applyPreset(presetId: string): boolean {
		const preset = this.presets.get(presetId);
		if (!preset) {
			return false;
		}
		this.state.selectedPresetId = preset.id;
		this.state.selectedPresetIds = {
			...this.state.selectedPresetIds,
			[preset.kind]: preset.id
		};
		this.state.activeTool = preset.kind;
		this.state.activeColor = preset.color;
		this.state.activeOpacity = preset.opacity;
		this.setWidth(preset.width, preset.kind);
		return true;
	}

	private syncSelectedPreset(): void {
		if (!this.state.selectedPresetId) {
			return;
		}
		const preset = this.presets.get(this.state.selectedPresetId);
		if (!preset || preset.kind !== this.state.activeTool) {
			return;
		}
		this.state.selectedPresetIds = {
			...this.state.selectedPresetIds,
			[preset.kind]: preset.id
		};
		preset.color = this.state.activeColor;
		preset.width = this.getWidth(preset.kind);
		preset.opacity = this.state.activeOpacity;
	}
}

export class PreviewStateController {
	private state: PreviewStateSnapshot = {
		clientX: null,
		clientY: null,
		visible: false,
		active: false,
		radius: 0
	};

	get snapshot(): PreviewStateSnapshot {
		return { ...this.state };
	}

	recordPointer(clientX: number, clientY: number): void {
		this.state.clientX = clientX;
		this.state.clientY = clientY;
	}

	show(radius: number, active: boolean): void {
		this.state.radius = radius;
		this.state.active = active;
		this.state.visible = true;
	}

	hide(): void {
		this.state.visible = false;
		this.state.active = false;
		this.state.radius = 0;
	}
}
