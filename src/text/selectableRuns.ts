import type { TextAnnotation } from "../types";
import { applyCanvasTextStyle,getRenderedTextFontSize,getRenderedTextLayoutMetrics,getCanvasTextLines,getTextBlockHeight,getTextBlockTop,resolveTextAlignment,resolveTextLineSpacing,resolveTextVerticalAlignment,resolveTextWordWrap,TEXT_LAYOUT_REFERENCE_WIDTH } from "./textLayout";

export interface SelectableTextRun { text:string; x:number; y:number; width:number; height:number; }
/** Same wrapping, padding, alignment and line spacing as the canvas text renderer. */
export function selectableTextRuns(context:CanvasRenderingContext2D,item:TextAnnotation,width:number,height:number):SelectableTextRun[] {
	const fontSize=getRenderedTextFontSize(item.fontScale && item.fontScale>0?item.fontScale:item.fontSize/TEXT_LAYOUT_REFERENCE_WIDTH,width);
	const metrics=getRenderedTextLayoutMetrics(width),boxWidth=item.boxWidthScale&&item.boxWidthScale>0?item.boxWidthScale*width:width*.48;
	const inner=Math.max(metrics.minimumInnerWidth,boxWidth-2*metrics.paddingX),spacing=resolveTextLineSpacing(item);
	context.save();applyCanvasTextStyle(context,item,fontSize,item.fontFamily??"Arial");
	try {
		const lines=getCanvasTextLines(context,item.text,inner,resolveTextWordWrap(item));
		const boxHeight=item.boxHeightScale&&item.boxHeightScale>0?item.boxHeightScale*height:2*metrics.paddingY+getTextBlockHeight(fontSize,lines.length,spacing)+metrics.boxExtraHeight;
		const top=getTextBlockTop(item.y*height,boxHeight,fontSize,lines.length,resolveTextVerticalAlignment(item),spacing,metrics.paddingY),alignment=resolveTextAlignment(item);
		const runs:SelectableTextRun[]=[];
		lines.forEach((line,index)=>{
			const lineWidth=context.measureText(line).width;
			const left=item.x*width+metrics.paddingX+(alignment==="center"?(inner-lineWidth)/2:alignment==="right"?inner-lineWidth:0);
			let prefix="";
			for(const token of line.match(/\S+\s*|\s+/g)??[]){
				const start=context.measureText(prefix).width;prefix+=token;
				runs.push({text:token,x:(left+start)/width,y:(top+index*fontSize*spacing)/height,width:Math.max(.01,context.measureText(prefix).width-start)/width,height:fontSize/height});
			}
		});return runs;
	} finally { context.restore(); }
}
