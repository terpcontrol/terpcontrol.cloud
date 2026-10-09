import { afterEach, describe, expect, it, vi } from 'vitest';
import { followReleases } from '@/app/update';

/**
 * A new release: the page reloads once its worker has taken over, but not on
 * the first visit, and looks for a new release whenever it comes to the front.
 */

const fakeWorker = (controller: object | null) => {
  const worker = Object.assign(new EventTarget(), {
    controller,
    getRegistration: vi.fn(() => Promise.resolve({ update: vi.fn(() => Promise.resolve()) })),
  });
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: worker });
  const reload = vi.fn();
  Object.defineProperty(window, 'location', { configurable: true, value: { ...window.location, reload } });
  return { worker, reload };
};

const original = { location: window.location };

afterEach(() => {
  Reflect.deleteProperty(navigator, 'serviceWorker');
  Object.defineProperty(window, 'location', { configurable: true, value: original.location });
});

describe('followReleases', () => {
  it('reloads once when a new worker takes over the page', () => {
    const { worker, reload } = fakeWorker({});
    followReleases();
    worker.dispatchEvent(new Event('controllerchange'));
    worker.dispatchEvent(new Event('controllerchange'));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('does not reload when the first worker claims a page that had none', () => {
    const { worker, reload } = fakeWorker(null);
    followReleases();
    worker.dispatchEvent(new Event('controllerchange'));
    expect(reload).not.toHaveBeenCalled();
  });

  it('reloads for the release after the first worker claimed the page', () => {
    const { worker, reload } = fakeWorker(null);
    followReleases();
    worker.dispatchEvent(new Event('controllerchange'));
    worker.dispatchEvent(new Event('controllerchange'));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('looks for a new release when the app comes back to the front', () => {
    const { worker } = fakeWorker({});
    followReleases();
    document.dispatchEvent(new Event('visibilitychange'));
    expect(worker.getRegistration).toHaveBeenCalled();
  });
});
