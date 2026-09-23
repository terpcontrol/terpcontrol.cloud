import i18next from 'i18next';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { figure, targetFigure } from '@/screens/home/units';
import { readingFigure } from '@/ui/entries';
import { decimalFigure, looseFigure } from '@/ui/figures';

/**
 * A reading is written in the reader's language, not in the one the code was
 * typed in.
 *
 * German puts a comma where English puts a point, and the whole app wrote the
 * English one because every reading reached the screen through `toFixed`. So
 * the German app read a tent back as "24.4 °C" under the words "im Ziel", on
 * every screen that carries a figure at once. These check the one writer they
 * all go through now.
 */

describe('a figure in the reader´s language', () => {
  it('decimates the way the language does', () => {
    expect(decimalFigure(24.4, 1, 'en')).toBe('24.4');
    expect(decimalFigure(24.4, 1, 'de')).toBe('24,4');
    expect(decimalFigure(0.98, 2, 'de')).toBe('0,98');
  });

  it('keeps the decimals the sensor is good for, including the ones that are nought', () => {
    expect(decimalFigure(26, 1, 'de')).toBe('26,0');
    expect(decimalFigure(59.77211, 0, 'en')).toBe('60');
  });

  it('never groups the thousands, because that separator is the other language´s decimal point', () => {
    expect(decimalFigure(1600, 0, 'en')).toBe('1600');
    expect(decimalFigure(1600, 0, 'de')).toBe('1600');
  });

  it('writes a measurement to as many decimals as it was taken to and no further', () => {
    expect(looseFigure(1.92 - 0.06, 'en')).toBe('1.86');
    expect(looseFigure(6.5, 'de')).toBe('6,5');
    expect(looseFigure(180, 'de')).toBe('180');
  });

  it('writes a change that rounds away as nothing, and not as minus nothing', () => {
    expect(looseFigure(-0.0001, 'en')).toBe('0');
    expect(looseFigure(-0.0001, 'de')).toBe('0');
  });
});

/**
 * The language comes from the app rather than from each caller, because the
 * screens that write a reading run into the dozens and almost none of them has
 * any other reason to know what language it is being read in. Asking for it as
 * an argument is what left the app patching call sites one at a time.
 */
describe('which language that is', () => {
  const was = i18next.language;

  beforeAll(async () => {
    if (!i18next.isInitialized) await i18next.init({ lng: 'en', resources: { en: { translation: {} }, de: { translation: {} } } });
  });

  afterAll(async () => {
    await i18next.changeLanguage(was);
  });

  it('follows the language the app is being read in', async () => {
    await i18next.changeLanguage('de');
    expect(figure(24.4, 'temperature')).toBe('24,4');
    expect(readingFigure(6.5)).toBe('6,5');

    await i18next.changeLanguage('en');
    expect(figure(24.4, 'temperature')).toBe('24.4');
    expect(readingFigure(6.5)).toBe('6.5');
  });

  it('still writes nothing as nothing rather than as minus nothing', async () => {
    await i18next.changeLanguage('de');
    expect(figure(-0.0001, 'co2')).toBe('0');
    expect(figure(-0.004, 'vpd')).toBe('0,00');
  });

  it('leaves a round target round, which is how a band edge and an axis corner are written', async () => {
    await i18next.changeLanguage('de');
    expect(targetFigure(26, 'temperature')).toBe('26');
    expect(targetFigure(26.5, 'temperature')).toBe('26,5');
  });
});

/**
 * What must not be written this way, and the sweep that keeps it out.
 *
 * A comma in a figure is right in front of a reader and wrong everywhere else.
 * An ISO instant, the `yyyy-MM-dd` a date field speaks, a CSV cell, an id, a
 * firmware version and a co-ordinate in an SVG path are all machine input, and
 * a German decimal comma in one of them either splits a column that was never
 * meant to be split or, in a path, draws nothing. So the writer above is a
 * display path only: the sweep checks it has not been reached for where the
 * string is going somewhere other than a pair of eyes.
 */
describe('the figures that must stay English', () => {
  const MACHINE = [
    'src/api/exports.ts',
    'src/charts/series.ts',
    'src/screens/home/Sparkline.tsx',
    'src/screens/space/Overview.tsx',
    'src/ui/days.ts',
  ];

  const files = (from: string): string[] =>
    readdirSync(resolve(process.cwd(), from), { withFileTypes: true }).flatMap(entry =>
      entry.isDirectory() ? files(`${from}/${entry.name}`) : /\.tsx?$/.test(entry.name) ? [`${from}/${entry.name}`] : [],
    );

  it('keeps the reader´s decimal out of the paths, the exports and the date fields', () => {
    const reaching = MACHINE.filter(path => /\bdecimalFigure\(|\blooseFigure\(/.test(readFileSync(resolve(process.cwd(), path), 'utf8')));

    expect(reaching).toEqual([]);
  });

  it('is the only writer the reading screens use, so that none of them decimates on its own again', () => {
    const own = files('src')
      .filter(path => !MACHINE.includes(path) && !path.startsWith('src/ui/figures.ts'))
      .filter(path => /\.toFixed\(/.test(readFileSync(resolve(process.cwd(), path), 'utf8')));

    // `screens/home/units.ts` rounds with `toFixed` and writes with the shared
    // writer, which is the order that keeps the arithmetic out of the reader's
    // hands; `control/targets` is the one reading still written straight and is
    // held open by another pass over this same defect.
    expect(own).toEqual(['src/screens/control/targets/Targets.tsx', 'src/screens/home/units.ts']);
  });
});
