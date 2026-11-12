import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { useLog } from '@/log/log-context';
import { LogProvider } from '@/log/LogProvider';
import { withRoom } from '@/log/toast-room';
import type { LoggedLine } from '@/log/Toasts';
import { Sheet } from '@/ui/Sheet';
import { drawAt } from './harness';
import { translate } from './translations';

/**
 * The toasts as a page meets them: an answer to every write, but never a pile
 * of them. There are at most two, a control that is used again answers in the
 * toast it already has, and no toast lies on the buttons of a sheet.
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

  it('stands above the button row of a sheet that is open, and back at the page´s foot once it has closed', async () => {
    Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return {
        top: this.tagName === 'FOOTER' ? 700 : 300,
        bottom: 800,
        left: 0,
        right: 390,
        width: 390,
        height: 100,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      };
    });
    const sheet = (open: boolean) => (
      <LogProvider>
        <Probe />
        {open ? (
          <Sheet title="A figure" actions={<button type="button">Save</button>} onClose={() => {}}>
            <p>One figure.</p>
          </Sheet>
        ) : null}
      </LogProvider>
    );
    const drawn = drawAt(sheet(true));

    fireEvent.click(screen.getByRole('button', { name: 'one', hidden: true }));
    const toasts = await waitFor(() => document.querySelector<HTMLElement>('[role="status"][aria-live]')!);

    // 800 high, the button row begins at 700: the toasts end a step above it.
    expect(toasts).toHaveAttribute('data-over-sheet');
    expect(toasts.style.bottom).toBe('108px');

    await act(async () => drawn.rerender(sheet(false)));
    await waitFor(() => expect(toasts).not.toHaveAttribute('data-over-sheet'));
    expect(toasts.style.bottom).toBe('');
  });
});
