import type { InkRenderSettings } from "../types";
import { createRoundedInkPieces, type RoundInkPoint, type RoundInkSample, type RoundInkOptions, type RoundedInkGeometry } from "./roundedInkGeometry";

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const distance = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
function pressureRadius(pressure: number, size: number, usePressure: boolean, settings: InkRenderSettings): number {
	if (!usePressure || settings.thinning === 0) return size / 2;
	let value = clamp(.5 + settings.thinning * (clamp(pressure, .06, 1) - .5), .01, 1);
	if (settings.easing === "ease-in") value *= value;
	else if (settings.easing === "ease-out") value = 1 - (1 - value) ** 2;
	else if (settings.easing === "ease-in-out") value = value < .5 ? 2 * value * value : 1 - 2 * (1 - value) ** 2;
	return Math.max(.01, size * value);
}

/** Continuous tangents and monotone pressure widths, independent of event timestamps. */
export function buildContinuousInkGeometry(points: RoundInkPoint[], width: number, height: number, baseWidth: number, usePressure: boolean, settings: InkRenderSettings, options: RoundInkOptions = {}, range?: { start: number; end: number }): RoundedInkGeometry {
	if (!points.length) return { samples: [], controlRadii: [], pieces: [] };
	const scale = 1524 / Math.max(1, width), size = Math.max(.1, baseWidth * scale);
	const raw = points.map(p => ({ x: p.x * width * scale, y: p.y * height * scale, radius: pressureRadius(p.pressure, size, usePressure, settings) }));
	// Bound spatial denoising to a fraction of the nib width. Preserve endpoints
	// and never feed path speed or position into the pressure response.
	const controls = raw.map((p, i) => {
		if (i === 0 || i === raw.length - 1 || settings.streamline === 0) return { ...p };
		const previous = raw[i - 1], next = raw[i + 1];
		const first = distance(previous, p), second = distance(p, next), total = first + second;
		if (total < 1e-8) return { ...p };
		const dx = (lerp(previous.x, next.x, first / total) - p.x) * .25 * settings.streamline;
		const dy = (lerp(previous.y, next.y, first / total) - p.y) * .25 * settings.streamline;
		const correction = Math.hypot(dx, dy), limit = Math.min(size * .2 * settings.streamline, Math.min(first, second) * .12);
		const fraction = correction > limit ? limit / correction : 1;
		return { x: p.x + dx * fraction, y: p.y + dy * fraction, radius: p.radius };
	});
	const lengths = controls.slice(1).map((p, i) => distance(controls[i], p));
	const cumulative = [0];
	lengths.forEach((length, i) => cumulative[i + 1] = cumulative[i] + length);
	const totalLength = cumulative[cumulative.length - 1] ?? 0;
	const startTaper = options.startTaper === undefined ? settings.taperStart : options.startTaper * scale;
	const endTaper = options.endTaper === undefined ? settings.taperEnd : options.endTaper * scale;
	controls.forEach((p, i) => {
		const start = startTaper > 0 ? clamp(cumulative[i] / startTaper, 0, 1) : 1;
		const end = endTaper > 0 ? clamp((totalLength - cumulative[i]) / endTaper, 0, 1) : 1;
		p.radius = Math.max(.01, p.radius * Math.min(start, end));
	});
	const secants = lengths.map((length, i) => length > 1e-8 ? (controls[i + 1].radius - controls[i].radius) / length : 0);
	const slopes = controls.map((_, i) => {
		if (i === 0) return secants[0] ?? 0;
		if (i === controls.length - 1) return secants[secants.length - 1] ?? 0;
		const a = secants[i - 1], b = secants[i];
		return a * b > 0 ? Math.sign(a) * Math.min(Math.abs(a), Math.abs(b)) : 0;
	});
	const directions = controls.map((p, i) => {
		const previous = controls[Math.max(0, i - 1)], next = controls[Math.min(controls.length - 1, i + 1)];
		const a = Math.max(1e-8, distance(previous, p)), b = Math.max(1e-8, distance(p, next));
		const x = (p.x - previous.x) / a + (next.x - p.x) / b;
		const y = (p.y - previous.y) / a + (next.y - p.y) / b;
		const magnitude = Math.hypot(x, y);
		return magnitude > 1e-8 ? { x: x / magnitude, y: y / magnitude } : { x: 0, y: 0 };
	});
	const startSegment = range?.start ?? 0, endSegment = range?.end ?? lengths.length;
	const samples: RoundInkSample[] = [{ ...controls[startSegment] }];
	const tolerance = Math.max(.015, size * (options.previewQuality === "fast" ? .04 : .008));
	for (let i = startSegment; i < endSegment; i++) {
		const a = controls[i], b = controls[i + 1], length = lengths[i];
		if (length < 1e-8) {
			// Keep a changing force at a stationary contact without duplicate disks.
			const last = samples[samples.length - 1];
			last.radius = Math.max(last.radius, b.radius);
			continue;
		}
		const reachA = Math.min(length, lengths[i - 1] ?? length) * settings.smoothing / 3;
		const reachB = Math.min(length, lengths[i + 1] ?? length) * settings.smoothing / 3;
		const c = { x: a.x + directions[i].x * reachA, y: a.y + directions[i].y * reachA };
		const d = { x: b.x - directions[i + 1].x * reachB, y: b.y - directions[i + 1].y * reachB };
		const at = (t: number): RoundInkSample => {
			const u = 1 - t, t2 = t * t, t3 = t2 * t;
			const radius = settings.widthSmoothing === "original" ? lerp(a.radius, b.radius, t)
				: (2 * t3 - 3 * t2 + 1) * a.radius + (t3 - 2 * t2 + t) * length * slopes[i]
					+ (-2 * t3 + 3 * t2) * b.radius + (t3 - t2) * length * slopes[i + 1];
			return { x: u ** 3 * a.x + 3 * u * u * t * c.x + 3 * u * t2 * d.x + t3 * b.x,
				y: u ** 3 * a.y + 3 * u * u * t * c.y + 3 * u * t2 * d.y + t3 * b.y,
				radius: clamp(radius, Math.min(a.radius, b.radius), Math.max(a.radius, b.radius)) };
		};
		const subdivide = (fromT: number, toT: number, from: RoundInkSample, to: RoundInkSample, depth: number): void => {
			let error = 0;
			for (const fraction of [.25, .5, .75]) {
				const p = at(lerp(fromT, toT, fraction));
				error = Math.max(error, distance(p, { x: lerp(from.x, to.x, fraction), y: lerp(from.y, to.y, fraction) }), Math.abs(p.radius - lerp(from.radius, to.radius, fraction)));
			}
			if (error <= tolerance || depth >= 7) { samples.push(to); return; }
			const middleT = (fromT + toT) / 2, middle = at(middleT);
			subdivide(fromT, middleT, from, middle, depth + 1);
			subdivide(middleT, toT, middle, to, depth + 1);
		};
		subdivide(0, 1, a, b, 0);
	}
	const converted = samples.map(p => ({ x: p.x / scale, y: p.y / scale, radius: p.radius / scale }));
	return { samples: converted, controlRadii: controls.map(p => p.radius / scale), pieces: createRoundedInkPieces(converted, options, true, true) };
}
