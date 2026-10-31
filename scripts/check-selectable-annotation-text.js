const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),ts=require('typescript');
const {PDFDocument,degrees}=require('pdf-lib');
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,f);
const {buildPdfWithOverlays}=require('../src/export/preservedPdfWriter.ts');
const {selectableTextRuns}=require('../src/text/selectableRuns.ts');
(async()=>{
 const original=await PDFDocument.create();for(let n=0;n<4;n++){const p=original.addPage([350,460]);p.setCropBox(25,30,300,400);p.setRotation(degrees(n*90));p.drawRectangle({x:75,y:100,width:50,height:50});}
 const source=await original.save(),text='Typed α β 中文 🧪';
 const output=await buildPdfWithOverlays(source,[1,2,3,4],async()=>({pngBytes:null,widthPt:300,heightPt:400,textRuns:[{text,x:.1,y:.2,width:.7,height:.05},{text:'Second line',x:.1,y:.3,width:.5,height:.05}]}));
 const loaded=await PDFDocument.load(output.pdfBytes);assert.equal(loaded.getPageCount(),4);
 const repeated=await buildPdfWithOverlays(output.pdfBytes,[1,2,3,4],async()=>({pngBytes:null,widthPt:300,heightPt:400,textRuns:[{text:'Different Ω',x:.1,y:.5,width:.5,height:.05}]}));
 const repeatedDocument=await PDFDocument.load(repeated.pdfBytes);
 for(const page of repeatedDocument.getPages())assert.equal(page.node.normalizedEntries().Font.keys().length,2,'re-export must retain the earlier selection font/mapping');
 const bytes=Buffer.from(output.pdfBytes);assert.ok(bytes.length>source.length);
 const measure={save(){},restore(){},measureText:s=>({width:Array.from(s).length*10})};
 const item={text:'A B\nC',x:.1,y:.1,fontSize:20,fontScale:.02,boxWidthScale:.5,boxHeightScale:.2,verticalAlign:'top',fontFamily:'Arial',textAlign:'right',wordWrap:false};
 const runs=selectableTextRuns(measure,item,1000,1400);assert.equal(runs.map(r=>r.text).join(''),'A BC');assert.ok(runs[0].x>.5);assert.ok(runs[2].y>runs[0].y);
 if(process.env.FREEDRAW_EXPORT_FIXTURE_DIR){fs.mkdirSync(process.env.FREEDRAW_EXPORT_FIXTURE_DIR,{recursive:true});fs.writeFileSync(path.join(process.env.FREEDRAW_EXPORT_FIXTURE_DIR,'selectable.pdf'),output.pdfBytes);fs.writeFileSync(path.join(process.env.FREEDRAW_EXPORT_FIXTURE_DIR,'selectable-repeated.pdf'),repeated.pdfBytes);fs.writeFileSync(path.join(process.env.FREEDRAW_EXPORT_FIXTURE_DIR,'selectable-original.pdf'),source);}
 console.log('Selectable annotation text passed: Unicode mapping, embedded glyphless font, rotated/cropped pages, aligned multi-line layout.');
})().catch(e=>{console.error(e);process.exitCode=1;});
