import { Ding } from '@fg2/shared-types';
import { vorbefund } from '@utils/vorbefund';

const TAG = 24 * 60 * 60 * 1000;
const TAG_NULL = Date.UTC(2026, 5, 25);

const ding = (ding_id: string, art: Ding['art'], d?: Record<string, unknown>): Ding => ({
  ding_id: ding_id,
  zelt_id: 'zelt-1',
  art: art,
  name: '',
  t: TAG_NULL,
  ...(d ? { d: d } : {}),
});

describe('The pre-claim snapshot (§14.6)', () => {
  it('counts the diary the way the upgrade screen prints it', () => {
    const dinge = [
      ding('a', 'gabe', { wasser_l: 5 }),
      ding('b', 'gabe', { wasser_l: 13.5 }),
      ding('c', 'notiz', { text: 'umgetopft' }),
      ding('d', 'pflanze'),
    ];

    const zaehler = vorbefund(dinge, 84, TAG_NULL, TAG_NULL + 60 * TAG);

    expect(zaehler).toMatchObject({ tage: 61, dinge: 4, fotos: 84, gaben: 2, wasser_l: 18.5, tag_null: TAG_NULL });
  });

  it('adds litres without printing a rounding error at somebody', () => {
    const dinge = [ding('a', 'gabe', { wasser_l: 0.1 }), ding('b', 'gabe', { wasser_l: 0.2 })];

    expect(vorbefund(dinge, 0, TAG_NULL, TAG_NULL).wasser_l).toBe(0.3);
  });

  it('ignores a Gabe whose litres are missing or not a number rather than summing NaN', () => {
    const dinge = [ding('a', 'gabe', { wasser_l: 5 }), ding('b', 'gabe'), ding('c', 'gabe', { wasser_l: '5' })];

    expect(vorbefund(dinge, 0, TAG_NULL, TAG_NULL).wasser_l).toBe(5);
    expect(vorbefund(dinge, 0, TAG_NULL, TAG_NULL).gaben).toBe(3);
  });

  it('starts at day 1 and never below it', () => {
    expect(vorbefund([], 0, TAG_NULL, TAG_NULL).tage).toBe(1);
    expect(vorbefund([], 0, TAG_NULL, TAG_NULL - 5 * TAG).tage).toBe(1);
  });

  it('hashes the ids and not the order they were read in', () => {
    const eine = vorbefund([ding('a', 'notiz'), ding('b', 'notiz')], 0, TAG_NULL, TAG_NULL);
    const andere = vorbefund([ding('b', 'notiz'), ding('a', 'notiz')], 0, TAG_NULL, TAG_NULL);
    const dritte = vorbefund([ding('a', 'notiz'), ding('c', 'notiz')], 0, TAG_NULL, TAG_NULL);

    expect(eine.hash).toBe(andere.hash);
    expect(dritte.hash).not.toBe(eine.hash);
    expect(eine.hash).toHaveLength(64);
  });

  it('describes an empty diary rather than refusing to', () => {
    expect(vorbefund([], 0, TAG_NULL, TAG_NULL)).toMatchObject({ dinge: 0, gaben: 0, fotos: 0, wasser_l: 0, tage: 1 });
  });
});
