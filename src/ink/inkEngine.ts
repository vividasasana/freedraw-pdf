import { getStroke } from "perfect-freehand";
import { buildRoundedInkGeometry, type RoundedInkGeometry } from "./roundedInkGeometry";
import { buildContinuousInkGeometry } from "./continuousInkGeometry";
import type { InkEasingMode, InkRenderSettings } from "../types";

export interface InkPoint {
	x: number;
	y: number;
	pressure: number;
	t?: number;
}

export interface InkStroke {
	inkSettings?: InkRenderSettings;
	widthScale?: number;
	points: InkPoint[];
}

export interface InkRenderOptions {
	/** Canvas consumers can skip building an unused SVG path without changing ink geometry. */
	serializePath?: boolean;
	inkSettings?: InkRenderSettings;
	renderMode?: "live" | "committed";
	previewQuality?: "fast";
	predictionStrength?: number;
	startTaper?: number;
	endTaper?: number;
	startCap?: boolean;
	endCap?: boolean;
}

export interface InkAppendOptions {
	mergeThreshold?: number;
	forceCommitFinalPoint?: boolean;
}

export type InkStrokeOutline = number[][];
export type InkDrawingContext = Pick<CanvasRenderingContext2D, "beginPath" | "moveTo" | "lineTo" | "quadraticCurveTo" | "arc" | "closePath" | "fill" | "stroke" | "lineWidth">;

const INK_MAX_SMOOTHING_WINDOW_MS = 100;
const INK_OUTPUT_RATE_HZ = 180;
const INK_OUTPUT_INTERVAL_MS = 1000 / INK_OUTPUT_RATE_HZ;
const INK_END_OF_STROKE_MAX_ITERATIONS = 20;
const INK_SPEED_FLOOR = 1.31;
const INK_SPEED_CEILING = 1.44;
const INK_PREDICTION_MS = 8;
const INK_MAX_PREDICTION_DISTANCE = 0.006;
const INK_TAPER_MIN_MULTIPLIER = 0.72;
const INK_TAPER_MAX_LENGTH = 0.018;
const INK_MIN_DOT_DISTANCE = 0.0012;
const INK_PRESSURE_WIDTH_VARIATION = 0.18;
const INK_CENTERLINE_SMOOTHING_PASSES = 1;
const INK_PRESSURE_GAIN = 1.25;
const INK_PRESSURE_SLEW_PER_WIDTH = 0.3;
const INK_PRESSURE_SMOOTHING_ALPHA = 0.4;
const GENTLE_PRESSURE_SMOOTHING_ALPHA = 0.3;
const GENTLE_PRESSURE_SLEW_PER_WIDTH = 0.12;
const GENTLE_PRESSURE_MIN_STEP = 0.004;
const GENTLE_PRESSURE_MAX_STEP = 0.08;

const DEFAULT_INK_RENDER_SETTINGS: InkRenderSettings = {
	inkModel: "continuous-v1",
	smoothingMode: "pressure",
	pressureResponse: "gentle",
	strokeGeometry: "round",
	edgeGeometryVersion: 2,
	widthSmoothing: "extra-smooth",
	widthSmoothingVersion: 2,
	thinning: 0.5,
	streamline: 0.12,
	smoothing: 0.5,
	easing: "linear",
	taperStart: 0,
	taperEnd: 0,
	pressureMode: "auto"
};

let activeInkRenderSettings: InkRenderSettings = { ...DEFAULT_INK_RENDER_SETTINGS };

export function setInkRenderSettings(settings: Partial<InkRenderSettings> | null | undefined): void {
	activeInkRenderSettings = {
		...(settings?.inkModel === "continuous-v1" || !settings ? { inkModel: "continuous-v1" as const } : {}),
		...(settings?.smoothingMode === "pressure" || !settings ? { smoothingMode: "pressure" as const } : {}),
		...(settings?.smoothingMode === "pressure" && settings.pressureResponse === "gentle" || !settings ? { pressureResponse: "gentle" as const } : {}),
		...(settings?.strokeGeometry === "round" || !settings ? { strokeGeometry: "round" as const } : {}),
		...(settings?.edgeGeometryVersion === 2 || !settings ? { edgeGeometryVersion: 2 as const } : {}),
		...(settings?.widthSmoothing === "original" || settings?.widthSmoothing === "extra-smooth" ? { widthSmoothing: settings.widthSmoothing } : !settings ? { widthSmoothing: "extra-smooth" as const } : {}),
		...(settings?.widthSmoothingVersion === 2 || !settings ? { widthSmoothingVersion: 2 as const } : {}),
		thinning: clamp(settings?.thinning ?? DEFAULT_INK_RENDER_SETTINGS.thinning, -1, 1),
		streamline: clamp(settings?.streamline ?? DEFAULT_INK_RENDER_SETTINGS.streamline, 0, 1),
		smoothing: clamp(settings?.smoothing ?? DEFAULT_INK_RENDER_SETTINGS.smoothing, 0, 1),
		easing: normalizeEasing(settings?.easing),
		taperStart: clamp(settings?.taperStart ?? DEFAULT_INK_RENDER_SETTINGS.taperStart, 0, 120),
		taperEnd: clamp(settings?.taperEnd ?? DEFAULT_INK_RENDER_SETTINGS.taperEnd, 0, 120),
		pressureMode: settings?.pressureMode === "stylus" || settings?.pressureMode === "simulate"
			? settings.pressureMode
			: "auto"
	};
}

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

