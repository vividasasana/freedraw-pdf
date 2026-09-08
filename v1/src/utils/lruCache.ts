/**
 * Simple LRU (Least Recently Used) cache with size limit.
 * When maxSize is exceeded, the least recently used item is evicted.
 */
export class LRUCache<K, V> {
	private cache: Map<K, V> = new Map();
	private readonly maxSize: number;

	constructor(maxSize: number = 10) {
		this.maxSize = Math.max(1, maxSize);
	}

	get(key: K): V | undefined {
		if (!this.cache.has(key)) {
			return undefined;
		}
		const value = this.cache.get(key)!;
		this.cache.delete(key);
		this.cache.set(key, value);
		return value;
	}

	set(key: K, value: V): void {
		if (this.cache.has(key)) {
			this.cache.delete(key);
		}
		this.cache.set(key, value);
		if (this.cache.size > this.maxSize) {
			const firstKey = this.cache.keys().next().value;
			if (firstKey !== undefined) {
				this.cache.delete(firstKey);
			}
		}
	}

	has(key: K): boolean {
		return this.cache.has(key);
	}

	delete(key: K): boolean {
		return this.cache.delete(key);
	}

	clear(): void {
		this.cache.clear();
	}

	get size(): number {
		return this.cache.size;
	}
}
