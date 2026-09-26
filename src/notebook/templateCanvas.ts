import { getNotebookPageSizeDimensions } from "./pageModel";
import { PAPER_TEMPLATE_DOT_COLOR, PAPER_TEMPLATE_GRID_COLOR, PAPER_TEMPLATE_LINE_COLOR, getPaperTemplateMetrics } from "./paperTemplates";
import type { NotebookPage } from "../types";

export function drawTemplatePageBackground(context: CanvasRenderingContext2D, width: number, height: number, page: NotebookPage): void {
	context.save();
	context.fillStyle = page.paperColor || "#fffdf7";
	context.fillRect(0, 0, width, height);
	const metrics = getPaperTemplateMetrics(width);
	context.lineWidth = Math.max(1, width / getNotebookPageSizeDimensions("a4").width);
	if (page.template === "ruled") {
		const step = Math.max(4, metrics.ruledStep);
		const start = Math.max(8, metrics.ruledOffset);
		context.strokeStyle = PAPER_TEMPLATE_LINE_COLOR;
		for (let y = start; y < height; y += step) {
			context.beginPath();
			context.moveTo(0, y);
			context.lineTo(width, y);
			context.stroke();
		}
	} else if (page.template === "grid") {
		const step = Math.max(3, metrics.graphStep);
		context.strokeStyle = PAPER_TEMPLATE_GRID_COLOR;
		for (let x = 0; x < width; x += step) {
			context.beginPath();
			context.moveTo(x, 0);
			context.lineTo(x, height);
			context.stroke();
		}
		for (let y = 0; y < height; y += step) {
			context.beginPath();
			context.moveTo(0, y);
			context.lineTo(width, y);
			context.stroke();
		}
	} else if (page.template === "dot") {
		const step = Math.max(3, metrics.dotStep);
		context.fillStyle = PAPER_TEMPLATE_DOT_COLOR;
		for (let x = step / 2; x < width; x += step) {
			for (let y = step / 2; y < height; y += step) {
				context.beginPath();
				context.arc(x, y, metrics.dotRadius, 0, Math.PI * 2);
				context.fill();
			}
		}
	}
	context.restore();
}

export function createTemplatePageBackgroundDataUrl(width: number, height: number, page: NotebookPage): string | null {
	const safeWidth = Math.max(1, Math.round(width));
	const safeHeight = Math.max(1, Math.round(height));
	const canvas = createEl("canvas");
	canvas.width = safeWidth;
	canvas.height = safeHeight;
	const context = canvas.getContext("2d");
	if (!context) {
		return null;
	}
	drawTemplatePageBackground(context, safeWidth, safeHeight, page);
	return canvas.toDataURL("image/png");
}
