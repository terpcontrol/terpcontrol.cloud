import { cleanup, render, screen, waitFor } from '@testing-library/react';
import i18next from 'i18next';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ZoneAdoption } from '@/app/shell/ZoneAdoption';
import { translate } from './translations';

/**
 * Every account starts on UTC and every migrated one was given it, so a grower
 * in Germany read every clock in the app two hours early. An account whose zone
 * nobody picked takes the zone of the device it is signed in on, once, and
 * says so; a zone somebody picked is never touched.
 */

const state = vi.hoisted(() => ({
  preferences: {} as Record<string, unknown>,
  here: 'Europe/Berlin' as string | null,
  mayManage: true,
  sent: [] as unknown[],
}));

vi.mock('@/api/account', () => ({
  useAccountMe: () => ({ data: { preferences: state.preferences } }),
  useUpdateMe: () => ({
    mutate: (body: unknown, options?: { onSuccess?: () => void }) => {
      state.sent.push(body);
      options?.onSuccess?.();
    },
  }),
}));

vi.mock('@/ui/session-access', () => ({ useMayManage: () => state.mayManage }));

vi.mock('@/ui/zone', () => ({ browserZone: () => state.here }));

const units = { temperature: 'celsius', weight: 'grams', volume: 'liters' };

const draw = () =>
  render(
    <MemoryRouter>
      <ZoneAdoption />
    </MemoryRouter>,
  );

// Both catalogues: following the account's language fetches none that is already here.
beforeAll(() => translate(['en', 'de']));

beforeEach(() => {
  state.preferences = { units, locale: 'en', timezone: 'UTC', timezoneChosen: false };
  state.here = 'Europe/Berlin';
  state.mayManage = true;
  state.sent = [];
});

describe('an account whose zone nobody picked', () => {
  it('takes the zone of this device, marks it picked, and says so with the way back', () => {
    draw();

    // The zone alone: whatever else the app writes in the same moment is kept beside it.
    expect(state.sent).toEqual([{ preferences: { timezone: 'Europe/Berlin', timezoneChosen: true } }]);
    expect(screen.getByRole('status')).toHaveTextContent('Clock times now follow Europe/Berlin');
    expect(screen.getByRole('status')).toHaveTextContent('still on UTC');
    expect(screen.getByRole('link', { name: 'Change it' })).toHaveAttribute('href', '/me/account');
  });

  it('asks nothing where the device is in the zone the account already has', () => {
    state.here = 'UTC';
    draw();

    expect(state.sent).toEqual([]);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('leaves the account alone for a session that may not change it', () => {
    state.mayManage = false;
    draw();

    expect(state.sent).toEqual([]);
  });
});

describe('an account whose zone somebody picked', () => {
  it('is never moved, not even off UTC', () => {
    state.preferences = { units, locale: 'en', timezone: 'UTC', timezoneChosen: true };
    draw();

    expect(state.sent).toEqual([]);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});

/**
 * The account keeps the language chosen in a browser - what the server writes
 * itself, the day counter burnt into a film, is in it - and a browser nobody
 * chose one in follows the account instead of overwriting it.
 */
describe('the language the app is used in', () => {
  const picked = { units, locale: 'de', timezone: 'UTC', timezoneChosen: true };

  afterEach(async () => {
    // Taken down first: a page still up would follow its account back.
    cleanup();
    localStorage.clear();
    await i18next.changeLanguage('en');
  });

  it('is told to the account by a browser it was chosen in, without a word on screen', () => {
    localStorage.setItem('terp.language', 'en');
    state.preferences = picked;
    draw();

    expect(state.sent).toEqual([{ preferences: { locale: 'en' } }]);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it("is the account's in a browser that chose none, kept for its next first frame and not as its choice", async () => {
    state.preferences = picked;
    draw();

    await waitFor(() => expect(i18next.language).toBe('de'));
    expect(state.sent).toEqual([]);
    expect(localStorage.getItem('terp.language')).toBeNull();
    expect(localStorage.getItem('terp.language.account')).toBe('de');
  });

  it("is this browser's for an account no browser was signed in to yet, which knows none", () => {
    state.preferences = { units, locale: 'de', timezone: 'UTC', timezoneChosen: false };
    draw();

    expect(state.sent).toContainEqual({ preferences: { locale: 'en' } });
    expect(i18next.language).toBe('en');
  });
});
