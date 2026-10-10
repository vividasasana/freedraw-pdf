import type { InkRenderSettings } from "../types";

export interface RoundInkPoint { x: number; y: number; pressure: number; t?: number; }
export interface RoundInkSample { x: number; y: number; radius: number; }
export type RoundInkPiece = { kind: "polygon"; points: [number, number][] } | { kind: "circle"; x: number; y: number; radius: number }
	| { kind: "tube"; a: RoundInkSample; b: RoundInkSample; leftAngle: number; rightAngle: number; frontArc: number; startCap: boolean; endCap: boolean };
export interface RoundedInkGeometry { samples: RoundInkSample[]; controlRadii: number[]; pieces: RoundInkPiece[]; }
export interface RoundInkOptions { startTaper?: number; endTaper?: number; startCap?: boolean; endCap?: boolean; previewQuality?: "fast"; }

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const distance = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(b.x - a.x, b.y - a.y);
function ease(value: number, mode: InkRenderSettings["easing"]): number {
	if (mode === "ease-in") return value * value;
	if (mode === "ease-out") return 1 - (1 - value) * (1 - value);
	if (mode === "ease-in-out") return value < .5 ? 2 * value * value : 1 - 2 * (1 - value) * (1 - value);
	return value;
}

/** Connected round tubes: overlapping pieces share one nonzero fill, never individual caps at a turn. */
export function buildRoundedInkGeometry(points: RoundInkPoint[], width: number, height: number, baseWidth: number, usePressure: boolean, settings: InkRenderSettings, options: RoundInkOptions = {}): RoundedInkGeometry {
	if (!points.length) return { samples: [], controlRadii: [], pieces: [] };
	const scale = 1524 / Math.max(1, width);
	const size = Math.max(.1, baseWidth * scale);
	const controls = points.map(p => ({ x: p.x * width * scale, y: p.y * height * scale }));
	const radii = points.map(p => {
		if (!usePressure || settings.thinning === 0) return size / 2;
		return Math.max(.01, size * ease(clamp(.5 + settings.thinning * (clamp(p.pressure, .06, 1) - .5), .01, 1), settings.easing));
	});
	const smoothing = clamp(settings.smoothing, 0, 1);
	const extraSmooth = settings.widthSmoothing === "extra-smooth";
	const localPressure = extraSmooth && settings.widthSmoothingVersion === 2;
	if (localPressure && usePressure && radii.length > 1) {
		// Keep most of each actual pressure sample. Only a small causal blend
		// softens abrupt changes: later peaks never lift earlier light-pressure ink.
		const reach = size * (.4 + 1.2 * smoothing);
		const weight = .12 + .13 * smoothing;
		let filtered = radii[0];
		for (let i = 1; i < radii.length; i++) {
			const raw = radii[i];
			const travel = distance(controls[i - 1], controls[i]);
			const elapsed = points[i].t !== undefined && points[i - 1].t !== undefined
				? Math.max(0, points[i].t! - points[i - 1].t!) : 0;
			const blend = 1 - Math.exp(-Math.max(travel / reach, elapsed / 24));
			filtered = lerp(filtered, raw, blend);
			radii[i] = lerp(raw, filtered, weight);
		}
	} else if (extraSmooth && usePressure && radii.length > 1) {
		// Filter in travelled distance, rather than event count, so sampling rate
		// and zoom do not determine the transition length. Two directions avoid
		// a delayed width response; lifting the result retains the original peak.
		const reach = size * (2 + 6 * smoothing);
		let peak = 0;
		for (const radius of radii) peak = Math.max(peak, radius);
		const forward = radii.slice(), backward = radii.slice();
		for (let i = 1; i < radii.length; i++) {
			const blend = 1 - Math.exp(-distance(controls[i - 1], controls[i]) / reach);
			forward[i] = lerp(forward[i - 1], radii[i], blend);
		}
		for (let i = radii.length - 2; i >= 0; i--) {
			const blend = 1 - Math.exp(-distance(controls[i + 1], controls[i]) / reach);
			backward[i] = lerp(backward[i + 1], radii[i], blend);
		}
		let filteredPeak = 0;
		for (let i = 0; i < radii.length; i++) {
			radii[i] = (forward[i] + backward[i]) / 2;
			filteredPeak = Math.max(filteredPeak, radii[i]);
		}
		for (let i = 0; i < radii.length; i++) radii[i] = peak - .55 * (filteredPeak - radii[i]);
	}
	// Extend a wide point into its neighbours. Max propagation preserves every
	// maximum exactly instead of averaging it down or compressing the pressure range.
	if (!localPressure && (smoothing > 0 || extraSmooth)) {
		const slope = extraSmooth ? .025 - .020 * smoothing : .65 - .60 * smoothing;
		const inverse = usePressure && settings.thinning < 0;
		for (let i = 1; i < radii.length; i++) {
			const delta = slope * distance(controls[i - 1], controls[i]);
			radii[i] = inverse ? Math.min(radii[i], radii[i - 1] + delta) : Math.max(radii[i], radii[i - 1] - delta);
		}
		for (let i = radii.length - 2; i >= 0; i--) {
			const delta = slope * distance(controls[i + 1], controls[i]);
			radii[i] = inverse ? Math.min(radii[i], radii[i + 1] + delta) : Math.max(radii[i], radii[i + 1] - delta);
		}
	}
	const cumulative = [0];
	for (let i = 1; i < controls.length; i++) cumulative[i] = cumulative[i - 1] + distance(controls[i - 1], controls[i]);
	const total = cumulative[cumulative.length - 1];
	const startTaper = options.startTaper === undefined ? settings.taperStart : options.startTaper * scale;
	const endTaper = options.endTaper === undefined ? settings.taperEnd : options.endTaper * scale;
	for (let i = 0; i < radii.length; i++) {
		const start = startTaper > 0 ? ease(Math.min(1, cumulative[i] / startTaper), settings.easing) : 1;
		const end = endTaper > 0 ? ease(Math.min(1, (total - cumulative[i]) / endTaper), settings.easing) : 1;
		radii[i] = Math.max(.01, radii[i] * Math.min(start, end));
	}
	const samples: RoundInkSample[] = [{ ...controls[0], radius: radii[0] }];
	const smoothEdges = settings.edgeGeometryVersion === 2;
	const cut = .5 * smoothing;
	const fastPreview = options.previewQuality === "fast";
	const step = Math.max(.25, size * (fastPreview ? .28 : .12));
	for (let i = 1; i < controls.length - 1; i++) {
		const previous = controls[i - 1], point = controls[i], next = controls[i + 1];
		if (cut === 0) { samples.push({ ...point, radius: radii[i] }); continue; }
		const from = { x: lerp(point.x, previous.x, cut), y: lerp(point.y, previous.y, cut), radius: lerp(radii[i], radii[i - 1], cut) };
		const to = { x: lerp(point.x, next.x, cut), y: lerp(point.y, next.y, cut), radius: lerp(radii[i], radii[i + 1], cut) };
		samples.push(from);
		// An even number of steps keeps the t=.5 sample and its full peak radius.
		const curvature = Math.hypot(from.x - 2 * point.x + to.x, from.y - 2 * point.y + to.y);
		const edgeSteps = smoothEdges ? Math.ceil(Math.sqrt(curvature / (4 * Math.max(.01, size * .01))) / 2) * 2 : 2;
		const steps = Math.min(smoothEdges ? (fastPreview ? 8 : 128) : (fastPreview ? 6 : 20), Math.max(2, edgeSteps, Math.ceil((distance(from, point) + distance(point, to)) / step / 2) * 2));
		for (let j = 1; j <= steps; j++) {
			const t = j / steps, u = 1 - t;
			const fraction = t <= .5 ? t * 2 : (t - .5) * 2;
			const blend = fraction * fraction * (3 - 2 * fraction);
			samples.push({ x: u * u * from.x + 2 * u * t * point.x + t * t * to.x,
				y: u * u * from.y + 2 * u * t * point.y + t * t * to.y,
				radius: localPressure ? u * u * from.radius + 2 * u * t * radii[i] + t * t * to.radius
					: t <= .5 ? lerp(from.radius, radii[i], blend) : lerp(radii[i], to.radius, blend) });
		}
	}
	if (controls.length > 1) samples.push({ ...controls[controls.length - 1], radius: radii[radii.length - 1] });
	const kept: RoundInkSample[] = [];
	for (let i = 0; i < samples.length; i++) {
		const p = samples[i], last = kept[kept.length - 1], next = samples[i + 1], prev = samples[i - 1];
		const peak = prev && next && (p.radius >= prev.radius && p.radius >= next.radius && (p.radius > prev.radius + 1e-6 || p.radius > next.radius + 1e-6)
			|| p.radius <= prev.radius && p.radius <= next.radius && (p.radius < prev.radius - 1e-6 || p.radius < next.radius - 1e-6));
		if (!last || i === samples.length - 1 || peak || distance(last, p) >= step || Math.abs(last.radius - p.radius) >= size * .015) kept.push(p);
	}
	const converted = kept.map(p => ({ x: p.x / scale, y: p.y / scale, radius: p.radius / scale }));
	return { samples: converted, controlRadii: radii.map(r => r / scale), pieces: createRoundedInkPieces(converted, options, smoothEdges) };
}

