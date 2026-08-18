/**
 * Single-slot memoization for template getters that derive arrays/objects:
 * change detection calls them every cycle, and a fresh result each time makes
 * ngFor rebuild the DOM continuously (scroll jank, unclickable rows). The
 * factory only runs when the key changes, so the returned identity is stable.
 */
export class KeyedCache<T> {
  private key: string | null = null;
  private value!: T;

  get(key: string, create: () => T): T {
    if (this.key !== key) {
      this.key = key;
      this.value = create();
    }
    return this.value;
  }
}