function normalizeEasing(value: unknown): InkEasingMode {
	return value === "ease-in" || value === "ease-out" || value === "ease-in-out" || value === "linear"
		? value
		: DEFAULT_INK_RENDER_SETTINGS.easing;
}

function getEasingFunction(mode: InkEasingMode): (value: number) => number {
	switch (mode) {
		case "ease-in":
			return (value: number) => value * value;
		case "ease-out":
			return (value: number) => 1 - Math.pow(1 - value, 2);
		case "ease-in-out":
			return (value: number) => value < 0.5 ? 2 * value * value : 1 - Math.pow(-2 * value + 2, 2) / 2;
		case "linear":
		default:
			return (value: number) => value;
	}
}

function distanceBetween(first: InkPoint, second: InkPoint): number {
	return Math.hypot(first.x - second.x, first.y - second.y);
}

function getStrokeSampleThreshold(strokeWidthScale?: number, override?: number): number {
	if (override && Number.isFinite(override) && override > 0) {
		return clamp(override, 0.00008, 0.004);
	}
	const widthAwareThreshold = strokeWidthScale && strokeWidthScale > 0 ? strokeWidthScale * 0.08 : 0.00045;
	return clamp(widthAwareThreshold, 0.00012, 0.00065);
}

export function appendStrokePoints<TPoint extends InkPoint, TStroke extends InkStroke & { points: TPoint[] }>(
	stroke: TStroke,
	points: TPoint[],
	options: InkAppendOptions = {}
): boolean {
	let appended = false;
	const pressureGain = stroke.inkSettings?.smoothingMode === "pressure" ? 1 : INK_PRESSURE_GAIN;
	const gentle = stroke.inkSettings?.smoothingMode === "pressure" && stroke.inkSettings.pressureResponse === "gentle";
	const rounded = stroke.inkSettings?.strokeGeometry === "round";
	for (const sample of points) {
		const previousPoint = stroke.points[stroke.points.length - 1];
		if (!Number.isFinite(sample.x) || !Number.isFinite(sample.y) || !Number.isFinite(sample.pressure)) {
			continue;
		}
		if (previousPoint && typeof previousPoint.t === "number" && typeof sample.t === "number" && sample.t < previousPoint.t) {
			continue;
		}
		const threshold = getStrokeSampleThreshold(stroke.widthScale, options.mergeThreshold);
		// Measure from the last fixed anchor as well as the mutable tail. Otherwise
		// a stream of small steps keeps replacing the tail and erases whole curves.
		const anchor = stroke.points[stroke.points.length - 2];
		if (anchor && previousPoint && distanceBetween(anchor, sample) < threshold && distanceBetween(previousPoint, sample) < threshold && !options.forceCommitFinalPoint && (!rounded || Math.abs(previousPoint.pressure - sample.pressure) < .005)) {
			const pressure = rounded ? clamp(sample.pressure, .06, 1) : getNextStrokePressure(previousPoint.pressure, sample.pressure, previousPoint, sample, stroke.widthScale, pressureGain, gentle);
			stroke.points[stroke.points.length - 1] = { ...sample, pressure };
			appended = true;
			continue;
		}
		const pressure = rounded ? clamp(sample.pressure, .06, 1) : previousPoint
			? getNextStrokePressure(previousPoint.pressure, sample.pressure, previousPoint, sample, stroke.widthScale, pressureGain, gentle)
			: clamp(sample.pressure * pressureGain, 0.12, 0.88);
		stroke.points.push({ ...sample, pressure });
		appended = true;
	}
	return appended;
}

