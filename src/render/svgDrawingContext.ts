import { ScrollPreviewCache } from "./scrollPreviewCache";
import { buildContinuousInkGeometry } from "../ink/continuousInkGeometry";
import { fillRoundedInkGeometry } from "../ink/inkEngine";
import { isEmbeddedImageDataUrl } from "../utils/imageData";
import type { StrokeAnnotation } from "../types";

interface PaintRecord {
	key: string;
	node: SVGElement;
}
interface StrokeCacheEntry { signature: string; records: PaintRecord[]; }
interface LiveStrokeEntry { signature: string; node: SVGGElement; tail: SVGElement | null; end: number; count: number; points: StrokeAnnotation["points"]; lastPoint: StrokeAnnotation["points"][number] | null; }
interface LayerState {
	body: SVGGElement;
	live: SVGGElement;
	bodyRecords: Map<string, PaintRecord>;
	liveRecords: Map<string, PaintRecord>;
	cache: WeakMap<StrokeAnnotation, StrokeCacheEntry>;
	liveCache: WeakMap<StrokeAnnotation, LiveStrokeEntry>;
	width: number;
	height: number;
	mask?: SVGDefsElement;
}

/** Records the same logical drawing commands as Canvas without a raster backing store. */
export class SvgDrawingContext {
	readonly records: PaintRecord[] = [];
	lineCap: CanvasLineCap = "butt";
	lineJoin: CanvasLineJoin = "miter";
	lineWidth = 1;
	fillStyle: string | CanvasGradient | CanvasPattern = "#000000";
	strokeStyle: string | CanvasGradient | CanvasPattern = "#000000";
	globalAlpha = 1;
	globalCompositeOperation: GlobalCompositeOperation = "source-over";
	font = 'normal normal 12px "sans-serif", sans-serif';
	textAlign: CanvasTextAlign = "left";
	textBaseline: CanvasTextBaseline = "top";
	private path: (string | number)[] = [];
	private dash: number[] = [];
	private prefix = "frame";
	private part = 0;
	private measureContext: CanvasRenderingContext2D | null = null;
	private readonly fragment: DocumentFragment;
	private readonly stack: Array<{
		lineCap: CanvasLineCap; lineJoin: CanvasLineJoin; lineWidth: number;
		fillStyle: string | CanvasGradient | CanvasPattern; strokeStyle: string | CanvasGradient | CanvasPattern;
		globalAlpha: number; globalCompositeOperation: GlobalCompositeOperation;
		font: string; textAlign: CanvasTextAlign; textBaseline: CanvasTextBaseline; dash: number[];
	}> = [];

	constructor(readonly root: SVGSVGElement, readonly width: number, readonly height: number, private readonly cache: WeakMap<StrokeAnnotation, StrokeCacheEntry>, private readonly liveCache = new WeakMap<StrokeAnnotation, LiveStrokeEntry>()) {
		const ownerWindow = root.ownerDocument.defaultView;
		if (!ownerWindow) { throw new Error("SVG annotation window is unavailable."); }
		this.fragment = ownerWindow.createFragment();
	}

	setKey(key: string): void { this.prefix = key; this.part = 0; }
	drawCachedStroke(stroke: StrokeAnnotation, signature: string, draw: () => void): void {
		const cached = this.cache.get(stroke);
		if (cached?.signature === signature) { this.records.push(...cached.records); return; }
		const start = this.records.length;
		draw();
		this.cache.set(stroke, { signature, records: this.records.slice(start) });
	}
	/** Keep stable curve intervals in the DOM; only fit a bounded recent tail. */
	drawLiveContinuousStroke(stroke: StrokeAnnotation, baseWidth: number, fast: boolean): boolean {
		const settings = stroke.inkSettings;
		// Taper depends on total stroke length, so retain the full fitter for that case.
		if (settings?.inkModel !== "continuous-v1" || settings.taperStart !== 0 || settings.taperEnd !== 0 || stroke.points.length < 2) return false;
		const signature = `${this.width}:${this.height}:${baseWidth}:${stroke.color}:${stroke.tool}:${fast}:${JSON.stringify(settings)}`;
		let entry = this.liveCache.get(stroke);
		if (!entry || entry.signature !== signature || entry.points !== stroke.points || stroke.points.length < entry.count) {
			entry = { signature, node: this.fragment.createSvg("g", { attr: { opacity: stroke.tool === "highlighter" ? 0.24 : 0.96 } }), tail: null, end: 0, count: 0, points: stroke.points, lastPoint: null };
			this.liveCache.set(stroke, entry);
		}
		const fit = (start: number, end: number): SVGElement | null => {
			// Three neighbouring raw points cover denoising, tangent and width-slope dependencies.
			const from = Math.max(0, start - 3), to = Math.min(stroke.points.length, end + 4);
			const geometry = buildContinuousInkGeometry(stroke.points.slice(from, to), this.width, this.height, baseWidth,
				stroke.tool !== "highlighter", settings, { previewQuality: fast ? "fast" : undefined }, { start: start - from, end: end - from });
			const drawing = new SvgDrawingContext(this.root, this.width, this.height, this.cache);
			drawing.fillStyle = stroke.color;
			// Opacity belongs to the parent group: joins and crossings must not darken.
			fillRoundedInkGeometry(drawing, geometry);
			return drawing.records[0]?.node ?? null;
		};
		const last = stroke.points.length - 1;
		if (entry.count !== stroke.points.length || entry.lastPoint !== stroke.points[last]) {
			entry.tail?.remove();
			while (entry.end + 64 + 3 <= last) {
				const node = fit(entry.end, entry.end + 64);
				if (node) entry.node.appendChild(node);
				entry.end += 64;
			}
			entry.tail = fit(entry.end, last);
			if (entry.tail) entry.node.appendChild(entry.tail);
			entry.count = stroke.points.length;
			entry.lastPoint = stroke.points[last];
		}
		this.add(entry.node);
		return true;
	}

