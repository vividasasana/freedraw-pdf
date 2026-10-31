import { Setting } from "obsidian";
import { shapeOptionRows } from "./shapeOptionsRows";
import { normalizeShapeToolOptions } from "../shapes/shapeOptions";
import type { ShapeOptions } from "../types";

export function createShapeOptionsPopover(document: Document, initial: ShapeOptions, onChange: (options: ShapeOptions) => void, onClose: () => void): HTMLElement {
 const popover = document.createElement("div");
 popover.className = "modal pdf-native-annotator-shape-popover";
 popover.setAttribute("role", "dialog");
 popover.setAttribute("aria-label", "Shape options");
 let options = normalizeShapeToolOptions(initial);
 new Setting(popover).setName("Shapes").setHeading()
  .addExtraButton(button => button.setIcon("x").setTooltip("Close shape options").onClick(onClose));
 const description = popover.createEl("p", { cls: "setting-item-description" });
 const controls: { setting: Setting; name: string }[] = [];
 const refresh = () => {
  for (const row of controls) row.setting.settingEl.hidden = options.method === "hold" && row.name !== "Shape creation" || row.name === "Shape line style" && options.shape !== "line";
  description.textContent = options.method === "hold" ? "Draw, then hold for half a second. Hold your Drawing modifier for regular shapes." : "Drag to size freely. Hold your Drawing modifier for regular shapes.";
 };
 for (const row of shapeOptionRows(() => options, next => { options = next; onChange(next); refresh(); })) {
  const setting = new Setting(popover); controls.push({ setting, name: row.name }); row.render(setting);
 }
 refresh();
 return popover;
}