function getNextStrokePressure(previousPressure: number, samplePressure: number, previousPoint: InkPoint, sample: InkPoint, strokeWidthScale?: number, pressureGain = INK_PRESSURE_GAIN, gentle = false): number {
	const target = clamp(samplePressure * pressureGain, 0.08, 1);
	const smoothed = previousPressure + ((target - previousPressure) * (gentle ? GENTLE_PRESSURE_SMOOTHING_ALPHA : INK_PRESSURE_SMOOTHING_ALPHA));
	const width = Math.max(strokeWidthScale ?? 0.0025, 0.0008);
	const travel = distanceBetween(previousPoint, sample);
	const maxDelta = gentle
		? clamp(GENTLE_PRESSURE_SLEW_PER_WIDTH * (travel / width), GENTLE_PRESSURE_MIN_STEP, GENTLE_PRESSURE_MAX_STEP)
		: clamp(INK_PRESSURE_SLEW_PER_WIDTH * (travel / width), 0.015, 0.18);
	return clamp(smoothed, Math.max(0.08, previousPressure - maxDelta), Math.min(1, previousPressure + maxDelta));
}

function getStrokeMidpoint(first: InkPoint, second: InkPoint): InkPoint {
	const firstTime = typeof first.t === "number" ? first.t : null;
	const secondTime = typeof second.t === "number" ? second.t : null;
	return {
		x: (first.x + second.x) / 2,
		y: (first.y + second.y) / 2,
		pressure: (first.pressure + second.pressure) / 2,
		t: firstTime !== null && secondTime !== null ? (firstTime + secondTime) / 2 : undefined
	};
}

function interpolateStrokePoint(first: InkPoint, second: InkPoint, ratio: number): InkPoint {
	const firstTime = typeof first.t === "number" ? first.t : null;
	const secondTime = typeof second.t === "number" ? second.t : null;
	return {
		x: first.x + (second.x - first.x) * ratio,
		y: first.y + (second.y - first.y) * ratio,
		pressure: clamp(first.pressure + (second.pressure - first.pressure) * ratio, 0.06, 1),
		t: firstTime !== null && secondTime !== null ? firstTime + (secondTime - firstTime) * ratio : undefined
	};
}

function resampleStrokePoints(points: InkPoint[]): InkPoint[] {
	if (points.length < 2) {
		return points;
	}
	const output: InkPoint[] = [points[0]];
	for (let index = 1; index < points.length; index += 1) {
		const previous = points[index - 1];
		const point = points[index];
		if (typeof previous.t === "number" && typeof point.t === "number" && point.t > previous.t) {
			const deltaMs = point.t - previous.t;
			const steps = Math.min(INK_END_OF_STROKE_MAX_ITERATIONS, Math.floor(deltaMs / INK_OUTPUT_INTERVAL_MS));
			for (let step = 1; step <= steps; step += 1) {
				const targetTime = previous.t + step * INK_OUTPUT_INTERVAL_MS;
				if (targetTime >= point.t) {
					break;
				}
				output.push(interpolateStrokePoint(previous, point, (targetTime - previous.t) / deltaMs));
			}
		}
		output.push(point);
	}
	return output;
}

function getPredictedStrokePoints(points: InkPoint[], predictionStrength = 1): InkPoint[] {
	const strength = clamp(Number.isFinite(predictionStrength) ? predictionStrength : 1, 0, 1);
	if (points.length < 2 || strength === 0) {
		return points;
	}
	const previous = points[points.length - 2];
	const last = points[points.length - 1];
	if (typeof previous.t !== "number" || typeof last.t !== "number" || last.t <= previous.t) {
		return points;
	}
	const deltaMs = last.t - previous.t;
	if (deltaMs > 28 || distanceBetween(previous, last) < 0.0007) {
		return points;
	}
	const predictionMs = INK_PREDICTION_MS * strength;
	const maxPredictionDistance = INK_MAX_PREDICTION_DISTANCE * strength;
	const projectedRatio = predictionMs / Math.max(1, deltaMs);
	const rawX = last.x + (last.x - previous.x) * projectedRatio;
	const rawY = last.y + (last.y - previous.y) * projectedRatio;
	const rawPrediction = {
		x: clamp(rawX, 0, 1),
		y: clamp(rawY, 0, 1),
		pressure: last.pressure,
		t: last.t + predictionMs
	};
	const distance = distanceBetween(last, rawPrediction);
	if (distance <= maxPredictionDistance) {
		return [...points, rawPrediction];
	}
	const limitedRatio = maxPredictionDistance / Math.max(distance, 0.000001);
	return [
		...points,
		{
			x: last.x + (rawPrediction.x - last.x) * limitedRatio,
			y: last.y + (rawPrediction.y - last.y) * limitedRatio,
			pressure: last.pressure,
			t: rawPrediction.t
		}
	];
}

