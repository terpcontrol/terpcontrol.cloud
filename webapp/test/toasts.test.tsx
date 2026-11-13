import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { useLog } from '@/log/log-context';
import { LogProvider } from '@/log/LogProvider';
import { besideSheet, withRoom } from '@/log/toast-room';
import type { LoggedLine } from '@/log/Toasts';
import { Sheet } from '@/ui/Sheet';
import { drawAt } from './harness';
import { translate } from './translations';

/**
 * The toasts as a page meets them: an answer to every write, but never a pile
 * of them. There are at most two, a control that is used again answers in the
 * toast it already has, and no toast lies on an open sheet.
 */

beforeAll(() => translate());
afterEach(() => vi.restoreAllMocks());

const line = (key: number, over: Partial<LoggedLine> = {}): LoggedLine => ({
  key,
  label: `line ${key}`,
  send: () => Promise.reject(new Error('nothing to send')),
  revert: null,
  details: null,
  state: 'saved',
  failure: null,
  reason: null,
  undoing: false,
  entry: null,
  undoable: false,
  undoUntil: null,
  progress: null,
  ...over,
});

const keys = (lines: LoggedLine[]) => lines.map(one => one.key);

describe('the room the toasts have', () => {
  it('holds two, and lets the oldest go for a third', () => {
    expect(keys(withRoom([line(1)], line(2)))).toEqual([1, 2]);
    expect(keys(withRoom([line(1), line(2)], line(3)))).toEqual([2, 3]);
  });

  it('gives a control´s next answer the place of its last', () => {
    const stepped = withRoom([line(1), line(2, { from: 'device-1:lightLimit' })], line(3, { from: 'device-1:lightLimit' }));

    expect(keys(stepped)).toEqual([1, 3]);
    // Another control's answer stands beside it.
    expect(keys(withRoom(stepped, line(4, { from: 'rule-1' })))).toEqual([3, 4]);
  });

  it('never lets go of a line that is still on its way or has failed: it is the only place that is said', () => {
    const waiting = [line(1, { state: 'failed', failure: 'write' }), line(2, { state: 'saving' })];
    expect(keys(withRoom(waiting, line(3)))).toEqual([1, 2, 3]);
    expect(keys(withRoom([line(1, { state: 'failed', failure: 'write' }), line(2)], line(3)))).toEqual([1, 3]);
    // Nor of one whose undo is under way, whatever control it came from.
    expect(keys(withRoom([line(1, { from: 'a', undoing: true })], line(2, { from: 'a' })))).toEqual([1, 2]);
  });
});

/** Says something through the toast the way a screen does: plainly, or as the answer of a named control. */
function Probe() {
  const { tell } = useLog();
  return (
    <>
      {['one', 'two', 'three'].map(label => (
        <button key={label} type="button" onClick={() => tell({ label, undo: null })}>
          {label}
        </button>
      ))}
      {['95 %', '90 %'].map(value => (
        <button key={value} type="button" onClick={() => tell({ label: `Light limit ${value}`, undo: null, from: 'limit' })}>
          {value}
        </button>
      ))}
      <button
        type="button"
        onClick={() => tell({ label: 'Tent is now called Flower tent', undo: () => Promise.resolve(), undone: 'Flower tent is now called Tent' })}
      >
        rename
      </button>
    </>
  );
}

/** The toasts as they read: a figure is bound to its unit by a space that does not break. */
const shown = () => [...document.querySelectorAll('[role="status"][aria-live] > div')].map(toast => toast.textContent.replace(/\u00a0/g, ' '));