	// Finishing a stroke can reuse its exact accurate preview, avoiding a full
	// synchronous curve rebuild at Pencil lift. Fast previews still rebuild accurately.
	reuseLiveContinuousStroke(stroke: StrokeAnnotation, baseWidth: number): boolean {
		return this.liveCache.has(stroke) && this.drawLiveContinuousStroke(stroke, baseWidth, false);
	}

	save(): void {
		this.stack.push({ lineCap: this.lineCap, lineJoin: this.lineJoin, lineWidth: this.lineWidth,
			fillStyle: this.fillStyle, strokeStyle: this.strokeStyle, globalAlpha: this.globalAlpha,
			globalCompositeOperation: this.globalCompositeOperation, font: this.font,
			textAlign: this.textAlign, textBaseline: this.textBaseline, dash: [...this.dash] });
	}
	restore(): void { const state = this.stack.pop(); if (state) { Object.assign(this, state); } }
	// Canvas backing-store transforms do not apply to SVG's logical page coordinates.
	setTransform(_a = 1, _b = 0, _c = 0, _d = 1, _e = 0, _f = 0): void {}
	clearRect(_x = 0, _y = 0, _width = 0, _height = 0): void { this.records.length = 0; this.path = []; }
	setLineDash(dash: number[]): void { this.dash = [...dash]; }
	getLineDash(): number[] { return [...this.dash]; }
	beginPath(): void { this.path = []; }
	moveTo(x: number, y: number): void { this.path.push("M", x, y); }
	lineTo(x: number, y: number): void { this.path.push("L", x, y); }
	quadraticCurveTo(cx: number, cy: number, x: number, y: number): void { this.path.push("Q", cx, cy, x, y); }
	bezierCurveTo(cx1: number, cy1: number, cx2: number, cy2: number, x: number, y: number): void { this.path.push("C", cx1, cy1, cx2, cy2, x, y); }
	closePath(): void { this.path.push("Z"); }
	rect(x: number, y: number, width: number, height: number): void {
		this.moveTo(x, y); this.lineTo(x + width, y); this.lineTo(x + width, y + height); this.lineTo(x, y + height); this.closePath();
	}
	arc(x: number, y: number, radius: number, start: number, end: number, anticlockwise = false): void {
		this.ellipse(x, y, radius, radius, 0, start, end, anticlockwise);
	}
	ellipse(x: number, y: number, rx: number, ry: number, rotation: number, start: number, end: number, anticlockwise = false): void {
		const point = (angle: number) => [x + rx * Math.cos(angle) * Math.cos(rotation) - ry * Math.sin(angle) * Math.sin(rotation),
			y + rx * Math.cos(angle) * Math.sin(rotation) + ry * Math.sin(angle) * Math.cos(rotation)];
		const first = point(start);
		if (this.path.length === 0) { this.moveTo(first[0], first[1]); } else { this.lineTo(first[0], first[1]); }
		const sweep = anticlockwise ? 0 : 1;
		let delta = end - start;
		if (Math.abs(delta) >= Math.PI * 2) delta = (anticlockwise ? -1 : 1) * Math.PI * 2;
		else if (anticlockwise && delta > 0) delta -= Math.PI * 2;
		else if (!anticlockwise && delta < 0) delta += Math.PI * 2;
		const steps = Math.max(1, Math.ceil(Math.abs(delta) / Math.PI));
		for (let i = 1; i <= steps; i++) {
			const next = point(start + delta * i / steps);
			this.path.push("A", rx, ry, rotation * 180 / Math.PI, 0, sweep, next[0], next[1]);
		}
	}
	fill(): void { this.paintPath(false); }
	stroke(): void { this.paintPath(true); }
	fillRect(x: number, y: number, width: number, height: number): void { const old = this.path; this.path = []; this.rect(x, y, width, height); this.fill(); this.path = old; }
	strokeRect(x: number, y: number, width: number, height: number): void { const old = this.path; this.path = []; this.rect(x, y, width, height); this.stroke(); this.path = old; }
	private paintPath(stroke: boolean): void {
		if (this.path.length === 0 || this.path.some(value => typeof value === "number" && !Number.isFinite(value))) { return; }
		const node = this.fragment.createSvg("path", { attr: {
			d: this.path.map(value => typeof value === "number" ? Math.round(value * 1000) / 1000 : value).join(" "), fill: stroke ? "none" : String(this.fillStyle), "fill-rule": "nonzero",
			stroke: stroke ? String(this.strokeStyle) : "none", "stroke-width": this.lineWidth,
			"stroke-linecap": this.lineCap, "stroke-linejoin": this.lineJoin,
			"stroke-dasharray": this.dash.length ? this.dash.join(" ") : "none", opacity: this.globalAlpha
		} });
		this.add(node);
	}
	measureText(text: string): TextMetrics {
		if (!this.measureContext) {
			const canvas = this.root.ownerDocument.defaultView?.createEl("canvas");
			if (canvas) { canvas.width = 1; canvas.height = 1; this.measureContext = canvas.getContext("2d"); }
		}
		if (!this.measureContext) { throw new Error("Text measurement is unavailable."); }
		this.measureContext.font = this.font;
		return this.measureContext.measureText(text);
	}
	fillText(text: string, x: number, y: number): void {
		const font = /^(normal|italic) (normal|bold) ([\d.e+-]+)px "(.*)", sans-serif$/.exec(this.font);
		const node = this.fragment.createSvg("text", { attr: {
			x, y, fill: String(this.fillStyle), opacity: this.globalAlpha,
			"font-style": font?.[1] ?? "normal", "font-weight": font?.[2] ?? "normal",
			"font-size": font?.[3] ?? "12", "font-family": font ? `"${font[4]}", sans-serif` : "sans-serif",
			"text-anchor": this.textAlign === "center" ? "middle" : this.textAlign === "right" || this.textAlign === "end" ? "end" : "start",
			"dominant-baseline": this.textBaseline === "top" ? "text-before-edge" : "auto", "xml:space": "preserve"
		} });
		node.textContent = text;
		this.add(node);
	}
	drawImage(source: CanvasImageSource, ...coordinates: number[]): void {
		if (!("src" in source) || typeof source.src !== "string" || !isEmbeddedImageDataUrl(source.src)) { return; }
		if (coordinates.length !== 4) { return; }
		const [x, y, width, height] = coordinates;
		this.add(this.fragment.createSvg("image", { attr: { href: source.src, x, y, width, height, opacity: this.globalAlpha, preserveAspectRatio: "none" } }));
	}
	private add(node: SVGElement): void { this.records.push({ key: `${this.prefix}:${this.part++}`, node }); }
}

