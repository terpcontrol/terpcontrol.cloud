import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import i18next from 'i18next';
import { DateTime, Settings } from 'luxon';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Device, PendingSettings } from '@fg2/shared-types/v1';
import { api } from '@/api/client';
import type { Told } from '@/log/log-context';
import { ModePage } from '@/screens/control/Mode';
import { hasMode, modeLine } from '@/screens/control/rows';
import { drawAt } from './harness';
import { Toast } from './toast';
import { translate } from './translations';

/**
 * Betriebsart, the page behind its row under Steuerung: the work modes no
 * climate preset sets, chosen on a sheet and answered by the toast; a
 * fridge's energy saving; a mode the preset set, read with the way to the
 * preset; and control switched off, with the one tap that switches it on.
 */

vi.mock('@/api/client', () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

vi.mock('@/api/session', async importOriginal => {
  const { SIGNED_IN } = await import('./session');
  return { ...(await importOriginal<object>()), useSession: () => SIGNED_IN };
});

const CONTROL = { running: true, drying: false, mode: 'standard', energySaving: false } as NonNullable<Device['control']>;

const device = (type = 'fridge', over: Partial<Device> = {}, lastSeenAt = DateTime.now().toISO()): Device =>
  ({
    id: 'device-1',
    type,
    name: 'Fridge',
    spaceId: 'space-1',
    configuration: { workmode: 'small', night: { temperature: 21, humidity: 55 } },
    settings: { vpdLeafOffsetDay: -2, vpdLeafOffsetNight: 0, ppfdLuxFactor: 0.015 },
    control: CONTROL,
    state: { lastSeenAt, hardware: {}, socketStateChangedAt: {}, socketsReportedAt: null, maintenanceUntil: null },
    ...over,
  }) as Device;

/** What the device's live read says it has not been handed; nothing else of the API answers. */
const live = (pending: PendingSettings | null) =>
  vi
    .mocked(api.get)
    .mockImplementation((path: string) =>
      path === '/devices/device-1/live' && pending
        ? (Promise.resolve({ deviceId: 'device-1', metrics: {}, outputs: {}, setpoints: null, pending }) as never)
        : (Promise.reject(new Error(`no stub for ${path}`)) as never),
    );

const told: Told[] = [];
const said = () => told[0]?.label.replace(/\u00a0/g, ' ');

const draw = (one: Device, mayManage = true) =>
  drawAt(
    <Toast told={told}>
      <ModePage spaceId="space-1" devices={[one]} mayManage={mayManage} />
    </Toast>,
  );

const t = (key: string, options?: Record<string, unknown>) => i18next.t(key, options);

beforeAll(async () => {
  Settings.defaultZone = 'utc';
  await translate();
});

afterAll(() => {
  Settings.defaultZone = 'system';
});

beforeEach(() => {
  vi.mocked(api.patch).mockReset();
  vi.mocked(api.patch).mockResolvedValue(device() as never);
  live(null);
  told.length = 0;
});

afterEach(() => {
  Settings.now = () => Date.now();
});

describe('the work mode', () => {
  /** Greenhouse stops holding the humidity, so the sheet says what it does before anything is written. */
  it('offers a fridge the modes no preset sets on a sheet, says what the other one does, and answers with the way back', async () => {
    draw(device());

    fireEvent.click(screen.getByRole('button', { name: 'Change Operating mode, Standard' }));
    const sheet = screen.getByRole('dialog', { name: 'Operating mode' });
    expect(within(sheet).getByRole('button', { name: 'Standard' })).toHaveAttribute('aria-pressed', 'true');
    // Germination and drying follow the stage: the climate preset is where they are set.
    expect(within(sheet).queryByRole('button', { name: /Germination|Drying/ })).not.toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Greenhouse' }));
    expect(
      within(sheet).getByText(/^Temperature only: light and CO₂ run, the compressor only cools, humidity is not controlled\.$/),
    ).toBeInTheDocument();
    expect(api.patch).not.toHaveBeenCalled();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/devices/device-1/configuration', { set: { mode: 'greenhouse' } }));
    await waitFor(() => expect(said()).toBe('Operating mode Greenhouse · saved'));
    await act(async () => {
      await told[0].undo!();
    });
    expect(api.patch).toHaveBeenLastCalledWith('/devices/device-1/configuration', { set: { mode: 'standard' } });
  });

  it('switches a fridge’s energy saving on the tap, in its standard mode only, and answers', async () => {
    const view = draw(device());
    fireEvent.click(screen.getByRole('switch', { name: 'Energy saving' }));
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/devices/device-1/configuration', { set: { energySaving: true } }));
    await waitFor(() => expect(said()).toBe('Energy saving on · saved'));
    view.unmount();

    draw(device('fridge', { control: { ...CONTROL, mode: 'greenhouse' } }));
    expect(screen.queryByRole('switch', { name: 'Energy saving' })).not.toBeInTheDocument();
  });

  /** The stage decides the work mode: a drying spell or a germination is ended where it was begun, with the climate preset. */
  it('reads a mode the climate preset set, with the way to the preset and nothing to choose', () => {
    for (const control of [
      { ...CONTROL, drying: true },
      { ...CONTROL, mode: 'germination' },
    ] as NonNullable<Device['control']>[]) {
      const view = draw(device('fridge', { control }));

      expect(screen.getByText(control.drying ? 'Drying' : 'Germination · dark')).toBeInTheDocument();
      expect(screen.getByRole('link', { name: /^Change the climate preset/ })).toHaveTextContent('set by the climate preset');
      expect(screen.queryByRole('button', { name: /^Change Operating mode/ })).not.toBeInTheDocument();
      expect(screen.queryByRole('switch')).not.toBeInTheDocument();
      view.unmount();
    }
  });

  it('has nothing to choose for a tent controller, whose row and page are not drawn', () => {
    // Its modes beside the standard are germination and drying, and those are the preset's.
    expect(hasMode(device('controller'))).toBe(false);
    expect(hasMode(device('fridge'))).toBe(true);
    expect(hasMode(device('plug', { control: null }))).toBe(false);

    const { container } = draw(device('controller'));
    expect(container.querySelector('section')).toBeNull();
  });

  it('says in its row what runs and what else the page offers, or that the preset set it', () => {
    expect(modeLine(t, device())).toEqual({ text: 'Standard · also Greenhouse, Energy saving', warn: false });
    expect(modeLine(t, device('fridge', { control: { ...CONTROL, mode: 'greenhouse' } }))).toMatchObject({
      text: 'Greenhouse · also Standard, Energy saving',
      warn: true,
    });
    expect(modeLine(t, device('fridge', { control: { ...CONTROL, drying: true } }))).toEqual({
      text: 'Drying · set by the climate preset',
      warn: true,
    });
  });

  /** A mode stored for a silent device is stored and not yet taken: the page says what the device still runs, and the toast that it takes it over. */
  it('says a mode stored for a silent device as stored, with the mode the device still runs', async () => {
    Settings.now = () => Date.parse('2026-09-19T15:00:00.000Z');
    live({ since: '2026-09-19T13:00:00.000Z', settings: [{ field: 'workmode', held: 'small', savedAt: '2026-09-19T14:31:00.000Z' }] });
    draw(device('fridge', { control: { ...CONTROL, mode: 'greenhouse' } }, '2026-09-19T13:00:00.000Z'));

    expect(
      await screen.findByText('Operating mode: Greenhouse saved at 14:31. The device still runs Standard until it is back online.'),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Change Operating mode, Greenhouse/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Standard' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(said()).toBe('Operating mode Standard · saved, Fridge takes it over when it next connects'));
  });
});

describe('control switched off', () => {
  it('is said instead of a mode, with the one tap that switches it on and is answered', async () => {
    draw(device('fridge', { control: { ...CONTROL, running: false } }));

    expect(screen.getByText('Control off.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Change Operating mode/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Switch control on' }));
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/devices/device-1/configuration', { set: { control: true } }));
    await waitFor(() => expect(said()).toBe('Control on · saved'));
  });

  /** A control the reader may not use is absent: the mode is a fact, and no choice is drawn that they could not make. */
  it('offers a session that may only look nothing that writes', () => {
    const { unmount } = draw(device('fridge', { control: { ...CONTROL, running: false } }), false);
    expect(screen.queryByRole('button', { name: 'Switch control on' })).not.toBeInTheDocument();
    unmount();

    draw(device('fridge', { control: { ...CONTROL, energySaving: true } }), false);
    expect(screen.getByRole('region', { name: 'Operating mode' })).toHaveTextContent('Operating modeStandardEnergy savingon');
    expect(screen.queryByRole('button', { name: /^Change|Save/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
  });
});
