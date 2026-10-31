import type { InkToolOptions } from "../types";
import { menuSeparator, type MenuDescriptor } from "./menuDescriptors";

/** Native checked lists, matching the Selection and Eraser menus. */
export function inkToolMenuItems(options: InkToolOptions, onChange: (patch: Partial<InkToolOptions>) => void, onWaveSizes: () => void): MenuDescriptor[] {
	const items: MenuDescriptor[] = [
		{ title: "Freehand", checked: options.mode === "freehand", run: () => onChange({ mode: "freehand" }) },
		{ title: "Straight line", checked: options.mode === "straight", run: () => onChange({ mode: "straight" }) }
	];
	if (options.mode === "straight") {
		items.push(menuSeparator);
		for (const [style, title] of [["solid", "Solid"], ["dashed", "Dashed"], ["dotted", "Dotted"], ["wavy", "Wavy"]] as const) {
			items.push({ title, checked: options.lineStyle === style, run: () => onChange({ lineStyle: style }) });
		}
		if (options.lineStyle === "wavy") items.push(menuSeparator, { title: `Wave size: ${options.waveSize}`, run: onWaveSizes });
	}
	return items;
}

export function inkWaveSizeMenuItems(size: number, onChange: (size: number) => void): MenuDescriptor[] {
	return Array.from({ length: 24 }, (_, index) => {
		const value = (index + 1) / 4;
		return { title: String(value), checked: size === value, run: () => onChange(value) };
	});
}
