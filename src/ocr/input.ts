import { getStrokeBounds } from "../annotation/bounds";
import { renderEmbedStroke } from "../markdown/embedRender";
import type { NormalizedRect, StrokeAnnotation } from "../types";

export function inkBounds(strokes: readonly StrokeAnnotation[]): NormalizedRect {
	if (!strokes.length) throw new Error("Choose handwriting first.");
	const bounds=strokes.map(getStrokeBounds);
	return {left:Math.max(0,Math.min(...bounds.map(b=>b.left))-.01),top:Math.max(0,Math.min(...bounds.map(b=>b.top))-.01),right:Math.min(1,Math.max(...bounds.map(b=>b.right))+.01),bottom:Math.min(1,Math.max(...bounds.map(b=>b.bottom))+.01)};
}
export async function createOcrInput(owner: Window, strokes: readonly StrokeAnnotation[], aspect: number, isCurrent:()=>boolean):Promise<{image:string;box:NormalizedRect}> {
	if(strokes.length>2000 || strokes.reduce((n,s)=>n+s.points.length,0)>300000)throw new Error("This handwriting is too large for one recognition request. Select a smaller area.");
	const box=inkBounds(strokes),w=box.right-box.left,h=(box.bottom-box.top)*aspect;
	const scale=Math.min(1600/Math.max(w,h,.01),Math.sqrt(2*1024*1024/Math.max(w*h,.0001)));
	const canvas=owner.document.createElement("canvas");canvas.width=Math.max(1,Math.ceil(w*scale));canvas.height=Math.max(1,Math.ceil(h*scale));
	try {
		const ctx=canvas.getContext("2d");if(!ctx)throw new Error("Cannot prepare handwriting for recognition.");
		ctx.fillStyle="#ffffff";ctx.fillRect(0,0,canvas.width,canvas.height);ctx.translate(-box.left*scale,-box.top*aspect*scale);
		let start=performance.now();
		for(const stroke of strokes){
			if(!isCurrent())throw new Error("Recognition cancelled.");
			renderEmbedStroke(ctx,stroke,scale,aspect*scale);
			if(performance.now()-start>8){await new Promise<void>(resolve=>owner.setTimeout(resolve,0));start=performance.now();}
		}
		return {image:canvas.toDataURL("image/png"),box};
	} finally { canvas.width=canvas.height=0; }
}
