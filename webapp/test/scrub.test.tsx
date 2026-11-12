import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useScrub, type Selection } from '@/charts/scrub';

/**
 * The gestures of a plot. What is held here is what a thumb and a mouse each
 * mean: a tap sets the cursor down, a scroll that starts on a plot does not,
 * a mouse reads on the way over and marks a stretch by dragging, and two
 * fingers pinch.
 */

const did: (string | Selection)[] = [];

function Plot() {
  const scrub = useScrub({
    onCursor: fraction => did.push(`cursor ${fraction.toFixed(2)}`),
    onPlace: fraction => did.push(`place ${fraction.toFixed(2)}`),
    onLeave: () => did.push('leave'),
    onZoom: selection => did.push(selection),
  });

  return (
    <div
      data-testid="plot"
      {...scrub.handlers}
      data-selecting={scrub.selection ? `${scrub.selection.from.toFixed(2)}-${scrub.selection.to.toFixed(2)}` : undefined}
    />
  );
}

const plot = () => screen.getByTestId('plot');
const touch = (type: string, id: number, x: number) => {
  const event = new MouseEvent(type, { bubbles: true, clientX: x, clientY: 10 });
  Object.assign(event, { pointerId: id, pointerType: 'touch' });
  fireEvent(plot(), event);
};
const mouse = (type: string, x: number) => {
  // React works a leave out from the pointer going out, to something that is not inside.
  const event = new MouseEvent(type === 'pointerleave' ? 'pointerout' : type, {
    bubbles: true,
    clientX: x,
    clientY: 10,
    relatedTarget: document.body,
  });
  Object.assign(event, { pointerId: 1, pointerType: 'mouse' });
  fireEvent(plot(), event);
};

beforeEach(() => {
  did.length = 0;
  render(<Plot />);
  plot().getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 100, right: 200, bottom: 100, x: 0, y: 0, toJSON: () => ({}) });
});

describe('a thumb on a plot', () => {
  it('sets the cursor down with a tap', () => {
    touch('pointerdown', 1, 50);
    touch('pointerup', 1, 50);

    expect(did).toEqual(['place 0.25']);
  });

  it('moves the cursor once it travels sideways, and sets it down where it lifts', () => {
    touch('pointerdown', 1, 50);
    touch('pointermove', 1, 54);
    touch('pointermove', 1, 100);
    touch('pointerup', 1, 120);

    expect(did).toEqual(['cursor 0.50', 'place 0.60']);
  });

  // The page scrolls under a thumb that starts on a plot: the browser takes the gesture and says so.
  it('leaves the cursor where it stood when the page scrolls instead', () => {
    touch('pointerdown', 1, 50);
    touch('pointercancel', 1, 50);

    expect(did).toEqual(['leave']);
  });

  it('zooms to what two fingers spread apart, keeping under each what lay under it', () => {
    touch('pointerdown', 1, 80);
    touch('pointerdown', 2, 120);
    touch('pointermove', 1, 40);
    touch('pointermove', 2, 160);
    touch('pointerup', 1, 40);
    touch('pointerup', 2, 160);

    // Fingers at 40 % and 60 % moved to 20 % and 80 %: a third of the window, around its middle. The second finger
    // coming down gives the cursor back to where it stood, and nothing else happens.
    expect(did).toHaveLength(2);
    expect(did[0]).toBe('leave');
    expect((did[1] as Selection).from).toBeCloseTo(1 / 3, 5);
    expect((did[1] as Selection).to).toBeCloseTo(2 / 3, 5);
  });

  it('never sets the cursor with a second finger: not where the first had dragged it, not where either lifts', () => {
    touch('pointerdown', 1, 50);
    touch('pointermove', 1, 90);
    touch('pointerdown', 2, 150);
    // Two fingers resting, then one moving on alone, then both lifting.
    touch('pointermove', 1, 92);
    touch('pointerup', 2, 150);
    touch('pointermove', 1, 120);
    touch('pointerup', 1, 120);

    expect(did).toEqual(['cursor 0.45', 'leave']);
    // The next touch is a gesture of its own again.
    touch('pointerdown', 3, 60);
    touch('pointerup', 3, 60);
    expect(did.at(-1)).toBe('place 0.30');
  });

  it('zooms out past both ends when two fingers are drawn together', () => {
    touch('pointerdown', 1, 20);
    touch('pointerdown', 2, 180);
    touch('pointermove', 1, 80);
    touch('pointermove', 2, 120);
    touch('pointerup', 2, 120);

    expect((did[1] as Selection).from).toBeLessThan(0);
    expect((did[1] as Selection).to).toBeGreaterThan(1);
  });
});

describe('a mouse over a plot', () => {
  it('reads on its way over, sets the cursor down on a click and gives it back on leaving', () => {
    mouse('pointermove', 100);
    mouse('pointerleave', 300);
    mouse('pointerdown', 150);
    mouse('pointerup', 150);

    expect(did).toEqual(['cursor 0.50', 'leave', 'cursor 0.75', 'place 0.75']);
  });

  it('marks a stretch by dragging, shows it, and zooms into it on letting go', () => {
    mouse('pointerdown', 50);
    mouse('pointermove', 150);
    expect(plot()).toHaveAttribute('data-selecting', '0.25-0.75');
    mouse('pointerup', 150);

    expect(did.at(-1)).toEqual({ from: 0.25, to: 0.75 });
    expect(plot()).not.toHaveAttribute('data-selecting');
  });

  it('takes a drag of a pixel or two for the click it was', () => {
    mouse('pointerdown', 50);
    mouse('pointermove', 52);
    mouse('pointerup', 52);

    expect(did.at(-1)).toBe('place 0.26');
  });
});