function getPointSpeed(previous: InkPoint, next: InkPoint): number {
	if (typeof previous.t !== "number" || typeof next.t !== "number" || next.t <= previous.t) {
		return 0;
	}
	return distanceBetween(previous, next) / ((next.t - previous.t) / 1000);
}

function getInflectionPreservation(previous: InkPoint, point: InkPoint, next: InkPoint): number {
	const incomingX = point.x - previous.x;
	const incomingY = point.y - previous.y;
	const outgoingX = next.x - point.x;
	const outgoingY = next.y - point.y;
	const incomingLength = Math.hypot(incomingX, incomingY);
	const outgoingLength = Math.hypot(outgoingX, outgoingY);
	if (incomingLength === 0 || outgoingLength === 0) {
		return 1;
	}
	const cosine = ((incomingX * outgoingX) + (incomingY * outgoingY)) / (incomingLength * outgoingLength);
	return cosine < 0.72 ? 0.35 : 1;
}

function getTimedWindowAverage(points: InkPoint[], index: number, stabilization: number): InkPoint {
	const point = points[index];
	const windowMs = INK_MAX_SMOOTHING_WINDOW_MS * stabilization;
	if (typeof point.t !== "number") {
		return point;
	}
	let x = 0;
	let y = 0;
	let pressure = 0;
	let count = 0;
	for (let scan = index; scan >= 0; scan -= 1) {
		const candidate = points[scan];
		if (typeof candidate.t !== "number" || point.t - candidate.t > windowMs) {
			break;
		}
		x += candidate.x;
		y += candidate.y;
		pressure += candidate.pressure;
		count += 1;
	}
	for (let scan = index + 1; scan < points.length; scan += 1) {
		const candidate = points[scan];
		if (typeof candidate.t !== "number" || candidate.t - point.t > windowMs) {
			break;
		}
		x += candidate.x;
		y += candidate.y;
		pressure += candidate.pressure;
		count += 1;
	}
	return count > 0
		? { x: x / count, y: y / count, pressure: clamp(pressure / count, 0.06, 1), t: point.t }
		: point;
}

function getCumulativeStrokeDistances(points: InkPoint[]): number[] {
	const distances = [0];
	for (let index = 1; index < points.length; index += 1) {
		distances[index] = distances[index - 1] + distanceBetween(points[index - 1], points[index]);
	}
	return distances;
}

function getStrokeTaperMultiplier(
	cumulativeDistances: number[],
	pointIndex: number,
	enableTaper: boolean
): number {
	if (!enableTaper || cumulativeDistances.length < 3) {
		return 1;
	}
	const totalLength = cumulativeDistances[cumulativeDistances.length - 1] ?? 0;
	if (totalLength <= 0) {
		return 1;
	}
	const taperLength = clamp(totalLength * 0.1, 0.003, INK_TAPER_MAX_LENGTH);
	const distanceFromStart = cumulativeDistances[pointIndex] ?? 0;
	const distanceFromEnd = totalLength - distanceFromStart;
	const edgeDistance = Math.min(distanceFromStart, distanceFromEnd);
	if (edgeDistance >= taperLength) {
		return 1;
	}
	return clamp(edgeDistance / taperLength, INK_TAPER_MIN_MULTIPLIER, 1);
}

function getVisualPressureMultiplier(pressure: number, usePressure: boolean, settings = activeInkRenderSettings): number {
	if (!usePressure) {
		return 1;
	}
	if (settings.smoothingMode === "pressure") {
		if (settings.thinning === 0) { return 1; }
		const radius = 0.5 - settings.thinning * (0.5 - getResponsiveInkPressure(pressure, settings));
		return Math.max(0.02, 2 * getEasingFunction(settings.easing)(radius));
	}
	return clamp(1 + (clamp(pressure, 0.06, 1) - 0.5) * INK_PRESSURE_WIDTH_VARIATION, 0.9, 1.09);
}

