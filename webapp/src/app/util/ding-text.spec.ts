import type { Ding } from '@fg2/shared-types';
import { dingAlter, dingMarke, dingWert, istEintrag } from './ding-text';

const MINUTE = 60 * 1000;
const MONAT = 30 * 24 * 60 * MINUTE;

const jetzt = Date.now();

/** A controller heard from 40 seconds ago, and the socket hanging on it. */
const controller: Ding = {
  ding_id: 'geraet:d1',
  zelt_id: 'z1',
  geraet_id: 'd1',
  art: 'geraet',
  name: 'Controller',
  t: jetzt - 2 * MONAT,
  t_ende: null,
  d: { zuletzt_gesehen: jetzt - 40000 },
};

/** Its projection carries `t = seit` - the day it was bound to the tent, not a reading. */
const dose: Ding = {
  ding_id: 'dose:aa',
  zelt_id: 'z1',
  geraet_id: 'd1',
  art: 'dose',
  name: 'heater',
  t: jetzt - 2 * MONAT,
  t_ende: null,
  d: { rolle: 'heater', slot: 0 },
};

describe('a socket is as fresh as the thing reporting it', () => {
  it('takes the parent device’s last word instead of its own binding date', () => {
    expect(dingAlter(dose, [controller, dose])).toBe(jetzt - 40000);
    expect(dingMarke(dose, jetzt, [controller, dose])).toBe('voll');
  });

  it('goes stale exactly when the device it hangs on does', () => {
    const still = { ...controller, d: { zuletzt_gesehen: jetzt - 40 * MINUTE } };
    expect(dingAlter(dose, [still, dose])).toBe(jetzt - 40 * MINUTE);
    expect(dingMarke(dose, jetzt, [still, dose])).toBe('hohl');
  });

  it('still prefers a reading of its own when it has one', () => {
    const eigen = { ...dose, d: { ...dose.d, zuletzt_gesehen: jetzt - MINUTE } };
    expect(dingAlter(eigen, [controller, eigen])).toBe(jetzt - MINUTE);
  });

  it('falls back to the row’s own moment when no parent is on the screen', () => {
    expect(dingAlter(dose, [])).toBe(dose.t);
  });
});

describe('numbers a row prints', () => {
  it('hands the liters over already spoken, so ngx-translate cannot paste in a raw 2.5', () => {
    const gabe: Ding = { ding_id: 'g1', zelt_id: 'z1', art: 'gabe', name: '', t: jetzt, d: { wasser_l: 2.5 } };
    expect(typeof dingWert(gabe)?.params?.['liter']).toBe('string');
  });

  it('does the same for a setpoint’s value', () => {
    const ziel: Ding = { ding_id: 'z2', zelt_id: 'z1', art: 'ziel', name: '', t: jetzt, d: { schluessel: 'day.temperature', wert: 25.5 } };
    expect(typeof dingWert(ziel)?.roh).toBe('string');
  });
});

describe('what counts as an entry', () => {
  const machen = (art: Ding['art'], zusatz: Partial<Ding> = {}): Ding => ({
    ding_id: `${art}:1`,
    zelt_id: 'z1',
    art: art,
    name: '',
    t: jetzt,
    ...zusatz,
  });

  it('counts the things somebody wrote', () => {
    expect(istEintrag(machen('gabe'))).toBeTrue();
    expect(istEintrag(machen('notiz'))).toBeTrue();
    expect(istEintrag(machen('bild'))).toBeTrue();
    expect(istEintrag(machen('zustand'))).toBeTrue();
  });

  it('counts neither the tent nor what is standing in it', () => {
    expect(istEintrag(machen('zelt'))).toBeFalse();
    expect(istEintrag(machen('pflanze'))).toBeFalse();
    expect(istEintrag(machen('geraet'))).toBeFalse();
    expect(istEintrag(machen('dose'))).toBeFalse();
    expect(istEintrag(machen('ziel'))).toBeFalse();
  });

  it('does not count an entry that was cancelled', () => {
    expect(istEintrag(machen('gabe', { storniert_von: 'g2' }))).toBeFalse();
  });
});
