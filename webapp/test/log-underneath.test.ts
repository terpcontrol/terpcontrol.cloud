import { describe, expect, it } from 'vitest';
import type { LogTarget } from '@/log/log-context';
import { openingTarget } from '@/log/targets';
import { openingOf } from '@/log/underneath';

/** The Log button in the shell opens on the place the page underneath it is about. */
const target = (key: string, growId: string | null, spaceId: string | null, standsIn: string): LogTarget => ({
  key,
  label: key,
  growId,
  spaceId,
  plantIds: [],
  dayNumber: null,
  standsIn,
});

const FRIDGE_GROW = target('grow:g1', 'g1', null, 'fridge');
const TENT = target('space:tent', null, 'tent', 'tent');
const TARGETS = [FRIDGE_GROW, TENT];

describe('the Log button over a page', () => {
  it('reads the grow or the space off the address', () => {
    expect(openingOf('/grows/g1/weeks')).toEqual({ growId: 'g1', underneath: true });
    expect(openingOf('/grows/g1/plants/p1')).toEqual({ growId: 'g1', underneath: true });
    expect(openingOf('/spaces/tent/overview')).toEqual({ spaceId: 'tent', underneath: true });
    expect(openingOf('/')).toEqual({});
    expect(openingOf('/tasks')).toEqual({});
  });

  it('opens on the tent being looked at rather than on the chip chosen last time', () => {
    expect(openingTarget(TARGETS, openingOf('/spaces/tent/overview'), 'grow:g1')).toEqual({ target: TENT, missed: false });
  });

  it('falls back to the last chip on a page about a place the sheet cannot write to, where a link would say it missed', () => {
    expect(openingTarget(TARGETS, openingOf('/grows/ended/weeks'), 'space:tent')).toEqual({ target: TENT, missed: false });
    expect(openingTarget(TARGETS, { growId: 'ended' }, 'space:tent')).toEqual({ target: null, missed: true });
  });
});
