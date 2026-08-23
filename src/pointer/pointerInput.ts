import { calculateVelocity, estimatePressureFromVelocity, getInputMethod, isTabletWebKitTouchDevice } from "../utils/deviceUtils";
import { clamp } from "../utils/general";
import { isShapeTool } from "../tools/toolState";
import type { AnnotationTool, InkInputPolicy, InkPressureMode } from "../types";

export function isInkDrawingTool(tool: AnnotationTool): boolean {
	return tool === "pen" || tool === "highlighter" || tool === "eraser" || isShapeTool(tool);
}

export function shouldIgnoreInkPointerEvent(
	event: PointerEvent,
	tool: AnnotationTool,
	policy: InkInputPolicy = "pen-mouse-stylus-touch"
): boolean {
	if (!isInkDrawingTool(tool)) {
		return false;
	}
	const inputMethod = getInputMethod(event);
	const stylusLike = isStylusLikePointerEvent(event);
	if (inputMethod === "pen" || stylusLike && event.isPrimary !== false) {
		return false;
	}
	if (inputMethod === "mouse") {
		return event.button !== 0;
	}
	if (inputMethod === "touch") {
		return policy === "pen-mouse-only" || event.isPrimary === false;
	}
	if (policy === "allow-touch" && inputMethod === "unknown") {
		return event.isPrimary === false;
	}
	if (policy === "pen-mouse-only" || inputMethod === "unknown" && !stylusLike) {
		return true;
	}
	if (stylusLike) {
		return false;
	}
	return true;
}

export function shouldCaptureInkPointerEvent(
	event: PointerEvent,
	tool: AnnotationTool,
	policy: InkInputPolicy = "pen-mouse-stylus-touch"
): boolean {
	if (!isInkDrawingTool(tool) || shouldIgnoreInkPointerEvent(event, tool, policy)) {
		return false;
	}
	const inputMethod = getInputMethod(event);
	return inputMethod === "pen" || inputMethod === "touch";
}

export function shouldPanInkPointerEvent(
	event: PointerEvent,
	tool: AnnotationTool,
	policy: InkInputPolicy = "pen-mouse-stylus-touch"
): boolean {
	return event.pointerType === "touch" &&
		event.isPrimary !== false &&
		isInkDrawingTool(tool) &&
		policy === "pen-mouse-only" &&
		!isStylusLikePointerEvent(event);
}

export function isStylusLikePointerEvent(event: PointerEvent): boolean {
	if (event.pointerType === "pen") {
		return true;
	}
	if (event.pointerType === "mouse") {
		return false;
	}
	const webkitEvent = event as PointerEvent & {
		altitudeAngle?: number;
		azimuthAngle?: number;
		touchType?: string;
		webkitForce?: number;
		webkitTouchType?: string;
	};
	if (webkitEvent.touchType === "stylus" || webkitEvent.webkitTouchType === "stylus") {
		return true;
	}
	const compactContact =
		Number.isFinite(event.width) && event.width > 0 && event.width <= 8 &&
		Number.isFinite(event.height) && event.height > 0 && event.height <= 8;
	if (
		typeof webkitEvent.altitudeAngle === "number" &&
		Number.isFinite(webkitEvent.altitudeAngle) &&
		webkitEvent.altitudeAngle > 0 &&
		webkitEvent.altitudeAngle < Math.PI / 2 - 0.01 ||
		typeof webkitEvent.azimuthAngle === "number" &&
		Number.isFinite(webkitEvent.azimuthAngle) &&
		Math.abs(webkitEvent.azimuthAngle) > 0.01
	) {
		return true;
	}
	const webkitForce = webkitEvent.webkitForce;
	if (compactContact && typeof webkitForce === "number" && webkitForce > 0.01) {
		return true;
	}
	const tiltX = (event as PointerEvent & { tiltX?: number }).tiltX;
	const tiltY = (event as PointerEvent & { tiltY?: number }).tiltY;
	if ((typeof tiltX === "number" && tiltX !== 0) || (typeof tiltY === "number" && tiltY !== 0)) {
		return true;
	}
	return compactContact &&
		typeof event.pressure === "number" &&
		event.pressure > 0.01 &&
		event.pressure !== 0.5;
}

export function isWebKitStylusTouch(touch: {
	altitudeAngle?: number;
	azimuthAngle?: number;
	force?: number;
	radiusX?: number;
	radiusY?: number;
	touchType?: string;
}): boolean {
	if (touch.touchType === "stylus") {
		return true;
	}
	const compactContact =
		typeof touch.radiusX === "number" && touch.radiusX > 0 && touch.radiusX <= 4 &&
		typeof touch.radiusY === "number" && touch.radiusY > 0 && touch.radiusY <= 4;
	const angledStylus =
		typeof touch.altitudeAngle === "number" &&
		Number.isFinite(touch.altitudeAngle) &&
		touch.altitudeAngle > 0 &&
		touch.altitudeAngle < Math.PI / 2 - 0.01;
	const directedStylus =
		typeof touch.azimuthAngle === "number" &&
		Number.isFinite(touch.azimuthAngle) &&
		Math.abs(touch.azimuthAngle) > 0.01;
	return angledStylus || directedStylus || compactContact && typeof touch.force === "number" && touch.force > 0.01;
}

export function getCoalescedPointerEvents(event: PointerEvent): PointerEvent[] {
	if ((event.pointerType === "touch" || event.pointerType === "pen") && typeof event.getCoalescedEvents === "function") {
		const samples = event.getCoalescedEvents();
		if (samples.length > 0) {
			const last = samples[samples.length - 1];
			if (last.clientX !== event.clientX || last.clientY !== event.clientY || last.timeStamp !== event.timeStamp) {
				return [...samples, event];
			}
			return samples;
		}
	}
	return [event];
}

export function resolvePointerPressure(
	event: PointerEvent,
	lastPoint: { clientX: number; clientY: number } | null,
	lastPointTime: number,
	pressureMode: InkPressureMode = "auto",
	forceStylus = false
): number {
	const inputMethod = getInputMethod(event);
	const useReportedPressure = pressureMode !== "simulate" &&
		(forceStylus || inputMethod === "pen" || isStylusLikePointerEvent(event));
	if (useReportedPressure) {
		if (event.pressure > 0) {
			return clamp(event.pressure, 0.06, 1);
		}
		const webkitForce = (event as PointerEvent & { webkitForce?: number }).webkitForce;
		if (typeof webkitForce === "number" && webkitForce > 0) {
			return clamp(webkitForce, 0.06, 1);
		}
	}
	if (pressureMode === "stylus") {
		return 0.5;
	}

	if (pressureMode === "auto" && inputMethod === "touch") {
		const webkitForce = (event as PointerEvent & { webkitForce?: number }).webkitForce;
		if (typeof webkitForce === "number" && webkitForce > 0) {
			return clamp(webkitForce, 0.18, 1);
		}
	}

	if (lastPoint && event.timeStamp > lastPointTime) {
		const deltaTimeMs = Math.max(1, event.timeStamp - lastPointTime);
		const velocity = calculateVelocity(
			lastPoint.clientX,
			lastPoint.clientY,
			event.clientX,
			event.clientY,
			deltaTimeMs
		);
		return clamp(estimatePressureFromVelocity(velocity, 0), 0.2, 1);
	}

	return inputMethod === "touch" && isTabletWebKitTouchDevice() ? 0.42 : 0.5;
}
