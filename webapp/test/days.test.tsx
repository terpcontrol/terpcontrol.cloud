import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dayOf, momentOn } from '@/ui/days';
import { WhenField } from '@/ui/SheetParts';

vi.mock('@/api/session', async importOriginal => {
  const { SIGNED_IN } = await import('./session');

  return { ...(await importOriginal<object>()), useSession: () => SIGNED_IN };
});

/** The zone the account keeps, which is the zone the sheets read their day in. */
const account = vi.hoisted(() => ({ zone: null as string | null }));

vi.mock('@/api/account', async importOriginal => ({
  ...(await importOriginal<object>()),
  useMe: () => ({ data: account.zone === null ? undefined : { preferences: { timezone: account.zone } } }),
}));

/**
 * Which day a backdating sheet is talking about.
 *
 * A grow day is a day where the tent stands, and the sheets that record
 * something after the fact - a note, a phase, a harvest, a move - ask for a day
 * and never for a time. Read on the browser's calendar, the question and the
 * answer were about different days: a grower whose browser had already turned
 * over was offered tomorrow, and the day they picked was written into the one
 * before it, a grow day early. Every expectation below names both zones
 * outright, so what it proves does not depend on where the suite is run.
 */

/** Late on 23 September where the account is kept, which is the small hours of the 24th twelve zones east. */
const EVENING = new Date('2026-09-23T18:36:00.000Z');

describe('the day an instant falls on', () => {
  it('is the day it is where the account is, and not where the reader is sitting', () => {
    expect(dayOf(EVENING, 'UTC')).toBe('2026-09-23');
    expect(dayOf(EVENING, 'Pacific/Auckland')).toBe('2026-09-24');
    expect(dayOf(EVENING, 'America/Los_Angeles')).toBe('2026-09-23');
  });
});

describe('the instant a picked day is written back as', () => {
  it('lands inside that day where the account is, at the hour it is being written down at', () => {
    // The evening of the 22nd where the account is: a day back, and still at
    // 18:36 there, because nobody was asked what time it was.
    expect(momentOn('2026-09-22', EVENING, 'UTC').toISOString()).toBe('2026-09-22T18:36:00.000Z');
  });

  it('reads the day it is handed in the same zone it offered one in', () => {
    // 06:36 on the 24th in Auckland is the instant above. Asked for the 23rd
    // there, it answers 06:36 on the 23rd there - the previous evening in UTC,
    // and a day the account has lived through rather than one it has not.
    const picked = momentOn('2026-09-23', EVENING, 'Pacific/Auckland');

    expect(picked.toISOString()).toBe('2026-09-22T18:36:00.000Z');
    expect(dayOf(picked, 'Pacific/Auckland')).toBe('2026-09-23');
  });

  it('moves a correction by whole days, which is what the day counter behind it counts in', () => {
    const back = momentOn('2026-09-20', EVENING, 'UTC');

    expect((EVENING.getTime() - back.getTime()) / 86_400_000).toBe(3);
  });
});

describe('the day field every backdating sheet draws', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(EVENING);
  });

  afterEach(() => {
    vi.useRealTimers();
    account.zone = null;
  });

  const field = (): HTMLInputElement => screen.getByLabelText('When') as HTMLInputElement;

  const draw = (at: Date, onChange: (at: Date) => void = () => {}) => render(<WhenField label="When" at={at} onChange={onChange} />);

  it('opens on the account´s day and offers no day the account has not reached', () => {
    account.zone = 'Pacific/Auckland';
    draw(EVENING);

    // 06:36 on the 24th where the account is kept, whatever the calendar of the
    // browser drawing it says.
    expect(field().value).toBe('2026-09-24');
    expect(field().max).toBe('2026-09-24');
  });

  it('hands back the day that was picked, read where the account is', () => {
    account.zone = 'UTC';
    const chosen: Date[] = [];
    draw(EVENING, at => chosen.push(at));

    expect(field().value).toBe('2026-09-23');

    fireEvent.change(field(), { target: { value: '2026-09-21' } });
    expect(chosen).toHaveLength(1);
    expect(dayOf(chosen[0], 'UTC')).toBe('2026-09-21');
  });
});
