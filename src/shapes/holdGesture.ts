import type { GeometryPoint } from "../annotation/geometry";

export const SHAPE_HOLD_MS = 500;
/** Owns no document state: a hold can only request a preview, never commit/save. */
export class HoldGesture {
	private timer: number | null = null;
	private generation = 0;
	private anchor: GeometryPoint;
	private previewed = false;
	constructor(private clock: Pick<Window, "setTimeout" | "clearTimeout">, point: GeometryPoint,
		private size: { width: number; height: number; tolerance: number }, private onHold: () => boolean | void, private onResume: () => void) {
		this.anchor = point; this.arm();
	}
	private arm(): void {
		const generation = ++this.generation;
		this.timer = this.clock.setTimeout(() => { if (generation !== this.generation) return; this.timer = null; this.previewed = this.onHold() !== false; }, SHAPE_HOLD_MS);
	}
	move(point: GeometryPoint): void {
		// Before fitting, even slow meaningful motion resets the quiet deadline.
		// After fitting, allow a wider jitter radius before reverting to freehand.
		const threshold = this.previewed ? this.size.tolerance : Math.min(2, this.size.tolerance / 2);
		if (Math.hypot((point.x - this.anchor.x) * this.size.width, (point.y - this.anchor.y) * this.size.height) <= threshold) return;
		this.cancelTimer(); this.anchor = point;
		if (this.previewed) { this.previewed = false; this.onResume(); }
		this.arm();
	}
	private cancelTimer(): void { this.generation++; if (this.timer !== null) this.clock.clearTimeout(this.timer); this.timer = null; }
	cancel(): void { this.cancelTimer(); }
}