function getSmoothedStrokePoints(points: InkPoint[], stabilization: number): InkPoint[] {
	if (points.length < 3) {
		return points;
	}
	return points.map((point, index) => {
		if (index === 0 || index === points.length - 1) {
			return point;
		}
		const previous = points[index - 1];
		const next = points[index + 1];
		const windowAverage = getTimedWindowAverage(points, index, stabilization);
		if (windowAverage !== point) {
			const speed = getPointSpeed(previous, next);
			const speedBlend = clamp((speed - INK_SPEED_FLOOR) / Math.max(0.001, INK_SPEED_CEILING - INK_SPEED_FLOOR), 0, 1);
			const cornerFactor = getInflectionPreservation(previous, point, next);
			const smoothingWeight = clamp(0.28 * (1 - speedBlend) * cornerFactor, 0.04, 0.28);
			return {
				x: (point.x * (1 - smoothingWeight)) + (windowAverage.x * smoothingWeight),
				y: (point.y * (1 - smoothingWeight)) + (windowAverage.y * smoothingWeight),
				pressure: clamp((point.pressure * 0.72) + (windowAverage.pressure * 0.28), 0.06, 1),
				t: point.t
			};
		}
		return {
			x: (previous.x * 0.18) + (point.x * 0.64) + (next.x * 0.18),
			y: (previous.y * 0.18) + (point.y * 0.64) + (next.y * 0.18),
			pressure: clamp((previous.pressure * 0.2) + (point.pressure * 0.6) + (next.pressure * 0.2), 0.06, 1),
			t: point.t
		};
	});
}

function smoothStrokeCenterline(points: InkPoint[], passes = INK_CENTERLINE_SMOOTHING_PASSES, strength = 1): InkPoint[] {
	if (points.length < 4 || passes <= 0) {
		return points;
	}
	let result = points;
	const inset = 0.25 * strength;
	const retained = 1 - inset;
	for (let pass = 0; pass < passes; pass += 1) {
		const next: InkPoint[] = [result[0]];
		for (let index = 0; index < result.length - 1; index += 1) {
			const current = result[index];
			const following = result[index + 1];
			next.push({
				x: (current.x * retained) + (following.x * inset),
				y: (current.y * retained) + (following.y * inset),
				pressure: clamp((current.pressure * 0.75) + (following.pressure * 0.25), 0.06, 1),
				t: typeof current.t === "number" && typeof following.t === "number" ? current.t + ((following.t - current.t) * 0.25) : current.t
			});
			next.push({
				x: (current.x * inset) + (following.x * retained),
				y: (current.y * inset) + (following.y * retained),
				pressure: clamp((current.pressure * 0.25) + (following.pressure * 0.75), 0.06, 1),
				t: typeof current.t === "number" && typeof following.t === "number" ? current.t + ((following.t - current.t) * 0.75) : following.t
			});
		}
		next.push(result[result.length - 1]);
		result = next;
	}
	return result;
}

function average(first: number, second: number): number {
	return (first + second) / 2;
}

function getResponsiveInkPressure(pressure: number, settings: InkRenderSettings): number {
	if (settings.smoothingMode !== "pressure") { return clamp(pressure, 0.12, 1); }
	const captured = clamp(pressure, 0.06, 1);
	if (settings.pressureResponse === "gentle") {
		// A smooth, bounded response avoids bulbous heads when contact pressure is
		// very light or changes abruptly. Higher smoothing still gives more response.
		const range = settings.easing === "linear" ? 0.12 : 0.06;
		const gain = 0.55 + 0.45 * settings.smoothing;
		return 0.5 + range * Math.tanh((captured - 0.5) * gain / range);
	}
	// Amplify deviations in both directions without shifting the neutral width.
	return clamp(0.5 + (captured - 0.5) * (1 + settings.smoothing), 0.06, 1);
}

function getRenderStrokePoints(points: InkPoint[], predictTail: boolean, predictionStrength = 1, settings = activeInkRenderSettings): InkPoint[] {
	const inputPoints = predictTail ? getPredictedStrokePoints(points, predictionStrength) : points;
	const stabilization = settings.streamline;
	if (stabilization === 0) { return inputPoints; }
	const preparedPoints = getSmoothedStrokePoints(resampleStrokePoints(inputPoints), stabilization);
	return smoothStrokeCenterline(preparedPoints, 1, stabilization);
}

export function getSvgPathFromStroke(outline: number[][], closed = true): string {
	const length = outline.length;
	if (length < 4) {
		return "";
	}
	let first = outline[0];
	let second = outline[1];
	const third = outline[2];
	let result = `M${first[0].toFixed(2)},${first[1].toFixed(2)} Q${second[0].toFixed(2)},${second[1].toFixed(2)} ${average(second[0], third[0]).toFixed(2)},${average(second[1], third[1]).toFixed(2)} T`;
	for (let index = 2; index < length - 1; index += 1) {
		first = outline[index];
		second = outline[index + 1];
		result += `${average(first[0], second[0]).toFixed(2)},${average(first[1], second[1]).toFixed(2)} `;
	}
	if (closed) {
		result += "Z";
	}
	return result;
}

