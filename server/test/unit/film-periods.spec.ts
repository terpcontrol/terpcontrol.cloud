import { periodAround, periodBefore } from '@modules/v1/camera/film-periods';

/**
 * The rolling films are cut on the owner's calendar: a day from their
 * midnight, a week from their Monday, a month from the first - not UTC epoch
 * buckets, whose weeks ran Thursday to Thursday and whose months were thirty
 * days from 4 September.
 */
describe('the periods a rolling film covers', () => {
  const at = new Date('2026-09-24T20:35:27.514Z'); // a Thursday evening

  it('cuts a week from Monday to Monday, not from the epoch´s Thursday', () => {
    expect(periodAround('week', at, 'UTC')).toEqual({ startsAt: new Date('2026-09-21T00:00:00.000Z'), endsAt: new Date('2026-09-28T00:00:00.000Z') });
  });

  it('cuts a month on the calendar', () => {
    expect(periodAround('month', at, 'UTC')).toEqual({
      startsAt: new Date('2026-09-01T00:00:00.000Z'),
      endsAt: new Date('2026-10-01T00:00:00.000Z'),
    });
  });

  it('starts a day at the account´s midnight', () => {
    expect(periodAround('day', at, 'Europe/Berlin')).toEqual({
      startsAt: new Date('2026-09-23T22:00:00.000Z'),
      endsAt: new Date('2026-09-24T22:00:00.000Z'),
    });
  });

  it('steps back to the complete period before the open one', () => {
    const open = periodAround('week', at, 'Europe/Berlin');
    expect(periodBefore('week', open, 'Europe/Berlin')).toEqual({
      startsAt: new Date('2026-09-13T22:00:00.000Z'),
      endsAt: new Date('2026-09-20T22:00:00.000Z'),
    });
  });

  it('falls back to UTC for a zone nobody knows', () => {
    expect(periodAround('day', at, 'Nowhere/Else')).toEqual({
      startsAt: new Date('2026-09-24T00:00:00.000Z'),
      endsAt: new Date('2026-09-25T00:00:00.000Z'),
    });
  });
});
