import { getStroke } from "perfect-freehand";
import type { InkEasingMode, InkRenderSettings } from "../types";

export interface InkPoint {
	x: number;
	y: number;
	pressure: number;
	t?: number;
}

export interface InkStroke {
	widthScale?: number;
	points: InkPoint[];
}

export interface InkRenderOptions {
	renderMode?: "live" | "committed";
	predictionStrength?: number;
	startTaper?: number;
	endTaper?: number;
}

export interface InkAppendOptions {
	mergeThreshold?: number;
	forceCommitFinalPoint?: boolean;
}

export type InkStrokeOutline = number[][];

const INK_SMOOTHING_WINDOW_MS = 40;
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

const DEFAULT_INK_RENDER_SETTINGS: InkRenderSettings = {
	thinning: 0.5,
	streamline: 0.5,
	smoothing: 0.5,
	easing: "linear",
	taperStart: 0,
	taperEnd: 0,
	pressureMode: "auto"
};

let activeInkRenderSettings: InkRenderSettings = { ...DEFAULT_INK_RENDER_SETTINGS };

export function setInkRenderSettings(settings: Partial<InkRenderSettings> | null | undefined): void {
	activeInkRenderSettings = {
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
	for (const sample of points) {
		const previousPoint = stroke.points[stroke.points.length - 1];
		const threshold = getStrokeSampleThreshold(stroke.widthScale, options.mergeThreshold);
		if (previousPoint && distanceBetween(previousPoint, sample) < threshold && !options.forceCommitFinalPoint) {
			const pressure = getNextStrokePressure(previousPoint.pressure, sample.pressure, previousPoint, sample, stroke.widthScale);
			stroke.points[stroke.points.length - 1] = { ...sample, pressure };
			appended = true;
			continue;
		}
		const pressure = previousPoint
			? getNextStrokePressure(previousPoint.pressure, sample.pressure, previousPoint, sample, stroke.widthScale)
			: clamp(sample.pressure * INK_PRESSURE_GAIN, 0.12, 0.88);
		if (previousPoint && options.forceCommitFinalPoint) {
			stroke.points[stroke.points.length - 1] = { ...sample, pressure: Math.max(previousPoint.pressure, pressure) };
			appended = true;
			continue;
		}
		stroke.points.push({ ...sample, pressure });
		appended = true;
	}
	return appended;
}

function getNextStrokePressure(previousPressure: number, samplePressure: number, previousPoint: InkPoint, sample: InkPoint, strokeWidthScale?: number): number {
	const target = clamp(samplePressure * INK_PRESSURE_GAIN, 0.08, 1);
	const smoothed = previousPressure + ((target - previousPressure) * INK_PRESSURE_SMOOTHING_ALPHA);
	const width = Math.max(strokeWidthScale ?? 0.0025, 0.0008);
	const travel = distanceBetween(previousPoint, sample);
	const maxDelta = clamp(INK_PRESSURE_SLEW_PER_WIDTH * (travel / width), 0.015, 0.18);
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

function getTimedWindowAverage(points: InkPoint[], index: number): InkPoint {
	const point = points[index];
	if (typeof point.t !== "number") {
		return point;
	}
	let x = 0;
	let y = 0;
	let pressure = 0;
	let count = 0;
	for (let scan = index; scan >= 0; scan -= 1) {
		const candidate = points[scan];
		if (typeof candidate.t !== "number" || point.t - candidate.t > INK_SMOOTHING_WINDOW_MS) {
			break;
		}
		x += candidate.x;
		y += candidate.y;
		pressure += candidate.pressure;
		count += 1;
	}
	for (let scan = index + 1; scan < points.length; scan += 1) {
		const candidate = points[scan];
		if (typeof candidate.t !== "number" || candidate.t - point.t > INK_SMOOTHING_WINDOW_MS) {
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

function getVisualPressureMultiplier(pressure: number, usePressure: boolean): number {
	if (!usePressure) {
		return 1;
	}
	return clamp(1 + (clamp(pressure, 0.06, 1) - 0.5) * INK_PRESSURE_WIDTH_VARIATION, 0.9, 1.09);
}

function getSmoothedStrokePoints(points: InkPoint[]): InkPoint[] {
	if (points.length < 3) {
		return points;
	}
	return points.map((point, index) => {
		if (index === 0 || index === points.length - 1) {
			return point;
		}
		const previous = points[index - 1];
		const next = points[index + 1];
		const windowAverage = getTimedWindowAverage(points, index);
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

function smoothStrokeCenterline(points: InkPoint[], passes = INK_CENTERLINE_SMOOTHING_PASSES): InkPoint[] {
	if (points.length < 4 || passes <= 0) {
		return points;
	}
	let result = points;
	for (let pass = 0; pass < passes; pass += 1) {
		const next: InkPoint[] = [result[0]];
		for (let index = 0; index < result.length - 1; index += 1) {
			const current = result[index];
			const following = result[index + 1];
			next.push({
				x: (current.x * 0.75) + (following.x * 0.25),
				y: (current.y * 0.75) + (following.y * 0.25),
				pressure: clamp((current.pressure * 0.75) + (following.pressure * 0.25), 0.06, 1),
				t: typeof current.t === "number" && typeof following.t === "number" ? current.t + ((following.t - current.t) * 0.25) : current.t
			});
			next.push({
				x: (current.x * 0.25) + (following.x * 0.75),
				y: (current.y * 0.25) + (following.y * 0.75),
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

function getRenderStrokePoints(points: InkPoint[], predictTail: boolean, predictionStrength = 1): InkPoint[] {
	const inputPoints = predictTail ? getPredictedStrokePoints(points, predictionStrength) : points;
	const preparedPoints = getSmoothedStrokePoints(resampleStrokePoints(inputPoints));
	return smoothStrokeCenterline(preparedPoints, 1);
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
	try {
		const renderMode = options.renderMode ?? (predictTail ? "live" : "committed");
		void renderMode;
		const renderPoints = getRenderStrokePoints(points, predictTail, options.predictionStrength);
		if (renderPoints.length < 2) {
			return null;
		}
		if (renderPoints.length < 4 && distanceBetween(renderPoints[0], renderPoints[renderPoints.length - 1]) < INK_MIN_DOT_DISTANCE) {
			return null;
		}
		const settings = activeInkRenderSettings;
		// Pressure mode is resolved while samples are captured. Rendering the stored
		// pressure directly keeps old strokes stable when the preference changes.
		const effectiveUsePressure = usePressure;
		const easing = getEasingFunction(settings.easing);
		const outline = getStroke(
			renderPoints.map((point) => [point.x * width, point.y * height, effectiveUsePressure ? clamp(point.pressure, 0.12, 1) : 0.5]),
			{
				size: Math.max(1, baseWidth),
				thinning: settings.thinning,
				smoothing: settings.smoothing,
				streamline: settings.streamline,
				easing,
				simulatePressure: false,
				last: true,
				start: {
					taper: options.startTaper ?? settings.taperStart,
					easing,
					cap: true
				},
				end: {
					taper: options.endTaper ?? settings.taperEnd,
					easing,
					cap: true
				}
			}
		);
		if (outline.length < 3) {
			return null;
		}
		return outline;
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
	const outline = getSmoothInkStrokeOutline(points, width, height, baseWidth, usePressure, predictTail, options);
	if (!outline) {
		return null;
	}
	const pathData = getSvgPathFromStroke(outline);
	return pathData || null;
}

export function fillInkStrokeOutline(context: CanvasRenderingContext2D, outline: InkStrokeOutline): boolean {
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

function drawFreehandOutlineStroke(
	context: CanvasRenderingContext2D,
	points: InkPoint[],
	width: number,
	height: number,
	baseWidth: number,
	usePressure: boolean,
	predictTail: boolean,
	options: InkRenderOptions = {}
): string | null {
	const outline = getSmoothInkStrokeOutline(points, width, height, baseWidth, usePressure, predictTail, options);
	if (!outline || !fillInkStrokeOutline(context, outline)) {
		return null;
	}
	return getSvgPathFromStroke(outline) || null;
}

function drawUniformSmoothStroke(
	context: CanvasRenderingContext2D,
	points: InkPoint[],
	width: number,
	height: number,
	baseWidth: number,
	usePressure: boolean,
	predictTail: boolean,
	renderMode: "live" | "committed",
	predictionStrength = 1
): boolean {
	void renderMode;
	const renderPoints = getRenderStrokePoints(points, predictTail, predictionStrength);
	if (renderPoints.length < 3) {
		return false;
	}
	const averagePressure = usePressure
		? clamp(renderPoints.reduce((sum, point) => sum + point.pressure, 0) / renderPoints.length, 0.28, 1)
		: 1;
	context.lineWidth = Math.max(0.85, baseWidth * getVisualPressureMultiplier(averagePressure, usePressure));
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
	context: CanvasRenderingContext2D,
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
	const renderMode = options.renderMode ?? (predictTail ? "live" : "committed");
	const pathData = drawFreehandOutlineStroke(context, points, width, height, baseWidth, usePressure, predictTail, { ...options, renderMode });
	if (pathData) {
		return pathData;
	}
	if ((renderMode === "live" || predictTail || !usePressure) && drawUniformSmoothStroke(context, points, width, height, baseWidth, usePressure, predictTail, renderMode, options.predictionStrength)) {
		return null;
	}
	const renderPoints = getRenderStrokePoints(points, predictTail, options.predictionStrength);
	const cumulativeDistances = getCumulativeStrokeDistances(renderPoints);
	const first = renderPoints[0];
	if (renderPoints.length === 1) {
		const pressure = usePressure ? clamp(first.pressure, 0.2, 1) : 1;
		context.lineWidth = Math.max(0.85, baseWidth * getVisualPressureMultiplier(pressure, usePressure));
		context.beginPath();
		context.moveTo(first.x * width, first.y * height);
		context.lineTo((first.x + 0.0001) * width, (first.y + 0.0001) * height);
		context.stroke();
		return null;
	}
	if (renderPoints.length === 2) {
		const second = renderPoints[1];
		const pressure = usePressure ? clamp((first.pressure + second.pressure) / 2, 0.2, 1) : 1;
		context.lineWidth = Math.max(0.85, baseWidth * getVisualPressureMultiplier(pressure, usePressure));
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
			? clamp((previousAnchor.pressure + controlPoint.pressure + nextAnchor.pressure) / 3, 0.2, 1)
			: 1;
		const taper = getStrokeTaperMultiplier(cumulativeDistances, index, usePressure);
		context.lineWidth = Math.max(0.85, baseWidth * getVisualPressureMultiplier(pressure, usePressure) * taper);
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
	const pressure = usePressure ? clamp((previousAnchor.pressure + last.pressure) / 2, 0.2, 1) : 1;
	const taper = getStrokeTaperMultiplier(cumulativeDistances, renderPoints.length - 1, usePressure);
	context.lineWidth = Math.max(0.85, baseWidth * getVisualPressureMultiplier(pressure, usePressure) * taper);
	context.beginPath();
	context.moveTo(previousAnchor.x * width, previousAnchor.y * height);
	context.lineTo(last.x * width, last.y * height);
	context.stroke();
	return null;
}