let nextMaskId = 0;

export class SvgAnnotationRenderer {
	private readonly layers = new WeakMap<SVGSVGElement, LayerState>();
	private readonly scrollPreviews = new ScrollPreviewCache();
	prepareMotionPreview(root: SVGSVGElement, isCurrent: () => boolean): Promise<boolean> {
		const state = this.layers.get(root);
		if (!state || state.mask || state.bodyRecords.size < 80) return Promise.resolve(false);
		return this.scrollPreviews.prepare(root, state.body, state.width, state.height, isCurrent);
	}
	showMotionPreview(root: SVGSVGElement): boolean { return this.scrollPreviews.show(root); }
	hideMotionPreviews(): void { this.scrollPreviews.hideAll(); }
	invalidateMotionPreviews(root?: SVGSVGElement): void { if (root) this.scrollPreviews.invalidate(root); else this.scrollPreviews.clear(); }
	hasCommittedFrame(root: SVGSVGElement): boolean {
		const state = this.layers.get(root);
		return !!state && state.width > 0 && state.height > 0;
	}
	private state(root: SVGSVGElement): LayerState {
		let state = this.layers.get(root);
		if (!state) {
			state = { body: root.createSvg("g", { attr: { "data-freedraw-layer": "body" } }), live: root.createSvg("g", { attr: { "data-freedraw-layer": "live" } }), bodyRecords: new Map(), liveRecords: new Map(), cache: new WeakMap(), liveCache: new WeakMap(), width: 0, height: 0 };
			this.layers.set(root, state);
		}
		return state;
	}
	create(root: SVGSVGElement, width: number, height: number): SvgDrawingContext { return new SvgDrawingContext(root, width, height, this.state(root).cache, this.state(root).liveCache); }
	publish(frame: SvgDrawingContext, live = false): void {
		if (!live) this.scrollPreviews.invalidate(frame.root);
		const state = this.state(frame.root);
		if (!live || state.width === 0) {
			state.width = frame.width; state.height = frame.height;
			frame.root.setAttribute("viewBox", `0 0 ${frame.width} ${frame.height}`);
		}
		if (!live) { state.mask?.remove(); state.mask = undefined; state.body.removeAttribute("mask"); }
		const target = live ? state.live : state.body;
		if (live) { target.setAttribute("transform", `scale(${state.width / frame.width} ${state.height / frame.height})`); }
		const previous = live ? state.liveRecords : state.bodyRecords;
		const next = new Map(frame.records.map(record => [record.key, record]));
		for (const [key, record] of previous) { if (!next.has(key) || next.get(key)?.node !== record.node) { record.node.remove(); } }
		let cursor = target.firstChild;
		for (const record of next.values()) {
			if (record.node !== cursor) { target.insertBefore(record.node, cursor); }
			cursor = record.node.nextSibling;
		}
		for (const child of Array.from(target.children)) {
			if (child.localName === "g" && child.childElementCount === 0) { child.remove(); }
		}
		if (live) { state.liveRecords = next; } else { state.bodyRecords = next; }
	}
	clearLive(root: SVGSVGElement): void { const state = this.layers.get(root); state?.live.replaceChildren(); state?.liveRecords.clear(); if (state) state.liveCache = new WeakMap(); }
	promote(root: SVGSVGElement): void {
		this.scrollPreviews.invalidate(root);
		const state = this.layers.get(root);
		if (!state) { return; }
		// Keep the live coordinate system during a pending zoom replacement.
		if (state.liveRecords.size > 0) {
			const group = state.body.createSvg("g", { attr: { transform: state.live.getAttribute("transform") ?? "" } });
			for (const record of state.liveRecords.values()) { group.appendChild(record.node); state.bodyRecords.set(record.key, record); }
		}
		state.liveRecords.clear();
	}
	erase(root: SVGSVGElement, pageWidth: number, pageHeight: number, start: { x: number; y: number }, end: { x: number; y: number }, radius: number): void {
		this.scrollPreviews.invalidate(root);
		const state = this.state(root);
		if (!state.mask) {
			state.mask = root.createSvg("defs");
			const id = `freedraw-vector-erase-${++nextMaskId}`;
			// Limit the temporary eraser mask to the viewport, rather than asking
			// WebKit to allocate a zoom-sized mask for the entire PDF page.
			const rect = root.getBoundingClientRect();
			const host = root.ownerDocument.defaultView;
			const x = Math.max(0, -rect.left * state.width / Math.max(rect.width, 1));
			const y = Math.max(0, -rect.top * state.height / Math.max(rect.height, 1));
			const right = Math.min(state.width, ((host?.innerWidth ?? rect.width) - rect.left) * state.width / Math.max(rect.width, 1));
			const bottom = Math.min(state.height, ((host?.innerHeight ?? rect.height) - rect.top) * state.height / Math.max(rect.height, 1));
			const mask = state.mask.createSvg("mask", { attr: { id, maskUnits: "userSpaceOnUse", x, y, width: Math.max(1, right - x), height: Math.max(1, bottom - y) } });
			mask.createSvg("rect", { attr: { x, y, width: Math.max(1, right - x), height: Math.max(1, bottom - y), fill: "white" } });
			state.body.setAttribute("mask", `url(#${id})`);
		}
		const mask = state.mask.firstElementChild;
		mask?.createSvg("path", { attr: { d: `M ${start.x * state.width} ${start.y * state.height} L ${end.x * state.width} ${end.y * state.height}`,
			fill: "none", stroke: "black", "stroke-width": radius * 2 * state.width / Math.max(pageWidth, 1), "stroke-linecap": "round" } });
		void pageHeight;
	}
	release(root: SVGSVGElement): void { this.scrollPreviews.invalidate(root); root.replaceChildren(); this.layers.delete(root); }
}
