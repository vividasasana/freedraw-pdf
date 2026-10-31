import { type DropdownComponent, type Setting } from "obsidian";
import { normalizeShapeToolOptions } from "../shapes/shapeOptions";
import type { ShapeOptions } from "../types";

export interface ShapeOptionRow { name: string; render: (setting: Setting) => void; }
export function shapeOptionRows(getOptions: () => ShapeOptions | undefined, onChange: (options: ShapeOptions) => void): ShapeOptionRow[] {
 let methodControl: DropdownComponent | undefined, shapeControl: DropdownComponent | undefined, lineControl: DropdownComponent | undefined;
 const read = () => normalizeShapeToolOptions(getOptions());
 const refresh = () => {
  const options = read();
  methodControl?.setValue(options.method);
  shapeControl?.setValue(options.dragShape ?? "line").setDisabled(options.method !== "drag");
  lineControl?.setValue(options.lineStyle).setDisabled(options.method !== "drag" || options.shape !== "line");
 };
 const update = (patch: Partial<ShapeOptions>) => { onChange(normalizeShapeToolOptions({ ...read(), ...patch })); refresh(); };
 return [
  { name: "Shape creation", render: setting => {
   setting.setName("Shape creation").addDropdown(dropdown => {
    methodControl = dropdown;
    dropdown.addOptions({ hold: "Draw and hold", drag: "Drag to size" }).onChange(value => update({ method: value === "drag" ? "drag" : "hold" }));
   }); refresh();
  }},
  { name: "Drag shape", render: setting => {
   setting.setName("Drag shape").addDropdown(dropdown => {
    shapeControl = dropdown;
    dropdown.addOptions({ line: "Line", rectangle: "Rectangle", ellipse: "Ellipse", triangle: "Triangle" }).onChange(value => update({ shape: value as ShapeOptions["shape"] }));
   }); refresh();
  }},
  { name: "Shape line style", render: setting => {
   setting.setName("Shape line style").addDropdown(dropdown => {
    lineControl = dropdown;
    dropdown.addOptions({ solid: "Solid", dashed: "Dashed", dotted: "Dotted", wavy: "Wavy" }).onChange(value => update({ lineStyle: value as ShapeOptions["lineStyle"] }));
   }); refresh();
  }}
 ];
}

