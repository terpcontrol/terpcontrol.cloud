import { Ding } from '@fg2/shared-types';
import { validateDingPatch } from '@utils/ding-patch-validierung';

const KORREKTUR = '6f1a8c3e-5d2b-4a7f-9c1e-0b2d4f6a8c1e';
const MENSCH = '9a2b4c6d-1e3f-4a5b-8c7d-2e4f6a8b0c1d';

const zustand = (felder: Partial<Ding> = {}): Ding => ({
  ding_id: '0f9e8d7c-6b5a-4938-8271-605f4e3d2c1b',
  zelt_id: 'zelt-1',
  art: 'zustand',
  name: '',
  t: Date.UTC(2026, 4, 1),
  t_ende: null,
  d: { text: 'Lüfter laut' },
  ...felder,
});

const problemPfade = (ding: Ding, patch: unknown): string[] => {
  const pruefung = validateDingPatch(ding, patch);
  return pruefung.ok === false ? pruefung.problems.map(problem => problem.path) : [];
};

describe('validateDingPatch', () => {
  it('closes an open interval', () => {
    const ende = Date.UTC(2026, 4, 3);
    const pruefung = validateDingPatch(zustand(), { t_ende: ende });

    expect(pruefung).toEqual({ ok: true, aenderung: { t_ende: ende } });
  });

  it('reopens one with an explicit null', () => {
    expect(validateDingPatch(zustand({ t_ende: Date.UTC(2026, 4, 3) }), { t_ende: null })).toEqual({ ok: true, aenderung: { t_ende: null } });
  });

  it('writes dotted paths, so the rest of d survives', () => {
    expect(validateDingPatch(zustand(), { d: { geschlossen_von: MENSCH } })).toEqual({ ok: true, aenderung: { 'd.geschlossen_von': MENSCH } });
  });

  // The one rule the whole art hangs on: a value is corrected by writing a new
  // Ding, so nothing that says what happened may be patched.
  it('refuses every field that is not one of the four', () => {
    expect(problemPfade(zustand(), { name: 'anders' })).toEqual(['name']);
    expect(problemPfade(zustand({ art: 'gabe', d: { wasser_l: 5 } }), { d: { wasser_l: 9 } })).toEqual(['d.wasser_l']);
    expect(problemPfade(zustand(), { t: Date.UTC(2026, 4, 2) })).toEqual(['t']);
    expect(problemPfade(zustand(), { akteur: MENSCH })).toEqual(['akteur']);
    expect(problemPfade(zustand(), { erfasst_at: 1 })).toEqual(['erfasst_at']);
    expect(problemPfade(zustand(), { zelt_id: 'zelt-2' })).toEqual(['zelt_id']);
  });

  it('keeps each d field on the art it belongs to', () => {
    expect(problemPfade(zustand(), { d: { dublette_von: KORREKTUR } })).toEqual(['d.dublette_von']);
    expect(problemPfade(zustand({ art: 'gabe', d: { wasser_l: 5 } }), { d: { geschlossen_von: MENSCH } })).toEqual(['d.geschlossen_von']);
  });

  it('refuses an end before the beginning, and one from the wrong unit', () => {
    expect(problemPfade(zustand(), { t_ende: Date.UTC(2026, 3, 1) })).toEqual(['t_ende']);
    expect(problemPfade(zustand(), { t_ende: 1777000000 })).toEqual(['t_ende']);
    expect(problemPfade(zustand(), { t_ende: Date.now() + 40 * 24 * 60 * 60 * 1000 })).toEqual(['t_ende']);
  });

  it('refuses a correction that is not a ding_id, and one that is the Ding itself', () => {
    expect(problemPfade(zustand(), { storniert_von: 'irgendwas' })).toEqual(['storniert_von']);
    expect(problemPfade(zustand(), { storniert_von: zustand().ding_id })).toEqual(['storniert_von']);
  });

  it('refuses a patch that changes nothing', () => {
    expect(problemPfade(zustand(), {})).toEqual(['']);
    expect(problemPfade(zustand(), 'nein')).toEqual(['']);
  });
});
