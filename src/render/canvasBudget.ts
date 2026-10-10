/** Bound annotation backing stores independently of PDF zoom and CSS page size. */
export function getAnnotationPixelRatio(width: number, height: number, devicePixelRatio: number, mobile: boolean): number {
	const safeWidth = Math.max(1, Number.isFinite(width) ? width : 1);
	const safeHeight = Math.max(1, Number.isFinite(height) ? height : 1);
	const requestedRatio = Math.max(0.1, Number.isFinite(devicePixelRatio) ? devicePixelRatio : 1);
	const maxPixels = (mobile ? 4 : 16) * 1024 * 1024;
	const maxSide = mobile ? 4096 : 8192;
	return Math.min(requestedRatio, maxSide / safeWidth, maxSide / safeHeight, Math.sqrt(maxPixels / (safeWidth * safeHeight)));
}