export function getSmoothInkStrokeOutline(
	points: InkPoint[],
	width: number,
	height: number,
	baseWidth: number,
	usePressure: boolean,
	predictTail: boolean,
	options: InkRenderOptions = {}
): InkStrokeOutline | null {
	// The round renderer uses a union of pieces rather than a single capped outline.
	if ((options.inkSettings ?? activeInkRenderSettings).strokeGeometry === "round") { return null; }
	try {
		const renderMode = options.renderMode ?? (predictTail ? "live" : "committed");
		void renderMode;
		const settings = options.inkSettings ?? activeInkRenderSettings;
		const renderPoints = getRenderStrokePoints(points, predictTail, options.predictionStrength, settings);
		if (renderPoints.length < 2) {
			return null;
		}
		if (renderPoints.length < 4 && distanceBetween(renderPoints[0], renderPoints[renderPoints.length - 1]) < INK_MIN_DOT_DISTANCE) {
			return null;
		}
		// Pressure mode is resolved while samples are captured. Rendering the stored
		// pressure directly keeps old strokes stable when the preference changes.
		const effectiveUsePressure = usePressure;
		const easing = getEasingFunction(settings.easing);
		const geometryScale = 1524 / Math.max(1, width);
		const outline = getStroke(
			renderPoints.map((point) => [point.x * width * geometryScale, point.y * height * geometryScale, effectiveUsePressure ? getResponsiveInkPressure(point.pressure, settings) : 0.5]),
			{
				size: Math.max(1, baseWidth * geometryScale),
				thinning: settings.thinning,
				// Pressure response must not remove contour points at direction changes.
				smoothing: settings.smoothingMode === "pressure" ? 0 : settings.smoothing,
				streamline: settings.streamline,
				easing,
				simulatePressure: false,
				last: true,
				start: {
					taper: options.startTaper === undefined ? settings.taperStart : options.startTaper * geometryScale,
					easing,
					cap: options.startCap ?? true
				},
				end: {
					taper: options.endTaper === undefined ? settings.taperEnd : options.endTaper * geometryScale,
					easing,
					cap: options.endCap ?? true
				}
			}
		);
		if (outline.length < 3) {
			return null;
		}
		return outline.map(point => [point[0] / geometryScale, point[1] / geometryScale]);
	} catch (error) {
		console.warn("freedraw-pdf: perfect-freehand outline failed, falling back to canvas stroke", error);
		return null;
	}
}

export function getSmoothInkStrokePath(
	points: InkPoint[],
	width: number,
	height: number,
	baseWidth: number,
	usePressure: boolean,
	predictTail: boolean,
	options: InkRenderOptions = {}
): string | null {
	if ((options.inkSettings ?? activeInkRenderSettings).strokeGeometry === "round") {
		return getRoundedInkPath(getRoundedInkStrokeGeometry(points, width, height, baseWidth, usePressure, predictTail, options));
	}
	const outline = getSmoothInkStrokeOutline(points, width, height, baseWidth, usePressure, predictTail, options);
	if (!outline) {
		return null;
	}
	const pathData = getSvgPathFromStroke(outline);
	return pathData || null;
}

export function getRoundedInkStrokeGeometry(points: InkPoint[], width: number, height: number, baseWidth: number, usePressure: boolean, predictTail = false, options: InkRenderOptions = {}): RoundedInkGeometry {
	const settings = options.inkSettings ?? activeInkRenderSettings;
	if (settings.inkModel === "continuous-v1") {
		// Fit recorded input only. A synthetic tail would alter the preceding
		// curve and its pressure when the Pencil lifts and prediction is removed.
		return buildContinuousInkGeometry(points, width, height, baseWidth, usePressure, settings, options);
	}
	const input = predictTail ? getPredictedStrokePoints(points, options.predictionStrength) : points;
	const stable = settings.streamline > 0 ? getSmoothedStrokePoints(input, settings.streamline) : input;
	// Stabilization may move the path, but must never average away a pressure peak.
	const prepared = stable.map((p, i) => ({ ...p, pressure: input[i].pressure }));
	return buildRoundedInkGeometry(prepared, width, height, baseWidth, usePressure, settings, options);
}

