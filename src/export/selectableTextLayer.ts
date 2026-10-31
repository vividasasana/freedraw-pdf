import type { PDFDocument,PDFPage,PDFDict,PDFRef } from "pdf-lib";
import type { PdfDisplayBox } from "./preservedPdfWriter";
import type { SelectableTextRun } from "../text/selectableRuns";
import { SELECTABLE_FONT_BYTES } from "./selectableFont";

/** Invisible real PDF text over the visually exact canvas text. No font substitution
 * is visible. Unique CIDs + ToUnicode support arbitrary Unicode independently of
 * the glyphless font, which is embedded rather than relying on a viewer font. */
export class SelectableTextLayer {
	private readonly characters=new Map<string,number>();
	private font:PDFDict|null=null;
	private ref:PDFRef|null=null;
	constructor(private readonly document:PDFDocument){}
	async add(page:PDFPage,runs:readonly SelectableTextRun[],box:PdfDisplayBox|null):Promise<void> {
		if(!runs.length)return;
		const lib=await import("pdf-lib"),ctx=this.document.context;
		if(!this.font){
			const file=ctx.register(ctx.flateStream(SELECTABLE_FONT_BYTES,{Length1:SELECTABLE_FONT_BYTES.length}));
			const descriptor=ctx.register(ctx.obj({Type:"FontDescriptor",FontName:"FreedrawSelectable",Flags:4,FontBBox:[0,0,1000,1000],ItalicAngle:0,Ascent:1000,Descent:0,CapHeight:1000,StemV:80,FontFile2:file}));
			const cid=ctx.register(ctx.obj({Type:"Font",Subtype:"CIDFontType2",BaseFont:"FreedrawSelectable",CIDSystemInfo:{Registry:lib.PDFString.of("Adobe"),Ordering:lib.PDFString.of("Identity"),Supplement:0},FontDescriptor:descriptor,DW:1000}));
			this.font=ctx.obj({Type:"Font",Subtype:"Type0",BaseFont:"FreedrawSelectable",Encoding:"Identity-H",DescendantFonts:[cid]});this.ref=ctx.register(this.font);
		}
		// A source PDF may already contain an earlier export's selection font.
		// Never overwrite its resource name / Unicode mapping when exporting again.
		const name=page.node.newFontDictionary("FreedrawSelectable",this.ref!);
		const crop=box??{x:0,y:0,width:page.getWidth(),height:page.getHeight(),rotation:0};
		const sideways=crop.rotation===90||crop.rotation===270,w=sideways?crop.height:crop.width,h=sideways?crop.width:crop.height;
		for(const run of runs){
			if(!run.text||![run.x,run.y,run.width,run.height].every(Number.isFinite)||run.width<=0||run.height<=0)continue;
			const characters=Array.from(run.text),hex=characters.map(character=>{
				let code=this.characters.get(character);if(!code){code=this.characters.size+1;if(code>65534)throw new Error("Too many unique characters for the PDF text layer.");this.characters.set(character,code);}return code.toString(16).padStart(4,"0");
			}).join("");
			const x=run.x*w,y=(1-run.y-run.height)*h,sx=run.width*w/characters.length,sy=run.height*h;
			const matrix=crop.rotation===90?[0,sx,-sy,0,crop.x+crop.width-y,crop.y+x]:crop.rotation===180?[-sx,0,0,-sy,crop.x+crop.width-x,crop.y+crop.height-y]:crop.rotation===270?[0,-sx,sy,0,crop.x+y,crop.y+crop.height-x]:[sx,0,0,sy,crop.x+x,crop.y+y];
			page.pushOperators(lib.pushGraphicsState(),lib.beginText(),lib.setFontAndSize(name,1),lib.setTextRenderingMode(lib.TextRenderingMode.Invisible),lib.setTextMatrix(matrix[0],matrix[1],matrix[2],matrix[3],matrix[4],matrix[5]),lib.showText(lib.PDFHexString.of(hex)),lib.endText(),lib.popGraphicsState());
		}
	}
	async finish():Promise<void> {
		if(!this.font)return;
		const {PDFName,PDFArray,PDFDict}=await import("pdf-lib"),ctx=this.document.context;
		const entries=[...this.characters].map(([character,id])=>`<${id.toString(16).padStart(4,"0")}> <${Array.from({length:character.length},(_,i)=>character.charCodeAt(i).toString(16).padStart(4,"0")).join("")}>`);
		let cmap="/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /FreedrawUnicode def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n";
		for(let i=0;i<entries.length;i+=100){const block=entries.slice(i,i+100);cmap+=`${block.length} beginbfchar\n${block.join("\n")}\nendbfchar\n`;}
		cmap+="endcmap\nCMapName currentdict /CMap defineresource pop\nend\nend";
		this.font.set(PDFName.of("ToUnicode"),ctx.register(ctx.flateStream(cmap)));
		const descendant=this.font.lookup(PDFName.of("DescendantFonts"),PDFArray).lookup(0,PDFDict);
		descendant.set(PDFName.of("CIDToGIDMap"),ctx.register(ctx.flateStream(new Uint8Array((this.characters.size+1)*2))));
	}
}
