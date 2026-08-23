import { clamp } from "../utils/general";

export interface ZoomPageAnchor {
	pageNumber: number;
	offsetRatio: number;
}

export function isTrackpadPinchWheel(event: { ctrlKey: boolean; metaKey: boolean }): boolean {
	return event.ctrlKey || event.metaKey;
}

export function captureZoomPageAnchor(
	pageNumber: number,
	viewportContentY: number,
	pageTop: number,
	pageHeight: number
): ZoomPageAnchor {
	return {
		pageNumber,
		offsetRatio: clamp((viewportContentY - pageTop) / Math.max(pageHeight, 1), 0, 1)
	};
}

export function resolveZoomPageScrollTop(
	anchor: ZoomPageAnchor,
	pageTop: number,
	pageHeight: number,
	maximumContentY: number
): number {
	return clamp(
		pageTop + (Math.max(pageHeight, 1) * anchor.offsetRatio),
		0,
		Math.max(maximumContentY, 0)
	);
}
