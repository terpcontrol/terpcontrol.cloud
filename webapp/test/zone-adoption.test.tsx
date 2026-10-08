import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
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
  useMe: () => ({ data: { preferences: state.preferences } }),
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

beforeAll(() => translate());

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
    expect(screen.getByRole('link', { name: 'Change it' })).toHaveAttribute('href', '/me/appearance');
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
 * What the server writes itself - the day counter burnt into a film - is in the
 * language the account was last used in, so the account is told it.
 */
describe('the language the app is used in', () => {
  it('is told to an account that last heard another, without a word on screen', () => {
    state.preferences = { units, locale: 'de', timezone: 'UTC', timezoneChosen: true };
    draw();

    expect(state.sent).toEqual([{ preferences: { locale: 'en' } }]);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
