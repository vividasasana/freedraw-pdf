import type { Menu } from "obsidian";

export interface MenuItemDescriptor {
	type?: "item";
	title: string;
	icon?: string;
	checked?: boolean;
	disabled?: boolean;
	warning?: boolean;
	run?: (event: MouseEvent | KeyboardEvent) => unknown;
}

export interface MenuSeparatorDescriptor {
	type: "separator";
}

export type MenuDescriptor = MenuItemDescriptor | MenuSeparatorDescriptor;

export const menuSeparator: MenuSeparatorDescriptor = { type: "separator" };

export function addMenuDescriptors(menu: Menu, descriptors: readonly MenuDescriptor[]): void {
	for (const descriptor of descriptors) {
		if (descriptor.type === "separator") {
			menu.addSeparator();
			continue;
		}
		menu.addItem((item) => {
			item.setTitle(descriptor.title);
			if (descriptor.icon) {
				item.setIcon(descriptor.icon);
			}
			if (descriptor.checked !== undefined) {
				item.setChecked(descriptor.checked);
			}
			if (descriptor.disabled !== undefined) {
				item.setDisabled(descriptor.disabled);
			}
			if (descriptor.warning !== undefined) {
				item.setWarning(descriptor.warning);
			}
			if (descriptor.run) {
				item.onClick((event) => void descriptor.run?.(event));
			}
		});
	}
}
