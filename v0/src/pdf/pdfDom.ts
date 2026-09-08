import { PAGE_HOST_SELECTORS } from "../config";

export function getOverlayHost(pageEl: HTMLElement): HTMLElement {
	const candidate = pageEl.querySelector<HTMLElement>(PAGE_HOST_SELECTORS);
	if (!candidate) {
		return pageEl;
	}
	if (candidate.instanceOf(HTMLCanvasElement)) {
		return candidate.parentElement?.instanceOf(HTMLElement) ? candidate.parentElement : pageEl;
	}
	return candidate;
}

export function findScrollParent(start: HTMLElement): HTMLElement {
	let current: HTMLElement | null = start;
	while (current) {
		const style = window.getComputedStyle(current);
		const overflowY = style.overflowY;
		if ((overflowY === "auto" || overflowY === "scroll") && current.scrollHeight > current.clientHeight) {
			return current;
		}
		current = current.parentElement;
	}
	return start;
}
