export interface PageRetainedCost { nodes: number; bytes: number; }

interface WarmPage { cost: PageRetainedCost; leftViewportAt: number; }

/** Only offscreen pages are counted here. Visible/input pages are protected by the caller. */
export class PageResidencyCache {
	private readonly pages = new Map<number, WarmPage>();
	constructor(readonly maxBytes = 32 * 1024 * 1024, readonly maxNodes = 6000,
		readonly maxPages = 3, readonly lifetimeMs = 12000) {}

	has(page: number): boolean { return this.pages.has(page); }
	retain(page: number, cost: PageRetainedCost, now: number): void {
		// Repeated scroll/layout callbacks must not extend an offscreen page's lifetime.
		if (!this.pages.has(page)) this.pages.set(page, { cost, leftViewportAt: now });
	}
	forget(page: number): void { this.pages.delete(page); }
	clear(): void { this.pages.clear(); }
	get totals(): PageRetainedCost & { pages: number } {
		let bytes = 0, nodes = 0;
		for (const entry of this.pages.values()) { bytes += entry.cost.bytes; nodes += entry.cost.nodes; }
		return { bytes, nodes, pages: this.pages.size };
	}
	/** Return evictions oldest first, including pages that cannot fit on their own. */
	trim(now: number): number[] {
		const evicted: number[] = [];
		for (const [page, entry] of this.pages) {
			if (now - entry.leftViewportAt >= this.lifetimeMs || !Number.isFinite(entry.cost.bytes) || !Number.isFinite(entry.cost.nodes)
				|| entry.cost.bytes > this.maxBytes || entry.cost.nodes > this.maxNodes) {
				this.pages.delete(page); evicted.push(page);
			}
		}
		const oldest = [...this.pages].sort((a, b) => a[1].leftViewportAt - b[1].leftViewportAt);
		let totals = this.totals;
		for (const [page, entry] of oldest) {
			if (totals.pages <= this.maxPages && totals.bytes <= this.maxBytes && totals.nodes <= this.maxNodes) break;
			this.pages.delete(page); evicted.push(page);
			totals = { pages: totals.pages - 1, bytes: totals.bytes - entry.cost.bytes, nodes: totals.nodes - entry.cost.nodes };
		}
		return evicted;
	}
	nextExpiry(): number | null {
		let expires = Infinity;
		for (const entry of this.pages.values()) expires = Math.min(expires, entry.leftViewportAt + this.lifetimeMs);
		return Number.isFinite(expires) ? expires : null;
	}
}
