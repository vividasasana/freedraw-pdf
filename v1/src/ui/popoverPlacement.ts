export interface PopoverPlacementRect {
	left: number;
	top: number;
	right: number;
	bottom: number;
	width: number;
	height: number;
}

export interface PopoverViewportBounds {
	left: number;
	top: number;
	right: number;
	bottom: number;
}

export interface AnchoredPopoverPlacement {
	left: number;
	top: number;
	maxHeight: number;
	side: "above" | "below";
}

function clampPlacement(value: number, minimum: number, maximum: number): number {
	return Math.min(Math.max(value, minimum), maximum);
}

export function resolveAnchoredPopoverPlacement(
	anchor: PopoverPlacementRect,
	popover: { width: number; height: number },
	viewport: PopoverViewportBounds,
	mode: "center" | "left" = "center",
	margin = 12,
	gap = 10
): AnchoredPopoverPlacement {
	const minimumLeft = viewport.left + margin;
	const maximumLeft = Math.max(minimumLeft, viewport.right - popover.width - margin);
	const desiredLeft = mode === "left"
		? anchor.left
		: anchor.left + (anchor.width / 2) - (popover.width / 2);
	const left = clampPlacement(desiredLeft, minimumLeft, maximumLeft);

	const belowTop = anchor.bottom + gap;
	const aboveBottom = anchor.top - gap;
	const availableBelow = Math.max(0, viewport.bottom - margin - belowTop);
	const availableAbove = Math.max(0, aboveBottom - (viewport.top + margin));
	const fitsBelow = popover.height <= availableBelow;
	const fitsAbove = popover.height <= availableAbove;
	const side: "above" | "below" = fitsBelow || (!fitsAbove && availableBelow >= availableAbove)
		? "below"
		: "above";
	const maxHeight = side === "below" ? availableBelow : availableAbove;
	const renderedHeight = Math.min(popover.height, maxHeight);
	const top = side === "below" ? belowTop : aboveBottom - renderedHeight;

	return { left, top, maxHeight, side };
}
