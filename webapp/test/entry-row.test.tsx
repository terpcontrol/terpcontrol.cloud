import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import i18next from 'i18next';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DateTime } from 'luxon';
import { initReactI18next } from 'react-i18next';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { Entry } from '@fg2/shared-types/v1';
import { EntryRow } from '@/ui/EntryRow';

vi.mock('@/api/session', async importOriginal => {
  const { SIGNED_IN } = await import('./session');

  return { ...(await importOriginal<object>()), mediaUrl: (id: string) => `/media/${id}`, useSession: () => SIGNED_IN };
});

/**
 * One line of a diary, wherever it is drawn.
 *
 * The rows here are the shapes the restored production database actually holds:
 * a line migrated from the old app carries that app's label for the kind of
 * thing in `message` *and* the sentence its author typed in `text`, and a line
 * a device wrote carries only the key. What the row must never do is prefer the
 * label - the label is a translation of the mark already drawn beside it, and
 * the sentence is the only part of the line nobody else can write again.
 */

/** An entry as the server serialises one, with the fields a row reads named by the caller. */
const entryOf = (over: Partial<Entry>): Entry => ({
  id: 'entry-1',
  createdAt: '2026-09-15T22:08:23.000Z',
  kind: 'note',
  occurredAt: '2026-09-15T21:56:00.000Z',
  source: 'human',
  authorId: 'user-1',
  growId: 'grow-1',
  spaceId: 'space-1',
  deviceId: null,
  plantIds: [],
  cameraId: null,
  taskId: null,
  alertId: null,
  severity: null,
  text: null,
  message: null,
  values: { kind: 'note' },
  mediaIds: [],
  undoUntil: null,
  ...over,
});

beforeAll(async () => {
  const translation = JSON.parse(await readFile(resolve(process.cwd(), 'public/assets/i18n/en.json'), 'utf8'));
  await i18next
    .use(initReactI18next)
    .init({ lng: 'en', resources: { en: { translation } }, nsSeparator: false, interpolation: { escapeValue: false } });
});