export function createRoundedInkPieces(converted: RoundInkSample[], options: RoundInkOptions = {}, smoothEdges = true, compact = false): RoundInkPiece[] {
	const pieces: RoundInkPiece[] = [];
	for (let i = 1; i < converted.length; i++) {
		const a = converted[i - 1], b = converted[i], length = distance(a, b);
		if (length < 1e-8) continue;
		const nx = -(b.y - a.y) / length, ny = (b.x - a.x) / length;
		if (smoothEdges) {
			// Connect the two pressure disks at their common external tangents.
			// Perpendicular offsets meet unequal disks at an angle, leaving a kink.
			const along = (a.radius - b.radius) / length;
			if (Math.abs(along) >= 1) {
				if (compact) pieces.push({ kind: "circle", ...(a.radius >= b.radius ? a : b) });
				continue; // One disk contains the other.
			}
			if (compact) {
				const direction = Math.atan2(b.y - a.y, b.x - a.x), angle = Math.acos(along);
				pieces.push({ kind: "tube", a, b, leftAngle: direction + angle, rightAngle: direction - angle, frontArc: 2 * angle,
					startCap: i !== 1 || options.startCap !== false, endCap: i !== converted.length - 1 || options.endCap !== false });
				continue;
			}
			const across = Math.sqrt(Math.max(0, 1 - along * along));
			const ux = (b.x - a.x) / length, uy = (b.y - a.y) / length;
			const left = { x: ux * along + nx * across, y: uy * along + ny * across };
			const right = { x: ux * along - nx * across, y: uy * along - ny * across };
			pieces.push({ kind: "polygon", points: [[a.x + left.x * a.radius, a.y + left.y * a.radius], [b.x + left.x * b.radius, b.y + left.y * b.radius], [b.x + right.x * b.radius, b.y + right.y * b.radius], [a.x + right.x * a.radius, a.y + right.y * a.radius]] });
			continue;
		}
		// Every polygon and circle uses the same winding, so crossings add ink
		// rather than opening holes or making a second disconnected head.
		pieces.push({ kind: "polygon", points: [[a.x + nx * a.radius, a.y + ny * a.radius], [b.x + nx * b.radius, b.y + ny * b.radius], [b.x - nx * b.radius, b.y - ny * b.radius], [a.x - nx * a.radius, a.y - ny * a.radius]] });
	}
	converted.forEach((p, i) => {
		if (compact && converted.length > 1) return;
		if (converted.length > 1 && (i === 0 && options.startCap === false || i === converted.length - 1 && options.endCap === false)) return;
		pieces.push({ kind: "circle", ...p });
	});
	return pieces;
}
