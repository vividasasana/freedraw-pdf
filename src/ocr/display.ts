import type { AnnotationDocument, TextAnnotation } from "../types";
import { getOcrPageView, type OcrLine } from "./model";
import { OCR_FONT, OCR_TEXT_LABEL, ocrLineColor, ocrTextRuns } from "./layout";

export function ocrFontScale(line: OcrLine, aspect: number): number {
	const parts=line.text.split("\n"),units=Math.max(1,...parts.map(s=>Array.from(s).reduce((n,c)=>n+(/[\u2e80-\uffff]/.test(c)?1:.58),0)));
	return Math.max(.002,Math.min((line.box.bottom-line.box.top)*aspect*.8/parts.length,(line.box.right-line.box.left)/units));
}
/** Compatibility projection; visible OCR uses the measured layout shared with export. */
export function ocrTextItems(document: AnnotationDocument, page: number, width: number, height: number): TextAnnotation[] {
	const byId=new Map(document.strokes.map(s=>[s.id,s]));
	return getOcrPageView(document,page).groups.flatMap(group=>group.lines.map((line,index)=>({
		id:"ocr-"+group.id+"-"+index,page,text:line.text,x:line.box.left-10/1524,y:line.box.top-6/1524*width/height,
		color:ocrLineColor(group.strokeIds.flatMap(id=>byId.has(id)?[byId.get(id)!]:[]),line),
		fontFamily:OCR_FONT,fontSize:14,fontScale:ocrFontScale(line,height/width),
		boxWidthScale:line.box.right-line.box.left+20/1524,boxHeightScale:line.box.bottom-line.box.top+12/1524*width/height,
		verticalAlign:"top" as const,wordWrap:false,lineSpacing:1.15,createdAt:group.createdAt
	})));
}
const mounted=new WeakMap<HTMLElement,{document:AnnotationDocument;revision:string;aspect:number}>();
/** SVG text stays selectable and uses identical glyph fitting in the viewer and PDF. */
export function syncOcrTextLayer(host: HTMLElement, document: AnnotationDocument, page: number, width: number, height: number, revision?:string): void {
	const aspect=height/Math.max(width,1),cached=mounted.get(host);
	let layer=host.querySelector<HTMLElement>(":scope > .freedraw-pdf-ocr-text-layer");
	if(layer && revision!==undefined && cached?.document===document && cached.revision===revision && Math.abs(cached.aspect-aspect)<.002)return;
	const groups=getOcrPageView(document,page).groups;
	if(!groups.length){layer?.remove();mounted.delete(host);return;}
	const signature=JSON.stringify([groups,aspect]);
	if(layer?.dataset.signature===signature && revision===undefined)return;
	if(!layer){
		layer=host.createDiv({cls:"freedraw-pdf-ocr-text-layer"});
		for(const type of ["pointerdown","pointermove","pointerup","touchstart","touchmove","touchend","dblclick"])layer.addEventListener(type,event=>event.stopPropagation());
	}
	layer.replaceChildren();layer.dataset.signature=signature;
	const owner=host.ownerDocument,context=owner?.createElement("canvas").getContext("2d");
	if(context){
		const svg=owner.createElementNS("http://www.w3.org/2000/svg","svg");
		svg.setAttribute("viewBox","0 0 1000 "+(aspect*1000));
		svg.setAttribute("width","100%");svg.setAttribute("height","100%");
		svg.classList.add("freedraw-pdf-ocr-text-svg");
		for(const run of ocrTextRuns(document,page,aspect,context,groups)){
			const text=owner.createElementNS("http://www.w3.org/2000/svg","text");
			text.classList.add("freedraw-pdf-ocr-selectable");
			for(const [key,value]of Object.entries({x:run.box.left*1000,y:run.baseline*aspect*1000,"font-size":run.fontScale*1000,fill:run.color,textLength:(run.box.right-run.box.left)*1000,lengthAdjust:"spacingAndGlyphs","font-family":OCR_FONT,"aria-label":OCR_TEXT_LABEL,tabindex:0}))text.setAttribute(key,String(value));
			text.textContent=run.text;
			const title=owner.createElementNS("http://www.w3.org/2000/svg","title");title.textContent=OCR_TEXT_LABEL;text.appendChild(title);
			svg.appendChild(text);
		}
		layer.appendChild(svg);
	}else{
		// DOM-less hosts can still expose a transcript without enabling an editor.
		for(const group of groups)for(const line of group.lines)layer.createDiv({cls:"freedraw-pdf-ocr-selectable",text:line.text}).setAttribute("aria-label",OCR_TEXT_LABEL);
	}
	if(revision!==undefined)mounted.set(host,{document,revision,aspect});
}

