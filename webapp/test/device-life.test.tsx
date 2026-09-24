import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import i18next from 'i18next';
import { DateTime } from 'luxon';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { initReactI18next } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccessNeed, Device } from '@fg2/shared-types/v1';
import { api } from '@/api/client';
import { DeviceList } from '@/screens/devices/DeviceList';
import { spaceWhere, THE_HOST } from './session';

/**
 * What a grower may do to a device once it is theirs: call it something, and
 * put it where it really stands.
 *
 * Both are `PATCH /devices/{id}`, which the app never called: the row's title
 * fell back to the type and the tail of the id for want of a name nothing could
 * give, and a device that landed in the wrong place could only be moved from
 * inside the claim flow, by an address nothing links to. The two are tested
 * together because they are one absence seen from two sides, and because the
 * sheet writes them differently on purpose - a name is typed and saved, a place
 * is written on the tap.
 */

vi.mock('@/api/client', () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn(), upload: vi.fn() },
}));

vi.mock('@/api/session', async importOriginal => {
  const { SIGNED_IN } = await import('./session');

  return { ...(await importOriginal<object>()), mediaUrl: (id: string) => `/media/${id}`, useSession: () => SIGNED_IN };
});

const NOW = DateTime.fromISO('2026-09-19T12:00:00.000Z');

const THE_PLUG = {
  id: 'device-1',
  type: 'plug',
  name: null,
  ownerId: THE_HOST,
  spaceId: 'space-1',
  configuration: null,
  firmware: { channel: 'manual', targetId: null },
  state: { lastSeenAt: NOW.minus({ seconds: 20 }).toISO()!, firmwareId: null, hardware: {} },
} as unknown as Device;

const ELSEWHERE = spaceWhere('own', { id: 'space-2', name: 'Fridge 1', kind: 'fridge' });

const wrap = (children: React.ReactNode) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>,
  );

/** The account-wide Devices tab, with the plug standing in a place the reader may do `youMay` in. */
const drawTab = async (youMay: AccessNeed = 'own') => {
  vi.mocked(api.get).mockImplementation((path: string) => {
    if (path === '/devices') return Promise.resolve({ items: [THE_PLUG], nextCursor: null }) as never;
    if (path === '/cameras') return Promise.resolve({ items: [], nextCursor: null }) as never;
    if (path === '/spaces') return Promise.resolve({ items: [spaceWhere(youMay), ELSEWHERE], nextCursor: null }) as never;
    if (path === '/me') return Promise.resolve({ premium: { enforced: true } }) as never;
    if (path.endsWith('/sockets')) return Promise.resolve({ items: [], capabilities: {} }) as never;

    return Promise.resolve({ items: [], nextCursor: null }) as never;
  });
  vi.mocked(api.patch).mockImplementation((_path: string, body: unknown) => Promise.resolve({ ...THE_PLUG, ...(body as object) }) as never);

  wrap(<DeviceList />);
  fireEvent.click(await screen.findByRole('button', { name: /^What Plug · / }));
};

beforeAll(async () => {
  const translation = JSON.parse(await readFile(resolve(process.cwd(), 'public/assets/i18n/en.json'), 'utf8'));
  await i18next
    .use(initReactI18next)
    .init({ lng: 'en', resources: { en: { translation } }, nsSeparator: false, interpolation: { escapeValue: false } });
});

beforeEach(() => {
  vi.mocked(api.patch).mockClear();
});

describe('naming a device and moving it', () => {
  it('offers the correction in the panel that prints the facts it corrects', async () => {
    await drawTab();

    expect(await screen.findByRole('button', { name: 'Rename or move' })).toBeInTheDocument();
  });

  /** The row is drawn from every place at once, so what may be done is the device's answer and not the screen's. */
  it('offers it to nobody who may only write lines where the device stands', async () => {
    await drawTab('log');

    expect(screen.queryByRole('button', { name: 'Rename or move' })).not.toBeInTheDocument();
  });

  it('writes the typed name to the device, and nothing until it is saved', async () => {
    await drawTab();
    fireEvent.click(await screen.findByRole('button', { name: 'Rename or move' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: '  East lamp  ' } });

    expect(api.patch).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Save the name' }));

    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/devices/device-1', { name: 'East lamp' }));
  });

  /**
   * An empty field is a device with no name of its own rather than one called
   * nothing: the list then falls back to the type and the characters printed on
   * the hardware, which is the state every unnamed device is already in.
   */
  it('gives a named device its fallback back when the field is emptied', async () => {
    vi.mocked(api.get).mockImplementation((path: string) => {
      if (path === '/devices') return Promise.resolve({ items: [{ ...THE_PLUG, name: 'East lamp' }], nextCursor: null }) as never;
      if (path === '/cameras') return Promise.resolve({ items: [], nextCursor: null }) as never;
      if (path === '/spaces') return Promise.resolve({ items: [spaceWhere('own'), ELSEWHERE], nextCursor: null }) as never;
      if (path === '/me') return Promise.resolve({ premium: { enforced: true } }) as never;
      if (path.endsWith('/sockets')) return Promise.resolve({ items: [], capabilities: {} }) as never;

      return Promise.resolve({ items: [], nextCursor: null }) as never;
    });
    wrap(<DeviceList />);
    fireEvent.click(await screen.findByRole('button', { name: 'What East lamp is' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Rename or move' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save the name' }));

    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/devices/device-1', { name: null }));
  });

  it('moves the device into another place it is not standing in, on the tap', async () => {
    await drawTab();
    fireEvent.click(await screen.findByRole('button', { name: 'Rename or move' }));
    fireEvent.click(screen.getByRole('button', { name: 'Fridge 1' }));

    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/devices/device-1', { spaceId: 'space-2' }));
  });

  it('says which place it is standing in now, so a move is a correction and not a guess', async () => {
    await drawTab();
    fireEvent.click(await screen.findByRole('button', { name: 'Rename or move' }));

    expect(screen.getByRole('button', { name: 'Tent 1' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Fridge 1' })).toHaveAttribute('aria-pressed', 'false');
  });
});
