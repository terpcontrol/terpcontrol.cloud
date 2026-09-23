import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import i18next from 'i18next';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
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

  it('still translates what a device wrote, which is a key and not words', () => {
    render(
      <ul>
        <EntryRow entry={entryOf({ kind: 'system', source: 'device', authorId: null, text: null, message: { key: 'message-co2-low', params: [] } })} people={[]} />
      </ul>,
    );

    expect(screen.getByText(/Low CO2/)).toBeInTheDocument();
  });
});