describe('the toasts on a page', () => {
  it('shows two at most, the newest two', async () => {
    drawAt(
      <LogProvider>
        <Probe />
      </LogProvider>,
    );

    for (const label of ['one', 'two', 'three']) fireEvent.click(screen.getByRole('button', { name: label }));

    await waitFor(() => expect(shown()).toEqual(['two', 'three']));
  });

  it('answers a control that is used again in the toast it has', async () => {
    drawAt(
      <LogProvider>
        <Probe />
      </LogProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'one' }));
    fireEvent.click(screen.getByRole('button', { name: '95 %' }));
    fireEvent.click(screen.getByRole('button', { name: '90 %' }));

    await waitFor(() => expect(shown()).toEqual(['one', 'Light limit 90 %']));
  });

  it('answers "Undo" in the toast it was tapped in, with what holds again where the screen said it, and goes when that is read', async () => {
    vi.useFakeTimers();
    try {
      drawAt(
        <LogProvider>
          <Probe />
        </LogProvider>,
      );
      fireEvent.click(screen.getByRole('button', { name: 'one' }));
      await act(() => vi.advanceTimersByTimeAsync(1000));
      fireEvent.click(screen.getByRole('button', { name: 'rename' }));
      fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
      await act(() => vi.advanceTimersByTimeAsync(0));

      expect(shown()).toEqual(['one', 'Undone · Flower tent is now called Tent']);
      expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument();
      // It stays as long as a toast that tells of something: the one told a second before it goes a second before it.
      await act(() => vi.advanceTimersByTimeAsync(7500));
      expect(shown()).toEqual(['Undone · Flower tent is now called Tent']);
      await act(() => vi.advanceTimersByTimeAsync(1000));
      expect(shown()).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  /** jsdom lays nothing out: the boxes a phone 600 high would measure, the toasts 108 high, the sheet's body with more to show. */
  const laidOut = (sheet: { top: number; high: number }) => {
    Object.defineProperty(window, 'innerHeight', { value: 600, configurable: true });
    const HIGH: [string, (element: HTMLElement) => number][] = [
      ['[role="dialog"]', () => sheet.high],
      ['[role="status"]', () => 108],
      ['[data-toasts]', foot => foot.childElementCount * 120],
    ];
    const high = (element: HTMLElement) => HIGH.find(([what]) => element.matches(what))?.[1](element) ?? 0;
    vi.spyOn(HTMLElement.prototype, 'offsetTop', 'get').mockImplementation(function (this: HTMLElement) {
      return this.matches('[role="dialog"]') ? sheet.top : 0;
    });
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
      return high(this);
    });
    vi.spyOn(Element.prototype, 'scrollHeight', 'get').mockReturnValue(900);
  };

  const withSheet = (open: boolean) => (
    <LogProvider>
      <Probe />
      {open ? (
        <Sheet title="A figure" actions={<button type="button">Save</button>} onClose={() => {}}>
          <p>One figure.</p>
        </Sheet>
      ) : null}
    </LogProvider>
  );

  it('stands in the foot of a sheet that leaves no room beside it, above the button row, and back at the page´s foot once it has closed', async () => {
    laidOut({ top: 72, high: 528 });
    const drawn = drawAt(withSheet(true));

    fireEvent.click(screen.getByRole('button', { name: 'one', hidden: true }));
    const toasts = await waitFor(() => document.querySelector<HTMLElement>('[role="status"][aria-live]')!);

    const sheet = screen.getByRole('dialog');
    await waitFor(() => expect(toasts).toHaveAttribute('data-in-sheet'));
    // Part of the sheet, between what it asks and its buttons: nothing of it is covered, and Tab reaches the toast.
    expect(toasts.parentElement).toBe(sheet.querySelector('[data-toasts]'));
    expect(toasts.parentElement!.previousElementSibling).toContainElement(screen.getByText('One figure.'));
    expect(toasts.parentElement!.nextElementSibling).toBe(sheet.querySelector('footer'));
    expect(toasts.getAttribute('style') ?? '').toBe('');

    await act(async () => drawn.rerender(withSheet(false)));
    await waitFor(() => expect(toasts).not.toHaveAttribute('data-in-sheet'));
    expect(toasts.parentElement).toBe(document.body);
    expect(shown()).toEqual(['one']);
  });

  it('stands over a sheet the window has room above, outside its box', async () => {
    laidOut({ top: 359, high: 241 });
    drawAt(withSheet(true));

    fireEvent.click(screen.getByRole('button', { name: 'one', hidden: true }));
    const toasts = await waitFor(() => document.querySelector<HTMLElement>('[role="status"][aria-live]')!);

    // The sheet begins at 359 of 600: the toasts end a step above it.
    await waitFor(() => expect(toasts.style.bottom).toBe('249px'));
    expect(toasts.parentElement).toBe(document.body);
    expect(screen.getByRole('dialog')).not.toContainElement(toasts);
    // The stack grows away from the sheet: the newest is the last, against its box.
    expect(toasts.style.flexDirection).toBe('');
  });

  it('stands under a sheet the window has room below, the newest first: against its box there too', async () => {
    laidOut({ top: 100, high: 200 });
    drawAt(withSheet(true));

    fireEvent.click(screen.getByRole('button', { name: 'one', hidden: true }));
    const toasts = await waitFor(() => document.querySelector<HTMLElement>('[role="status"][aria-live]')!);

    await waitFor(() => expect(toasts.style.top).toBe('308px'));
    expect(toasts.style.flexDirection).toBe('column-reverse');
  });
});

describe('where the toasts stand while a sheet is open', () => {
  it('is under the sheet on a desktop, where the window has the room', () => {
    expect(besideSheet({ top: 281, bottom: 519 }, 96, 800, 24)).toEqual({ top: 527 });
  });

  it('is over the sheet on a phone, whose sheet stands on the bottom edge', () => {
    expect(besideSheet({ top: 359, bottom: 600 }, 108, 600)).toEqual({ bottom: 249 });
    // One toast still fits over a sheet as high as a sheet gets on a short phone; two do not.
    expect(besideSheet({ top: 72, bottom: 600 }, 44, 600)).toEqual({ bottom: 536 });
    expect(besideSheet({ top: 72, bottom: 600 }, 108, 600)).toBe('foot');
  });

  it('is the sheet´s foot where neither side has the room, and never the room the window keeps free above a sheet', () => {
    expect(besideSheet({ top: 56, bottom: 744 }, 96, 800, 24)).toBe('foot');
    expect(besideSheet({ top: 100, bottom: 844 }, 44, 844, 59)).toBe('foot');
  });
});
