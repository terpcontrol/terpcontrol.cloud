import { BRIEF_STAY_MS, movedTo, stayOf } from '@common/v1/device-placements';
import { numbered, nameKey } from '@fg2/shared-types/v1-schemas';

/**
 * Where a device stood: the placements a move leaves behind, and the part of a
 * stretch of time a device speaks for a place. Both are arithmetic over a list,
 * and every read about a place's past rests on them.
 */

const at = (iso: string): Date => new Date(`2026-06-${iso}:00.000Z`);
const stay = (spaceId: string, from: string, to: string | null = null) => ({ spaceId, startedAt: at(from), endedAt: to === null ? null : at(to) });

describe('moving a device', () => {
  it('opens the first placement, closes it at the move and opens the next at the same instant', () => {
    const claimed = movedTo([], 'tent', at('01T10:00'));
    const moved = movedTo(claimed, 'fridge', at('05T10:00'));

    expect(claimed).toEqual([stay('tent', '01T10:00')]);
    expect(moved).toEqual([stay('tent', '01T10:00', '05T10:00'), stay('fridge', '05T10:00')]);
  });

  it('changes nothing where the device already stands there', () => {
    const standing = [stay('tent', '01T10:00')];

    expect(movedTo(standing, 'tent', at('05T10:00'))).toEqual(standing);
  });

  it('closes the open placement when the device is taken out, and keeps the record when it is given up', () => {
    expect(movedTo([stay('tent', '01T10:00')], null, at('05T10:00'))).toEqual([stay('tent', '01T10:00', '05T10:00')]);
    expect(movedTo([stay('tent', '01T10:00', '05T10:00')], null, at('06T10:00'))).toEqual([stay('tent', '01T10:00', '05T10:00')]);
  });

  it('drops a stay of less than five minutes, and goes on with the stay before it where the device is put back', () => {
    const moved = movedTo([stay('tent', '01T10:00')], 'fridge', at('05T10:00'));
    const undone = movedTo(moved, 'tent', new Date(at('05T10:00').getTime() + BRIEF_STAY_MS - 1));

    expect(undone).toEqual([stay('tent', '01T10:00')]);
  });

  it('keeps a stay of five minutes or more, and a way back that came later than that', () => {
    const moved = movedTo([stay('tent', '01T10:00')], 'fridge', at('05T10:00'));
    const back = movedTo(moved, 'tent', at('05T10:05'));

    expect(back).toEqual([stay('tent', '01T10:00', '05T10:00'), stay('fridge', '05T10:00', '05T10:05'), stay('tent', '05T10:05')]);
  });

  it('sends a device claimed into a place of its own on to another without a trace of the first', () => {
    const claimed = movedTo([], 'made-for-the-claim', at('05T10:00'));

    expect(movedTo(claimed, 'tent', at('05T10:01'))).toEqual([stay('tent', '05T10:01')]);
  });
});

describe('the part of a stretch a device stood somewhere', () => {
  const june = { startsAt: at('01T00:00'), endsAt: at('30T00:00') };
  const placements = [
    stay('shelf', '02T00:00', '03T00:00'),
    stay('tent', '03T00:00', '10T00:00'),
    stay('fridge', '10T00:00', '20T00:00'),
    stay('tent', '20T00:00'),
  ];

  it('is cut to the stretch at both ends', () => {
    expect(stayOf(placements, ['fridge'], june)).toEqual({ startsAt: at('10T00:00'), endsAt: at('20T00:00') });
    expect(stayOf(placements, ['fridge'], { startsAt: at('12T00:00'), endsAt: at('13T00:00') })).toEqual({
      startsAt: at('12T00:00'),
      endsAt: at('13T00:00'),
    });
  });

  it('reaches from the first moment there to the last where the device left and came back', () => {
    expect(stayOf(placements, ['tent'], june)).toEqual({ startsAt: at('03T00:00'), endsAt: june.endsAt });
  });

  it('takes what a device measured before it was first put anywhere as measured in its first place, and only there', () => {
    // Claimed on the third, with readings from the days before: plugged in early, or carried over from the old cloud.
    expect(stayOf([stay('tent', '03T00:00')], ['tent'], june)).toEqual(june);
    expect(stayOf(placements, ['shelf'], june)).toEqual({ startsAt: june.startsAt, endsAt: at('03T00:00') });
    expect(stayOf(placements, ['shelf'], { startsAt: new Date(0), endsAt: at('01T00:00') })).toEqual({
      startsAt: new Date(0),
      endsAt: at('01T00:00'),
    });
    // The second place it stood in begins when it came.
    expect(stayOf(placements, ['tent'], { startsAt: at('01T00:00'), endsAt: at('02T12:00') })).toBeNull();
  });

  it('is nothing for a place it never stood in, a stretch it stood elsewhere, and a device without a record', () => {
    expect(stayOf(placements, ['balcony'], june)).toBeNull();
    expect(stayOf(placements, ['tent'], { startsAt: at('11T00:00'), endsAt: at('19T00:00') })).toBeNull();
    expect(stayOf(undefined, ['tent'], june)).toBeNull();
    // Touching the stretch at its edge is not standing inside it.
    expect(stayOf(placements, ['fridge'], { startsAt: at('20T00:00'), endsAt: at('25T00:00') })).toBeNull();
  });
});

describe('a name that is taken', () => {
  const taken = new Set(['zelt', 'zelt 2', 'tent 1'].map(nameKey));

  it('reads a name as a person does', () => {
    expect(nameKey('  Zelt  ')).toBe(nameKey('ZELT'));
    expect(nameKey('Zelt  2')).toBe(nameKey('zelt 2'));
    expect(nameKey('Zelt')).not.toBe(nameKey('Zelte'));
  });

  it('keeps a free name, takes the lowest free number, and counts on from a number the name ends in', () => {
    expect(numbered('Fridge', taken)).toBe('Fridge');
    expect(numbered('Zelt', taken)).toBe('Zelt 3');
    expect(numbered('Tent 1', taken)).toBe('Tent 2');
    expect(numbered('zelt 2', taken)).toBe('zelt 3');
  });
});
