export type AnnotationReorderDirection = "front" | "back" | "forward" | "backward";

export interface OrderedAnnotation {
	id: string;
	zIndex?: number;
}

export type RenderableAnnotation<
	TStroke extends OrderedAnnotation,
	TText extends OrderedAnnotation,
	TShape extends OrderedAnnotation
> =
	| { kind: "stroke"; annotation: TStroke; fallbackOrder: number }
	| { kind: "text"; annotation: TText; fallbackOrder: number }
	| { kind: "shape"; annotation: TShape; fallbackOrder: number };

export function getAnnotationRenderables<
	TStroke extends OrderedAnnotation,
	TText extends OrderedAnnotation,
	TShape extends OrderedAnnotation
>(
	strokes: TStroke[],
	textItems: TText[],
	shapes: TShape[]
): RenderableAnnotation<TStroke, TText, TShape>[] {
	const renderables: RenderableAnnotation<TStroke, TText, TShape>[] = [
		...strokes.map((annotation, index): RenderableAnnotation<TStroke, TText, TShape> => ({ kind: "stroke", annotation, fallbackOrder: index })),
		...textItems.map((annotation, index): RenderableAnnotation<TStroke, TText, TShape> => ({ kind: "text", annotation, fallbackOrder: 100000 + index })),
		...shapes.map((annotation, index): RenderableAnnotation<TStroke, TText, TShape> => ({ kind: "shape", annotation, fallbackOrder: 200000 + index }))
	];
	return renderables.sort((left, right) => getRenderableOrder(left) - getRenderableOrder(right));
}

export function getRenderableOrder(renderable: RenderableAnnotation<OrderedAnnotation, OrderedAnnotation, OrderedAnnotation>): number {
	return renderable.annotation.zIndex ?? renderable.fallbackOrder;
}

export function getRenderableKey(renderable: RenderableAnnotation<OrderedAnnotation, OrderedAnnotation, OrderedAnnotation>): string {
	return `${renderable.kind}:${renderable.annotation.id}`;
}

export function reorderRenderables<
	TStroke extends OrderedAnnotation,
	TText extends OrderedAnnotation,
	TShape extends OrderedAnnotation
>(
	renderables: RenderableAnnotation<TStroke, TText, TShape>[],
	selectedKeys: Set<string>,
	direction: AnnotationReorderDirection
): boolean {
	const ordered = [...renderables];
	const selected = (renderable: RenderableAnnotation<TStroke, TText, TShape>) => selectedKeys.has(getRenderableKey(renderable));
	const selectedRenderables = ordered.filter(selected);
	if (selectedRenderables.length === 0) {
		return false;
	}
	let nextOrder: RenderableAnnotation<TStroke, TText, TShape>[];
	if (direction === "front") {
		nextOrder = [...ordered.filter((renderable) => !selected(renderable)), ...selectedRenderables];
	} else if (direction === "back") {
		nextOrder = [...selectedRenderables, ...ordered.filter((renderable) => !selected(renderable))];
	} else {
		nextOrder = [...ordered];
		if (direction === "forward") {
			for (let index = nextOrder.length - 2; index >= 0; index -= 1) {
				if (selected(nextOrder[index]) && !selected(nextOrder[index + 1])) {
					[nextOrder[index], nextOrder[index + 1]] = [nextOrder[index + 1], nextOrder[index]];
				}
			}
		} else {
			for (let index = 1; index < nextOrder.length; index += 1) {
				if (selected(nextOrder[index]) && !selected(nextOrder[index - 1])) {
					[nextOrder[index - 1], nextOrder[index]] = [nextOrder[index], nextOrder[index - 1]];
				}
			}
		}
	}
	const previousKeys = ordered.map(getRenderableKey).join("|");
	const nextKeys = nextOrder.map(getRenderableKey).join("|");
	if (previousKeys === nextKeys) {
		return false;
	}
	nextOrder.forEach((renderable, index) => {
		renderable.annotation.zIndex = index;
	});
	return true;
}