describe('a diary row', () => {
  it('draws the words a grower typed, not the migration label that came with them', () => {
    render(
      <ul>
        <EntryRow entry={entryOf({ text: 'Super Cropping', message: { key: 'message-diary-plant-log', params: [] } })} people={[]} />
      </ul>,
    );

    expect(screen.getByText(/Super Cropping/)).toBeInTheDocument();
    expect(screen.queryByText(/Plant log entry/)).not.toBeInTheDocument();
  });

  it('keeps the line breaks in a note that was written in several lines', () => {
    render(
      <ul>
        <EntryRow
          entry={entryOf({
            text: 'Scrog-Netz eingesetzt\n2. Ventilator eingeschaltet',
            message: { key: 'message-diary-plant-log', params: [] },
          })}
          people={[]}
        />
      </ul>,
    );

    const said = screen.getByText(/Scrog-Netz eingesetzt/);
    expect(said.textContent).toBe('Scrog-Netz eingesetzt\n2. Ventilator eingeschaltet');
  });

  it('draws the pictures the line carries, and says how many more it has than it drew', () => {
    render(
      <ul>
        <EntryRow entry={entryOf({ text: 'Steckling von Sensi Seeds', mediaIds: ['one', 'two', 'three', 'four', 'five', 'six'] })} people={[]} />
      </ul>,
    );

    expect(screen.getAllByRole('img')).toHaveLength(4);
    expect(screen.getByText('+2')).toBeInTheDocument();
  });

  it('asks the surface it is drawn on for the address of a picture, rather than assuming a session', () => {
    render(
      <ul>
        <EntryRow entry={entryOf({ mediaIds: ['one'] })} people={[]} picture={mediaId => `/v1/public/grows/mimosa/media/${mediaId}`} />
      </ul>,
    );

    expect(screen.getByRole('img')).toHaveAttribute('src', '/v1/public/grows/mimosa/media/one');
  });

  /**
   * A tent's latest lines sit under no heading that dates them and have no lower
   * bound on age, so a bare weekday reads as this week however old the line is.
   */
  describe('the stamp on a list that reaches back as far as the tent has been quiet', () => {
    const NOW = DateTime.fromISO('2026-09-23T12:00:00');
    const drawnAt = (at: DateTime) =>
      render(
        <ul>
          <EntryRow entry={entryOf({ occurredAt: at.toISO()! })} people={[]} now={NOW} />
        </ul>,
      ).container.querySelector('span')!.textContent;

    it('says the hour alone for a line written today', () => {
      expect(drawnAt(NOW.minus({ hours: 3 }))).toBe('09:00');
    });

    it('says the weekday while that weekday still means one day', () => {
      expect(drawnAt(NOW.minus({ days: 2 }))).toBe('Mon 12:00');
    });

    it('says the date for a line a week old, rather than today´s weekday again', () => {
      expect(drawnAt(NOW.minus({ days: 7 }))).toBe('16 Sep 12:00');
    });

    it('says the date for a line nine days old, which read as two', () => {
      expect(drawnAt(NOW.minus({ days: 9 }))).toBe('14 Sep 12:00');
    });

    it('says the year as well once the line is not of this one', () => {
      expect(drawnAt(NOW.minus({ years: 1 }))).toBe('23 Sep 2025 12:00');
    });
  });

  it('names the stage a phase line entered, whatever heading arrived with it', () => {
    render(
      <ul>
        <EntryRow
          entry={entryOf({
            kind: 'phase',
            values: { kind: 'phase', stage: 'vegetative', phaseId: 'phase-1', preset: null },
            message: { key: 'message-diary-plant-lifecycle', params: [] },
          })}
          people={[]}
        />
      </ul>,
    );

    expect(screen.getByText(/Entered Veg/)).toBeInTheDocument();
    expect(screen.queryByText(/Plant phase change/)).not.toBeInTheDocument();
  });

  it('puts a note written under a phase line after the stage rather than in place of it', () => {
    render(
      <ul>
        <EntryRow
          entry={entryOf({
            kind: 'phase',
            values: { kind: 'phase', stage: 'germination', phaseId: 'phase-1', preset: null },
            text: 'Steckling von Sensi Seeds',
          })}
          people={[]}
        />
      </ul>,
    );

    expect(screen.getByText(/Entered Germination · Steckling von Sensi Seeds/)).toBeInTheDocument();
  });

  it('still translates what a device wrote, which is a key and not words', () => {
    render(
      <ul>
        <EntryRow
          entry={entryOf({ kind: 'system', source: 'device', authorId: null, text: null, message: { key: 'message-co2-low', params: [] } })}
          people={[]}
        />
      </ul>,
    );

    expect(screen.getByText(/Low CO2/)).toBeInTheDocument();
  });
});

/**
 * A machine writes a key and the parameters that make it one event rather than
 * a category. The restored production database holds 33,059 lines keyed
 * `message-alarm-triggered` and 49,971 keyed `message-alarm-resolved`, every one
 * of which draws the same two words until the parameters are drawn with them.
 */
