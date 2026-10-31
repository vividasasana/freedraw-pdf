import type { AnnotationDocument, NormalizedRect, StrokeAnnotation } from "../types";
import { getOcrPageView, getValidOcrGroups, type OcrGroup, type OcrLine } from "./model";

export const OCR_TEXT_LABEL = "Recognised text, read only";
export const OCR_FONT = "Arial";
export interface OcrTextRun {
	text: string; box: NormalizedRect; color: string;
	fontScale: number; baseline: number; horizontalScale: number;
}
type MeasureContext = Pick<CanvasRenderingContext2D, "font" | "measureText">;

/** Choose the dominant source colour within this line, rather than a page-wide default. */
export function ocrLineColor(strokes: readonly StrokeAnnotation[], line: OcrLine): string {
	const colors = new Map<string, number>();
	for (const stroke of strokes) {
		let weight=0;
		for(const point of stroke.points) if(point.x>=line.box.left-.005 && point.x<=line.box.right+.005 && point.y>=line.box.top-.005 && point.y<=line.box.bottom+.005) weight++;
		if(weight) colors.set(stroke.color,(colors.get(stroke.color)??0)+weight);
	}
	return [...colors].sort((a,b)=>b[1]-a[1])[0]?.[0] ?? strokes[0]?.color ?? "#202020";
}

/** Measured glyph bounds are fitted to the same normalised ink box on every surface. */
export function ocrTextRuns(document: AnnotationDocument, page: number, aspect: number, context: MeasureContext, groups: OcrGroup[]=getOcrPageView(document,page).groups): OcrTextRun[] {
	const byId=new Map(document.strokes.filter(s=>s.page===page).map(s=>[s.id,s]));
	const oldFont=context.font;
	context.font=`1000px "${OCR_FONT}", sans-serif`;
	try {
		return groups.flatMap(group=>{
			const strokes=group.strokeIds.map(id=>byId.get(id)).filter((s):s is StrokeAnnotation=>!!s);
			return group.lines.flatMap(line=>{
				const parts=line.text.split(/\r?\n/),color=ocrLineColor(strokes,line);
				return parts.flatMap((text,index)=>{
					if(!text.length)return [];
					const step=(line.box.bottom-line.box.top)/parts.length;
					const box={...line.box,top:line.box.top+index*step,bottom:line.box.top+(index+1)*step};
					const metrics=context.measureText(text);
					const ascent=Math.max(1,metrics.actualBoundingBoxAscent||750),descent=Math.max(0,metrics.actualBoundingBoxDescent||0);
					const fontScale=(box.bottom-box.top)*aspect*1000/(ascent+descent);
					return [{text,box,color,fontScale,baseline:box.top+ascent/1000*fontScale/aspect,horizontalScale:(box.right-box.left)/Math.max(.000001,metrics.width/1000*fontScale)}];
				});
			});
		});
	} finally {context.font=oldFont;}
}

export function renderOcrText(context: CanvasRenderingContext2D, document: AnnotationDocument, page: number, width: number, height: number): void {
	const runs=ocrTextRuns(document,page,height/width,context);
	for(const run of runs){
		context.save();
		context.font=`${run.fontScale*width}px "${OCR_FONT}", sans-serif`;
		context.fillStyle=run.color;context.textAlign="left";context.textBaseline="alphabetic";
		context.translate(run.box.left*width,run.baseline*height);
		context.scale(run.horizontalScale,1);
		context.fillText(run.text,0,0);
		context.restore();
	}
}

export function selectableOcrTextRuns(context: CanvasRenderingContext2D, document: AnnotationDocument, page: number, width: number, height: number) {
	return ocrTextRuns(document,page,height/width,context,getValidOcrGroups(document,page)).map(run=>({text:run.text,x:run.box.left,y:run.box.top,width:run.box.right-run.box.left,height:run.box.bottom-run.box.top}));
}
