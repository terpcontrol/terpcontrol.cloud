import { screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GrowBar } from '@/screens/grow/GrowBar';
import { drawAt, json } from './harness';

/**
 * A grow's bar means one thing. With a scheme it is the days gone of the days the scheme plans; without one nothing
 * states a length, and it is the six stages as segments with the reached ones filled - a fill by stage put the first
 * day of flowering at two thirds of a way nobody measured.
 */
const answerGrow = (weeks: number | null) =>
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      json({ id: 'grow-1', scheme: weeks === null ? null : { grid: Array.from({ length: weeks }, (_, index) => ({ week: index + 1 })) } }),
    ),
  );

const segments = () => [...screen.getByRole('img').children].map(segment => segment.hasAttribute('data-reached'));

afterEach(() => vi.unstubAllGlobals());

describe('a grow´s bar', () => {
  it('is six stages without a scheme, the reached ones filled, whatever the day', async () => {
    answerGrow(null);
    drawAt(<GrowBar grow={{ growId: 'grow-1', stage: 'flowering', dayNumber: 1 }} label="Phase progress" />);

    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalled());
    expect(segments()).toEqual([true, true, true, true, false, false]);
  });

  it('is the days gone of the days the scheme plans, where the grow is fed by one', async () => {
    answerGrow(10);
    drawAt(<GrowBar grow={{ growId: 'grow-1', stage: 'flowering', dayNumber: 35 }} label="Phase progress" />);

    // 35 of 70 days.
    await waitFor(() => expect(screen.getByRole('img').firstElementChild).toHaveStyle({ width: '50%' }));
    expect(screen.getByRole('img').children).toHaveLength(1);
  });

  it('is the stages again once the grow dries: a scheme plans the growing and not the drying', async () => {
    answerGrow(10);
    drawAt(<GrowBar grow={{ growId: 'grow-1', stage: 'drying', dayNumber: 75 }} label="Phase progress" />);

    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalled());
    await waitFor(() => expect(segments()).toEqual([true, true, true, true, true, false]));
  });

  it('is said to a screen reader only where nothing beside it says the stage', () => {
    answerGrow(null);
    const { container } = drawAt(<GrowBar grow={{ growId: 'grow-1', stage: 'seedling', dayNumber: 3 }} />);

    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });
});