function fillRoundedInkGeometry(context: InkDrawingContext, geometry: RoundedInkGeometry): void {
	context.beginPath();
	for (const piece of geometry.pieces) {
		if (piece.kind === "tube") {
			const { a, b, leftAngle, rightAngle } = piece;
			context.moveTo(a.x + Math.cos(leftAngle) * a.radius, a.y + Math.sin(leftAngle) * a.radius);
			context.lineTo(b.x + Math.cos(leftAngle) * b.radius, b.y + Math.sin(leftAngle) * b.radius);
			if (piece.endCap) context.arc(b.x, b.y, b.radius, leftAngle, rightAngle, true);
			else context.lineTo(b.x + Math.cos(rightAngle) * b.radius, b.y + Math.sin(rightAngle) * b.radius);
			context.lineTo(a.x + Math.cos(rightAngle) * a.radius, a.y + Math.sin(rightAngle) * a.radius);
			if (piece.startCap) context.arc(a.x, a.y, a.radius, rightAngle, leftAngle, true);
		} else if (piece.kind === "polygon") {
			context.moveTo(piece.points[0][0], piece.points[0][1]);
			for (let i = 1; i < piece.points.length; i++) context.lineTo(piece.points[i][0], piece.points[i][1]);
		} else {
			context.moveTo(piece.x + piece.radius, piece.y);
			context.arc(piece.x, piece.y, piece.radius, 0, -Math.PI * 2, true);
		}
		context.closePath();
	}
	context.fill();
}

function getRoundedInkPath(geometry: RoundedInkGeometry): string | null {
	if (!geometry.pieces.length) return null;
	return geometry.pieces.map(piece => piece.kind === "tube" ? (() => {
		const {a,b,leftAngle:l,rightAngle:r,frontArc} = piece;
		const point = (p: typeof a, angle: number) => `${p.x + Math.cos(angle) * p.radius},${p.y + Math.sin(angle) * p.radius}`;
		return `M${point(a,l)} L${point(b,l)} ${piece.endCap ? `A${b.radius},${b.radius} 0 ${frontArc > Math.PI ? 1 : 0} 0` : "L"} ${point(b,r)} L${point(a,r)} ${piece.startCap ? `A${a.radius},${a.radius} 0 ${frontArc < Math.PI ? 1 : 0} 0` : "L"} ${point(a,l)} Z`;
	})() : piece.kind === "polygon"
		? `M${piece.points[0].join(",")} L${piece.points.slice(1).map(p => p.join(",")).join(" ")} Z`
		: `M${piece.x + piece.radius},${piece.y} A${piece.radius},${piece.radius} 0 1 0 ${piece.x - piece.radius},${piece.y} A${piece.radius},${piece.radius} 0 1 0 ${piece.x + piece.radius},${piece.y} Z`).join(" ");
}

export function fillInkStrokeOutline(context: InkDrawingContext, outline: InkStrokeOutline): boolean {
	if (outline.length < 4) {
		return false;
	}
	const first = outline[0];
	const second = outline[1];
	const third = outline[2];
	context.beginPath();
	context.moveTo(first[0], first[1]);
	context.quadraticCurveTo(
		second[0],
		second[1],
		average(second[0], third[0]),
		average(second[1], third[1])
	);
	for (let index = 2; index < outline.length - 1; index += 1) {
		const control = outline[index];
		const next = outline[index + 1];
		context.quadraticCurveTo(
			control[0],
			control[1],
			average(control[0], next[0]),
			average(control[1], next[1])
		);
	}
	context.closePath();
	context.fill();
	return true;
}

function drawUniformSmoothStroke(
	context: InkDrawingContext,
	points: InkPoint[],
	width: number,
	height: number,
	baseWidth: number,
	usePressure: boolean,
	predictTail: boolean,
	renderMode: "live" | "committed",
	predictionStrength = 1,
	settings = activeInkRenderSettings
): boolean {
	void renderMode;
	const renderPoints = getRenderStrokePoints(points, predictTail, predictionStrength, settings);
	if (renderPoints.length < 3) {
		return false;
	}
	const averagePressure = usePressure
		? clamp(renderPoints.reduce((sum, point) => sum + point.pressure, 0) / renderPoints.length, settings.smoothingMode === "pressure" ? 0.06 : 0.28, 1)
		: 1;
	context.lineWidth = Math.max(0.85, baseWidth * getVisualPressureMultiplier(averagePressure, usePressure, settings));
	context.beginPath();
	context.moveTo(renderPoints[0].x * width, renderPoints[0].y * height);
	for (let index = 1; index < renderPoints.length - 1; index += 1) {
		const controlPoint = renderPoints[index];
		const nextAnchor = getStrokeMidpoint(controlPoint, renderPoints[index + 1]);
		context.quadraticCurveTo(
			controlPoint.x * width,
			controlPoint.y * height,
			nextAnchor.x * width,
			nextAnchor.y * height
		);
	}
	const last = renderPoints[renderPoints.length - 1];
	context.lineTo(last.x * width, last.y * height);
	context.stroke();
	return true;
}

