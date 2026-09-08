const A4_WIDTH_MM = 210;
const GRAPH_SPACING_MM = 5;
const RULED_SPACING_MM = 7.1;
const RULED_TOP_MARGIN_MM = 17.5;
const DOT_SPACING_MM = 5;

export interface PaperTemplateMetrics {
	graphStep: number;
	ruledStep: number;
	ruledOffset: number;
	dotStep: number;
	dotRadius: number;
}

export const PAPER_TEMPLATE_LINE_COLOR = "rgba(86, 112, 148, 0.18)";
export const PAPER_TEMPLATE_GRID_COLOR = "rgba(86, 112, 148, 0.14)";
export const PAPER_TEMPLATE_DOT_COLOR = "rgba(86, 112, 148, 0.28)";

export function getPaperTemplateMetrics(pageWidthPx: number): PaperTemplateMetrics {
	const pxPerMm = Math.max(1, pageWidthPx) / A4_WIDTH_MM;
	const graphStep = GRAPH_SPACING_MM * pxPerMm;
	const ruledStep = RULED_SPACING_MM * pxPerMm;
	const dotStep = DOT_SPACING_MM * pxPerMm;
	return {
		graphStep,
		ruledStep,
		ruledOffset: RULED_TOP_MARGIN_MM * pxPerMm,
		dotStep,
		dotRadius: Math.max(0.65, dotStep * 0.052)
	};
}
