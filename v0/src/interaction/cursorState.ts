const SELECT_ACTION_CURSORS = new Set([
	"crosshair",
	"move",
	"grabbing",
	"nwse-resize",
	"ns-resize",
	"nesw-resize",
	"ew-resize"
]);

export function resolveOverlayModeCursor(
	activeTool: string,
	previousTool: string | undefined,
	previousCursor: string,
	defaultCursor: string
): string {
	if (
		activeTool === "select" &&
		previousTool === "select" &&
		SELECT_ACTION_CURSORS.has(previousCursor)
	) {
		return previousCursor;
	}
	return defaultCursor;
}