export function drawSmoothInkStroke(
	context: InkDrawingContext,
	points: InkPoint[],
	width: number,
	height: number,
	baseWidth: number,
	usePressure: boolean,
	predictTail = false,
	options: InkRenderOptions = {}
): string | null {
	if (points.length === 0) {
		return null;
	}
	if ((options.inkSettings ?? activeInkRenderSettings).strokeGeometry === "round") {
		const geometry = getRoundedInkStrokeGeometry(points, width, height, baseWidth, usePressure, predictTail, options);
		fillRoundedInkGeometry(context, geometry);
		return options.serializePath === false ? null : getRoundedInkPath(geometry);
	}
	const renderMode = options.renderMode ?? (predictTail ? "live" : "committed");
	const settings = options.inkSettings ?? activeInkRenderSettings;
	const outline = getSmoothInkStrokeOutline(points, width, height, baseWidth, usePressure, predictTail, { ...options, renderMode });
	if (outline && fillInkStrokeOutline(context, outline)) {
		return options.serializePath === false ? null : getSvgPathFromStroke(outline) || null;
	}
	if ((renderMode === "live" || predictTail || !usePressure) && drawUniformSmoothStroke(context, points, width, height, baseWidth, usePressure, predictTail, renderMode, options.predictionStrength, options.inkSettings)) {
		return null;
	}
	const renderPoints = getRenderStrokePoints(points, predictTail, options.predictionStrength, options.inkSettings);
	const cumulativeDistances = getCumulativeStrokeDistances(renderPoints);
	const first = renderPoints[0];
	if (renderPoints.length === 1) {
		const pressure = usePressure ? clamp(first.pressure, settings.smoothingMode === "pressure" ? 0.06 : 0.2, 1) : 1;
		context.lineWidth = Math.max(0.85, baseWidth * getVisualPressureMultiplier(pressure, usePressure, settings));
		context.beginPath();
		context.moveTo(first.x * width, first.y * height);
		context.lineTo((first.x + 0.0001) * width, (first.y + 0.0001) * height);
		context.stroke();
		return null;
	}
	if (renderPoints.length === 2) {
		const second = renderPoints[1];
		const pressure = usePressure ? clamp((first.pressure + second.pressure) / 2, settings.smoothingMode === "pressure" ? 0.06 : 0.2, 1) : 1;
		context.lineWidth = Math.max(0.85, baseWidth * getVisualPressureMultiplier(pressure, usePressure, settings));
		context.beginPath();
		context.moveTo(first.x * width, first.y * height);
		context.lineTo(second.x * width, second.y * height);
		context.stroke();
		return null;
	}

	let previousAnchor = first;
	for (let index = 1; index < renderPoints.length - 1; index += 1) {
		const controlPoint = renderPoints[index];
		const nextAnchor = getStrokeMidpoint(controlPoint, renderPoints[index + 1]);
		const pressure = usePressure
			? clamp((previousAnchor.pressure + controlPoint.pressure + nextAnchor.pressure) / 3, settings.smoothingMode === "pressure" ? 0.06 : 0.2, 1)
			: 1;
		const taper = getStrokeTaperMultiplier(cumulativeDistances, index, usePressure);
		context.lineWidth = Math.max(0.85, baseWidth * getVisualPressureMultiplier(pressure, usePressure, settings) * taper);
		context.beginPath();
		context.moveTo(previousAnchor.x * width, previousAnchor.y * height);
		context.quadraticCurveTo(
			controlPoint.x * width,
			controlPoint.y * height,
			nextAnchor.x * width,
			nextAnchor.y * height
		);
		context.stroke();
		previousAnchor = nextAnchor;
	}

	const last = renderPoints[renderPoints.length - 1];
	const pressure = usePressure ? clamp((previousAnchor.pressure + last.pressure) / 2, settings.smoothingMode === "pressure" ? 0.06 : 0.2, 1) : 1;
	const taper = getStrokeTaperMultiplier(cumulativeDistances, renderPoints.length - 1, usePressure);
	context.lineWidth = Math.max(0.85, baseWidth * getVisualPressureMultiplier(pressure, usePressure, settings) * taper);
	context.beginPath();
	context.moveTo(previousAnchor.x * width, previousAnchor.y * height);
	context.lineTo(last.x * width, last.y * height);
	context.stroke();
	return null;
}