describe('what a machine´s line says under its headline', () => {
  const said = (over: Partial<Entry>) =>
    render(
      <ul>
        <EntryRow entry={entryOf({ kind: 'alarm', source: 'device', authorId: null, text: null, ...over })} people={[]} />
      </ul>,
    );

  it('draws the reading and the thresholds an alarm tripped on, not only that an alarm was raised', () => {
    said({ message: { key: 'message-alarm-triggered', params: ['Temperatur (temperature), value=16.87, lower threshold=20'] } });

    expect(screen.getByText('Alarm triggered')).toBeInTheDocument();
    expect(screen.getByText(/lower threshold=20/)).toBeInTheDocument();
  });

  it('tells two alarms of one night apart, which the headline alone cannot', () => {
    const first = said({ message: { key: 'message-alarm-triggered', params: ['Temperatur (temperature), lower threshold=20'] } });
    const second = said({ message: { key: 'message-alarm-triggered', params: ['Temperatur (temperature), lower threshold=15'] } });

    expect(first.container.textContent).not.toBe(second.container.textContent);
  });

  it('names the step a recipe advanced to', () => {
    said({ kind: 'plan', source: 'plan', message: { key: 'message-recipe-advanced', params: ['10 (Blütewoche 4)'] } });

    expect(screen.getByText(/step 10 \(Blütewoche 4\)/)).toBeInTheDocument();
  });

  it('keeps the settings a saved configuration changed on the lines they arrived in', () => {
    said({ kind: 'system', message: { key: 'message-device-configuration-updated', params: ['day.humidity: 60 -> 58\nlights.limit: 55 -> 60'] } });

    expect(screen.getByText(/day\.humidity: 60 -> 58/).textContent).toContain('lights.limit: 55 -> 60');
  });

  it('says nothing more where the key carries no parameters, because its text only restates its title', () => {
    const { container } = said({ kind: 'system', message: { key: 'message-diary-plant-log', params: [] } });

    expect(container.textContent).toContain('Plant log entry');
    expect(container.textContent).not.toContain('A line written in the diary of the plants.');
  });

  it('does not print a grower´s own paragraph a second time under itself', () => {
    render(
      <ul>
        <EntryRow
          entry={entryOf({
            kind: 'phase',
            values: { kind: 'phase', stage: 'drying', phaseId: 'phase-1', preset: null },
            text: 'Alles abgeerntet und aufgehängt',
            message: { key: 'message-diary-plant-lifecycle', params: ['drying'] },
          })}
          people={[]}
        />
      </ul>,
    );

    expect(screen.getAllByText(/Alles abgeerntet und aufgehängt/)).toHaveLength(1);
  });
});

/**
 * A row draws four thumbnails and says how many more it carries. One migrated
 * phase line of the restored production database carries seventeen, and until
 * the "+13" opened something the other thirteen were in the export zip and
 * nowhere else - while the grow's own Report counted all of them.
 */
describe('the pictures past the fourth', () => {
  const SEVENTEEN = Array.from({ length: 17 }, (_, index) => `media-${index + 1}`);
  const withPictures = (over: Parameters<typeof entryOf>[0] = {}) =>
    render(
      <ul>
        <EntryRow entry={entryOf({ text: 'Entered Drying', mediaIds: SEVENTEEN, ...over })} people={[]} />
      </ul>,
    );

  it('opens a viewer on the picture whose thumbnail was pressed', () => {
    withPictures();
    fireEvent.click(screen.getAllByRole('img')[1]);

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAccessibleName('Picture 2 of 17');
    expect(dialog.querySelector('img')).toHaveAttribute('src', '/media/media-2');
  });

  it('opens on the first picture the row had no room for when the count is pressed', () => {
    withPictures();
    fireEvent.click(screen.getByText('+13'));

    expect(screen.getByRole('dialog')).toHaveAccessibleName('Picture 5 of 17');
  });

  it('steps through to the seventeenth, which is what the row could not draw', () => {
    withPictures();
    fireEvent.click(screen.getByText('+13'));
    for (let step = 0; step < 12; step += 1) fireEvent.click(screen.getByRole('button', { name: 'Next picture' }));

    expect(screen.getByRole('dialog')).toHaveAccessibleName('Picture 17 of 17');
    expect(screen.getByRole('button', { name: 'Next picture' })).toBeDisabled();
  });

  it('closes on Escape and leaves the row as it found it', () => {
    withPictures();
    fireEvent.click(screen.getByText('+13'));
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  /**
   * A share link narrowed to a few days refuses the pictures taken outside it,
   * picture by picture, and the strip leaves their frames out. The viewer steps
   * over exactly those rather than opening on a frame it cannot fill.
   */
  it('steps over the pictures the surface refuses, and numbers what is left', () => {
    render(
      <ul>
        <EntryRow
          entry={entryOf({ mediaIds: ['one', 'two', 'three'] })}
          people={[]}
          picture={mediaId => (mediaId === 'two' ? null : `/link/${mediaId}`)}
        />
      </ul>,
    );

    fireEvent.click(screen.getByAltText('Picture 3 of 3'));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAccessibleName('Picture 2 of 2');
    expect(dialog.querySelector('img')).toHaveAttribute('src', '/link/three');
  });
});
