import '@testing-library/jest-dom/vitest';

/**
 * jsdom lays nothing out, so it has no `ResizeObserver` either. A component
 * that measures itself - a chart, the timeline's rail - must still mount here,
 * and what it would have measured is what the unit tests check directly.
 */
globalThis.ResizeObserver ??= class {
  public observe() {}
  public unobserve() {}
  public disconnect() {}
};
