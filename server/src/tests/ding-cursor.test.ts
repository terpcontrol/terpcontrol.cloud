import { Ding } from '@fg2/shared-types';
import { dekodiereCursor, kodiereCursor, nachCursor, vergleicheDinge } from '@utils/ding-cursor';

const ding = (t: number, ding_id: string): Ding => ({ ding_id: ding_id, zelt_id: 'zelt-1', art: 'notiz', name: '', t: t });

describe('the cursor of a Dinge page', () => {
  it('orders newest first and breaks a tie on ding_id', () => {
    const gemischt = [ding(2, 'b'), ding(1, 'a'), ding(2, 'a'), ding(1, 'b')];

    expect([...gemischt].sort(vergleicheDinge).map(eintrag => `${eintrag.t}${eintrag.ding_id}`)).toEqual(['2b', '2a', '1b', '1a']);
  });

  // The reason the tie-break exists: user-chosen timestamps land on rounded
  // midnights and a sitting of six entries shares one millisecond, so `t` alone
  // is not a total order and paging on it loses rows.
  it('is a total order even when every Ding shares one timestamp', () => {
    const gleichzeitig = ['e', 'c', 'a', 'd', 'b'].map(id => ding(1700000000000, id));
    const sortiert = [...gleichzeitig].sort(vergleicheDinge);

    expect(sortiert.map(eintrag => eintrag.ding_id)).toEqual(['e', 'd', 'c', 'b', 'a']);
    expect(sortiert.every((eintrag, i) => i === 0 || vergleicheDinge(sortiert[i - 1], eintrag) < 0)).toBe(true);
  });

  it('lets exactly the Dinge behind the cursor onto a later page', () => {
    const cursor = { t: 5, ding_id: 'm' };

    expect(nachCursor(ding(4, 'z'), cursor)).toBe(true);
    expect(nachCursor(ding(5, 'a'), cursor)).toBe(true);
    // The cursor itself and everything before it are on the page already read.
    expect(nachCursor(ding(5, 'm'), cursor)).toBe(false);
    expect(nachCursor(ding(5, 'z'), cursor)).toBe(false);
    expect(nachCursor(ding(6, 'a'), cursor)).toBe(false);
    // No cursor is the first page: everything is behind it.
    expect(nachCursor(ding(1, 'a'), null)).toBe(true);
  });

  it('round-trips the sort key it was made from', () => {
    const letzter = ding(1762000000123, '6f1a8c3e-5d2b-4a7f-9c1e-0b2d4f6a8c1e');

    expect(dekodiereCursor(kodiereCursor(letzter))).toEqual({ t: letzter.t, ding_id: letzter.ding_id });
  });

  it('refuses anything it did not hand out', () => {
    expect(dekodiereCursor('nicht-von-hier')).toBeNull();
    expect(dekodiereCursor(Buffer.from('ohne-doppelpunkt').toString('base64url'))).toBeNull();
    expect(dekodiereCursor(Buffer.from('abc:ding-1').toString('base64url'))).toBeNull();
    expect(dekodiereCursor(Buffer.from('1700000000000:').toString('base64url'))).toBeNull();
    expect(dekodiereCursor('')).toBeNull();
  });
});
