import type { Ding, Zelt } from '@fg2/shared-types';
import { laufBeginn, tagNummer } from './zelt-tag';

const zelt = (teil: Partial<Zelt> = {}): Zelt => ({
  zelt_id: 'z1',
  besitzer_id: 'u1',
  name: 'Zelt Keller',
  geraete: [],
  zeitzone: 'Europe/Berlin',
  tag_null: Date.UTC(2026, 6, 1, 10, 0),
  erstellt_at: Date.UTC(2026, 6, 1, 10, 0),
  ...teil,
});

describe('the day counter', () => {
  it('counts calendar days in the tent’s own zone, not milliseconds', () => {
    // 23:30 in Berlin on day one, 00:30 on day two: half an hour apart, and a
    // different day. A division of milliseconds would call both day one.
    const beginn = Date.parse('2026-07-01T21:30:00Z');
    const spaeter = Date.parse('2026-07-01T22:30:00Z');

    expect(tagNummer('Europe/Berlin', beginn, beginn)).toBe(1);
    expect(tagNummer('Europe/Berlin', beginn, spaeter)).toBe(2);
  });

  it('starts the counter at the open run when the tent has one', () => {
    const lauf: Ding = {
      ding_id: 'l2',
      zelt_id: 'z1',
      art: 'lauf',
      name: '',
      t: Date.UTC(2026, 7, 1),
      t_ende: null,
      d: { nummer: 2 },
    };

    expect(laufBeginn(zelt(), [lauf])).toBe(lauf.t);
  });

  it('falls back to tag_null, so a tent that has never recorded a run still counts', () => {
    expect(laufBeginn(zelt(), [])).toBe(zelt().tag_null);
  });
});
