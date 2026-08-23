/**
 * Device and pointer detection utilities for tablet-class WebViews and active stylus input.
 */

export function isMobileWebKitTouchDevice(): boolean {
	return typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)")?.matches === true;
}

export function isTabletWebKitTouchDevice(): boolean {
	return typeof window !== "undefined" &&
		window.matchMedia?.("(pointer: coarse)")?.matches === true &&
		window.matchMedia?.("(hover: none)")?.matches === true;
}

export function isTabletStylusPlatform(): boolean {
	return isMobileWebKitTouchDevice() || isTabletWebKitTouchDevice();
}

export type InputMethod = "pen" | "touch" | "mouse" | "unknown";

/**
 * Detect input method from a PointerEvent
 * 
 * @param event - PointerEvent to check
 * @returns The detected input method
 */
export function getInputMethod(event: PointerEvent): InputMethod {
	// pointerType can be "pen", "touch", or "mouse"
	const type = event.pointerType?.toLowerCase();
	
	if (type === "pen") return "pen";
	if (type === "touch") return "touch";
	if (type === "mouse") return "mouse";
	
	// Fallback detection
	if (event.isPrimary && event.pointerType === "touch") return "touch";
	if (event.pointerType === "mouse") return "mouse";
	
	return "unknown";
}

/**
 * Check if the event is from an active stylus on a tablet-class WebView.
 * 
 * @param event - PointerEvent to check
 * @returns True if this appears to be a tablet stylus event
 */
export function isTabletStylusEvent(event: PointerEvent): boolean {
	return isTabletStylusPlatform() && event.pointerType === "pen";
}

/**
 * Estimate pressure from pointer velocity when native pressure is unavailable
 * 
 * This provides a fallback for devices/inputs that don't support pressure:
 * - Slower movement = more pressure (darker, thicker strokes)
 * - Faster movement = less pressure (lighter, thinner strokes)
 * 
 * @param velocityX - Velocity in X direction
 * @param velocityY - Velocity in Y direction
 * @returns Estimated pressure value between 0.2 and 1
 */
export function estimatePressureFromVelocity(velocityX: number, velocityY: number): number {
	// Calculate velocity magnitude
	const velocity = Math.sqrt(velocityX * velocityX + velocityY * velocityY);
	
	// Map velocity to pressure: higher velocity = lower pressure
	// Using exponential decay with tuned constants
	// typical drawing velocity is ~50-300 pixels/sec at canvas scale
	const normalizedVelocity = Math.min(velocity / 0.8, 1); // velocity is px/ms, so 0.8 ~= 800 px/s
	
	// Inverse mapping: faster = lighter (less pressure)
	// Using curve that feels natural for hand-drawn strokes
	const pressure = Math.pow(1 - normalizedVelocity, 1.5);
	
	// Clamp between min and max for stroke visibility
	return Math.max(0.2, Math.min(1, pressure));
}

/**
 * Calculate velocity between two points with timestamps
 * 
 * @param prevX - Previous X coordinate
 * @param prevY - Previous Y coordinate
 * @param currX - Current X coordinate
 * @param currY - Current Y coordinate
 * @param deltaTimeMs - Time elapsed in milliseconds
 * @returns Velocity in pixels per millisecond
 */
export function calculateVelocity(
	prevX: number,
	prevY: number,
	currX: number,
	currY: number,
	deltaTimeMs: number
): number {
	if (deltaTimeMs <= 0) return 0;
	
	const dx = currX - prevX;
	const dy = currY - prevY;
	const distance = Math.sqrt(dx * dx + dy * dy);
	
	return distance / deltaTimeMs;
}

export const DeviceInfo = {
	isMobileWebKitTouchDevice,
	isTabletWebKitTouchDevice,
	isTabletStylusPlatform,
	getInputMethod,
	isTabletStylusEvent,
	estimatePressureFromVelocity,
	calculateVelocity
};
