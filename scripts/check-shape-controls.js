const assert=require("node:assert/strict"),{loadSource}=require("./load-source");
const {shapeOptionRows}=loadSource("src/ui/shapeOptionsRows.ts"),{normalizeShapeToolOptions}=loadSource("src/shapes/shapeOptions.ts");
let options=normalizeShapeToolOptions(),saved=0;const controls=new Map();
class Control{addOptions(value){this.choices=value;return this}setValue(value){this.value=value;return this}setDisabled(value){this.disabled=value;return this}onChange(fn){this.change=fn;return this}}
class Setting{setName(name){this.name=name;return this}addDropdown(fn){const control=new Control();controls.set(this.name,control);fn(control);return this}}
const rows=shapeOptionRows(()=>options,next=>{options=next;saved++});for(const row of rows)row.render(new Setting());
assert.equal(controls.get("Shape creation").value,"hold");assert.equal(controls.get("Drag shape").disabled,true);
controls.get("Shape creation").change("drag");assert.equal(options.method,"drag");assert.equal(controls.get("Drag shape").disabled,false);
controls.get("Drag shape").change("rectangle");assert.equal(options.shape,"rectangle");assert.equal(controls.get("Shape line style").disabled,true);
controls.get("Shape creation").change("hold");assert.equal(options.shape,"auto");controls.get("Shape creation").change("drag");assert.equal(options.shape,"rectangle");
controls.get("Drag shape").change("line");assert.equal(controls.get("Shape line style").disabled,false);controls.get("Shape line style").change("wavy");
controls.get("Shape creation").change("hold");controls.get("Shape creation").change("drag");assert.equal(options.lineStyle,"wavy");
assert.ok(saved>=8);assert.ok(!rows.some(row=>/regular|sizing|opacity|appearance|grid/i.test(row.name)),"Regular shapes must remain modifier-only; no grid control before 0.13.8");
const reopened=normalizeShapeToolOptions(JSON.parse(JSON.stringify(options)));assert.equal(reopened.method,"drag");assert.equal(reopened.shape,"line");assert.equal(reopened.lineStyle,"wavy");
console.log("Shape controls passed: shared menu/settings rows, remembered method/type/style, contextual disabling, persisted choices and no permanent regular/grid mode.");

