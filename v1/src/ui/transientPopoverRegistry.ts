export interface TransientPopoverEnvironment {
	mountBackdrop(onDismiss: () => void): HTMLElement;
	mountPopover(backdrop: HTMLElement, popover: HTMLElement): void;
	listenForEscape(onDismiss: () => void): () => void;
}

export interface TransientPopoverOptions {
	onClose?: () => void;
}

export function createTransientPopoverEnvironment(ownerDocument: Document): TransientPopoverEnvironment {
	const ownerWindow = ownerDocument.defaultView;
	return {
		mountBackdrop: (onDismiss) => {
			const backdrop = ownerDocument.body.createDiv({
				cls: "modal-container pdf-native-annotator-popover-backdrop"
			});
			backdrop.addEventListener("pointerdown", (event) => {
				event.preventDefault();
				event.stopPropagation();
				onDismiss();
			});
			return backdrop;
		},
		mountPopover: (backdrop, popover) => {
			popover.addEventListener("pointerdown", (event) => event.stopPropagation());
			backdrop.appendChild(popover);
		},
		listenForEscape: (onDismiss) => {
			if (!ownerWindow) {
				return () => undefined;
			}
			const handleKeyDown = (event: KeyboardEvent): void => {
				if (event.key !== "Escape") {
					return;
				}
				event.preventDefault();
				event.stopPropagation();
				onDismiss();
			};
			ownerWindow.addEventListener("keydown", handleKeyDown, { capture: true });
			return () => ownerWindow.removeEventListener("keydown", handleKeyDown, { capture: true });
		}
	};
}

export class TransientPopoverRegistry<TKey extends string> {
	private active: { key: TKey; element: HTMLElement; onClose?: () => void } | null = null;
	private backdrop: HTMLElement | null = null;
	private stopListeningForEscape: (() => void) | null = null;

	constructor(private readonly environment: TransientPopoverEnvironment) {}

	open(key: TKey, element: HTMLElement, options: TransientPopoverOptions = {}): void {
		this.closeAll();
		this.ensureMounted();
		this.active = { key, element, onClose: options.onClose };
		this.environment.mountPopover(this.backdrop!, element);
	}

	get(key: TKey): HTMLElement | null {
		return this.active?.key === key ? this.active.element : null;
	}

	hasOpen(): boolean {
		return this.active !== null;
	}

	close(key: TKey): void {
		if (this.active?.key === key) {
			this.closeAll();
		}
	}

	closeAll(): void {
		const closing = this.active;
		this.active = null;
		closing?.element.remove();
		closing?.onClose?.();
		if (!this.active) {
			this.unmountInfrastructure();
		}
	}

	dispose(): void {
		this.closeAll();
	}

	private ensureMounted(): void {
		if (!this.backdrop) {
			this.backdrop = this.environment.mountBackdrop(() => this.closeAll());
		}
		if (!this.stopListeningForEscape) {
			this.stopListeningForEscape = this.environment.listenForEscape(() => this.closeAll());
		}
	}

	private unmountInfrastructure(): void {
		this.backdrop?.remove();
		this.backdrop = null;
		this.stopListeningForEscape?.();
		this.stopListeningForEscape = null;
	}
}
