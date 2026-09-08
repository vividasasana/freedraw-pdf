export interface CooperativeRenderStep {
	run: () => void;
	expensive: boolean;
}

export interface CooperativeRenderSliceOptions {
	budgetMs: number;
	now: () => number;
	isInputPending: () => boolean;
}

export interface CooperativeRenderSliceResult {
	nextStep: number;
	inputPending: boolean;
}

export function prioritizeRenderPages(
	pageNumbers: Iterable<number>,
	currentPage: number,
	pointerPage: number | null
): number[] {
	const uniquePages = Array.from(new Set(pageNumbers));
	return uniquePages.sort((left, right) => {
		const getPriority = (pageNumber: number): number => {
			if (pointerPage !== null && pageNumber === pointerPage) {
				return -1;
			}
			if (pageNumber === currentPage) {
				return 0;
			}
			return Math.abs(pageNumber - currentPage) + 1;
		};
		return getPriority(left) - getPriority(right) || left - right;
	});
}

export function runCooperativeRenderSlice(
	steps: CooperativeRenderStep[],
	startStep: number,
	options: CooperativeRenderSliceOptions
): CooperativeRenderSliceResult {
	const deadline = options.now() + Math.max(1, options.budgetMs);
	let nextStep = startStep;

	while (nextStep < steps.length) {
		if (options.isInputPending()) {
			return { nextStep, inputPending: true };
		}

		const step = steps[nextStep];
		step.run();
		nextStep += 1;

		if (options.now() >= deadline) {
			break;
		}
	}

	return { nextStep, inputPending: false };
}
