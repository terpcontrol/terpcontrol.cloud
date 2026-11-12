import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { DateTime, Settings } from 'luxon';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Co2Report, Device, Entry, SocketPage } from '@fg2/shared-types/v1';
import { api } from '@/api/client';
import type { Told } from '@/log/log-context';
import { daysLeftOf, items as co2Items } from '@/screens/devices/advanced/Co2Report.advanced';
import { itemsFor } from '@/ui/advanced/registry';
import { EntryRow } from '@/ui/EntryRow';
import { drawAt } from './harness';
import { Toast } from './toast';
import { translate } from './translations';

/**
 * The settings few growers need, under Erweitert on the device's own page:
 * the lamp's ramps, a fridge's maintenance light and its compressor's rest, the
 * leaf offsets and the lux factor the cloud works VPD and PPFD out with, and
 * the CO2 cylinder at the place.
 */

vi.mock('@/api/client', () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

vi.mock('@/api/session', async importOriginal => {
  const { SIGNED_IN } = await import('./session');
  return { ...(await importOriginal<object>()), useSession: () => SIGNED_IN };
});

const device = (type = 'fridge', hardware: Record<string, string> = {}, over: Partial<Device> = {}): Device =>
  ({
    id: 'device-1',
    type,
    name: 'Fridge',
    spaceId: 'space-1',
    configuration: { workmode: 'small', lights: { limit: 80, sunrise: 15, sunset: 15, maintenanceOn: 0 }, fans: { external: 100, internal: 100 } },
    settings: { vpdLeafOffsetDay: -2, vpdLeafOffsetNight: 0, ppfdLuxFactor: 0.015 },
    control: type === 'fridge' || type === 'controller' ? { running: true, drying: false, mode: 'standard', energySaving: false } : null,
    state: { lastSeenAt: DateTime.now().toISO(), hardware, socketStateChangedAt: {}, socketsReportedAt: null, maintenanceUntil: null },
    ...over,
  }) as Device;

const ids = (one: Device, mayManage = true) => itemsFor('device', { device: one, mayManage, offline: false }).map(item => item.id);

/** When a silent device was last heard. */
const HEARD = '2026-09-19T13:00:00.000Z';

/** What the toast was told: the line, and the way it is taken back. */
const told: Told[] = [];
const said = () => told[0]?.label.replace(/\u00a0/g, ' ');

beforeAll(async () => {
  Settings.defaultZone = 'utc';
  await translate();
});

afterAll(() => {
  Settings.defaultZone = 'system';
});

beforeEach(() => {
  vi.mocked(api.get).mockReset();
  // Nothing answers but what a test stubs: a read that fails is not a read that answers nothing.
  vi.mocked(api.get).mockRejectedValue(new Error('no stub'));
  vi.mocked(api.post).mockReset();
  vi.mocked(api.patch).mockReset();
  told.length = 0;
});

afterEach(() => {
  Settings.now = () => Date.now();
});

describe('what Erweitert offers a device', () => {
  /** The work mode, the fans and continuing a plan are Steuerung's; the update channel is the device page's firmware card. */
  it('offers a fridge its ramps, its maintenance light, CO2 at night, its compressor rest, its leaf offsets and the cylinder', () => {
    expect(ids(device())).toEqual(['light-ramps', 'maintenance-light', 'co2-night', 'compressor-rest', 'leaf-offsets', 'co2-report']);
  });

  it('offers a tent controller the ramps its lamp runs on, and the lux factor only where it measures light', () => {
    expect(ids(device('controller'))).toEqual(['light-ramps', 'leaf-offsets', 'co2-report']);
    expect(ids(device('controller', { ppfd: 'on' }))).toContain('lux-factor');
  });

  it('offers CO2 at night only where the device doses: a CO2 sensor, and a valve - a socket on a tent controller', () => {
    const withSockets = (one: Device, roles: string[]) =>
      itemsFor('device', {
        device: one,
        mayManage: true,
        offline: false,
        sockets: { items: roles.map(role => ({ role })), nextCursor: null, capabilities: {} } as unknown as SocketPage,
      }).map(item => item.id);

    expect(ids(device('fridge'))).toContain('co2-night');
    expect(ids(device('fridge', { co2: 'off' }))).not.toContain('co2-night');
    expect(withSockets(device('controller'), ['co2'])).toContain('co2-night');
    expect(withSockets(device('controller'), ['light', 'heater'])).not.toContain('co2-night');
    expect(withSockets(device('controller', { co2: 'off' }), ['co2'])).not.toContain('co2-night');
  });

  it('offers nothing to tune before the device has sent its document, and none of this to a lamp or a plug', () => {
    expect(ids(device('fridge', {}, { configuration: null }))).not.toContain('light-ramps');
    // A LIGHT and a smart socket have fine settings of their own, which stand
    // under Erweitert in their own panels; a fridge's are not among them.
    expect(ids(device('light'))).toEqual(['light-ramp', 'light-overheat']);
    expect(ids(device('plug'))).toEqual(['plug-protections']);
  });
});

describe('the fine settings themselves', () => {
  /** An item of Erweitert, drawn for a device as its page draws it. */
  const drawItem = (id: string, one: Device = device()) => {
    const { Item } = itemsFor('device', { device: one, mayManage: true, offline: false }).find(item => item.id === id)!;
    return drawAt(
      <Toast told={told}>
        <Item device={one} mayManage offline={false} />
      </Toast>,
    );
  };
  const sheet = () => screen.getByRole('dialog');
  const save = () => fireEvent.click(within(sheet()).getByRole('button', { name: 'Save' }));
  const type = (name: string, to: string) => {
    const field = within(sheet()).getByRole('spinbutton', { name });
    fireEvent.change(field, { target: { value: to } });
    fireEvent.blur(field);
  };

  it('are lines that open the value sheet, held to the range of the type, saved by name and taken back from the toast', async () => {
    vi.mocked(api.patch).mockResolvedValue(device() as never);
    drawItem('light-ramps');

    fireEvent.click(screen.getByRole('button', { name: 'Change Sunrise, 15 min' }));
    expect(within(sheet()).getByRole('button', { name: 'Save' })).toBeDisabled();
    // A figure typed past the range lands on its end.
    type('Sunrise', '90');
    expect(within(sheet()).getByRole('spinbutton', { name: 'Sunrise' })).toHaveValue('60');
    type('Sunrise', '30');
    save();

    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/devices/device-1/configuration', { set: { sunrise: 30 } }));
    await waitFor(() => expect(said()).toBe('Sunrise 30 min · saved'));
    await act(async () => {
      await told[0].undo!();
    });
    expect(api.patch).toHaveBeenLastCalledWith('/devices/device-1/configuration', { set: { sunrise: 15 } });
  });

  it('switch CO2 at night on the tap and answer, with what it means behind its help rather than under it', async () => {
    vi.mocked(api.patch).mockResolvedValue(device() as never);
    drawItem('co2-night');

    expect(screen.queryByText(/CO₂ is dosed/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'About CO₂ at night too' })).toHaveAccessibleDescription(/Roots in deep water culture/);
    fireEvent.click(screen.getByRole('switch', { name: 'CO₂ at night too' }));

    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/devices/device-1/configuration', { set: { co2Night: true } }));
    await waitFor(() => expect(said()).toBe('CO₂ at night too on · saved'));
  });

  it('show the compressor rest the firmware runs with where the document does not state it', () => {
    drawItem('compressor-rest');

    expect(screen.getByRole('button', { name: 'Change Compressor rest, 240 s' })).toBeInTheDocument();
  });

  /** Offline is true under Erweitert too: stored, since when, what the device still holds - and never that it was sent. */
  it('say what a silent device has not been handed, and that it takes a new figure over', async () => {
    Settings.now = () => Date.parse('2026-09-19T15:00:00.000Z');
    vi.mocked(api.patch).mockResolvedValue(device() as never);
    vi.mocked(api.get).mockImplementation((path: string) =>
      path === '/devices/device-1/live'
        ? (Promise.resolve({
            deviceId: 'device-1',
            metrics: {},
            outputs: {},
            setpoints: null,
            pending: { since: HEARD, settings: [{ field: 'lights.sunrise', held: 15, savedAt: '2026-09-19T14:31:00.000Z' }] },
          }) as never)
        : (Promise.reject(new Error(`no stub for ${path}`)) as never),
    );
    const silent = device('fridge', {}, { state: { ...device().state, lastSeenAt: HEARD } });
    drawItem('light-ramps', { ...silent, configuration: { ...silent.configuration, lights: { limit: 80, sunrise: 30, sunset: 15 } } });

    expect(await screen.findByText(/^Sunrise: 30 min saved at 14:31\. The device still holds 15 min until it is back online\.$/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Change Sunrise, 30 min, not with the device yet' })).toHaveAttribute('data-pending');
    expect(screen.queryByText(/sent to the device/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Change Sunset, 15 min' }));
    type('Sunset', '20');
    save();
    await waitFor(() => expect(said()).toBe('Sunset 20 min · saved, Fridge takes it over when it next connects'));
  });

  /** The leaf offsets are the cloud's own reckoning: nothing of them is handed to a device, silent or not. */
  it('move a leaf offset half a degree a tap on its sheet and save it with the other factors as they are', async () => {
    Settings.now = () => Date.parse('2026-09-19T15:00:00.000Z');
    vi.mocked(api.patch).mockResolvedValue(device() as never);
    drawItem('leaf-offsets', device('fridge', {}, { state: { ...device().state, lastSeenAt: HEARD } }));

    fireEvent.click(screen.getByRole('button', { name: 'Change Leaf against air · day, −2.0 °C' }));
    fireEvent.click(within(sheet()).getByRole('button', { name: 'Leaf against air · day: less' }));
    fireEvent.click(within(sheet()).getByRole('button', { name: 'Leaf against air · day: less' }));
    expect(api.patch).not.toHaveBeenCalled();
    save();

    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith('/devices/device-1', {
        settings: { vpdLeafOffsetDay: -3, vpdLeafOffsetNight: 0, ppfdLuxFactor: 0.015 },
      }),
    );
    await waitFor(() => expect(said()).toBe('Leaf against air · day −3.0 °C · saved'));
  });

  it('take the lux factor of a known lamp on its sheet, and hold a typed one to the range', async () => {
    vi.mocked(api.patch).mockResolvedValue(device() as never);
    drawItem('lux-factor', device('controller', { ppfd: 'on' }));

    fireEvent.click(screen.getByRole('button', { name: 'Change Lux to PPFD factor, 0.015' }));
    expect(within(sheet()).getByRole('button', { name: 'White LED · 0.015' })).toHaveAttribute('aria-pressed', 'true');
    type('Lux to PPFD factor', '1.5');
    expect(within(sheet()).getByRole('spinbutton', { name: 'Lux to PPFD factor' })).toHaveValue('0.0500');
    fireEvent.click(within(sheet()).getByRole('button', { name: 'HPS · 0.0122' }));
    save();

    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith('/devices/device-1', {
        settings: { vpdLeafOffsetDay: -2, vpdLeafOffsetNight: 0, ppfdLuxFactor: 0.0122 },
      }),
    );
    await waitFor(() => expect(said()).toBe('Lux to PPFD factor 0.0122 · saved'));
  });
});

describe('the CO2 cylinder, under the device that doses from it', () => {
  const REPORT: Co2Report = {
    cylinders: [
      { since: '2026-09-25T10:00:00.000Z', until: null, filledGrams: 425, restGrams: null, openings: 1000, openingsPerGram: null },
      { since: '2026-09-01T10:00:00.000Z', until: '2026-09-25T10:00:00.000Z', filledGrams: 500, restGrams: 100, openings: 2000, openingsPerGram: 5 },
    ],
    openingsPerGram: 5,
    restGrams: 225,
  };
  const Card = co2Items[0].Item;
  const place = (devices: Device[]) => ({ device: devices[0], mayManage: true, offline: false });

  it('is offered where something doses CO2, and nowhere else', () => {
    expect(co2Items[0].shows(place([device()]))).toBe(true);
    expect(co2Items[0].shows(place([device('controller', { co2: 'off' })]))).toBe(false);
    expect(co2Items[0].shows(place([device('plug')]))).toBe(false);
    // The cylinder is the place's, so a device standing nowhere has none to report on.
    expect(co2Items[0].shows(place([device('fridge', {}, { spaceId: null })]))).toBe(false);
  });

  it('works out how long the cylinder in use lasts at the rate it has gone down', () => {
    // 200 g used in 7 days is 28.6 g a day; 225 g lasts 7 more.
    expect(daysLeftOf(REPORT, DateTime.fromISO('2026-10-02T10:00:00.000Z'))).toBe(7);
    expect(daysLeftOf(REPORT, DateTime.fromISO('2026-09-25T18:00:00.000Z'))).toBeNull();
    expect(daysLeftOf({ ...REPORT, openingsPerGram: null, restGrams: null }, DateTime.fromISO('2026-10-02T10:00:00.000Z'))).toBeNull();
  });

  it('says what is left in the cylinder in use, and what the ones before it gave', async () => {
    vi.mocked(api.get).mockResolvedValue(REPORT as never);
    drawAt(<Card {...place([device()])} />);

    expect(await screen.findByText('About 225 g left (53 %)', { exact: false })).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith('/spaces/space-1/co2-report', undefined, expect.anything());
    expect(screen.getByText('5.0 valve openings a gram, from 1 empty cylinder')).toBeInTheDocument();
    expect(screen.getByText(/400 g used · 5.0 openings a g/)).toBeInTheDocument();
  });

  /** An estimate at nothing read "About 0 g left (0 %) · lasts about 0 days" while the valve held its target. */
  it('says an estimate run down to nothing is a guess that the cylinder is empty, to be checked', async () => {
    vi.mocked(api.get).mockResolvedValue({ ...REPORT, restGrams: 0.2 } as never);
    drawAt(<Card {...place([device()])} />);

    expect(await screen.findByText('By the estimate it should be empty – check the cylinder.')).toBeInTheDocument();
    expect(screen.getByText(/^Worked out from what the empty cylinder used/)).toBeInTheDocument();
    expect(screen.queryByText(/About 0 g left/)).not.toBeInTheDocument();
    expect(screen.queryByText(/lasts about 0/)).not.toBeInTheDocument();
  });

  it('notes a cylinder going in as a measurement of the place, with what was left in the old one', async () => {
    vi.mocked(api.get).mockResolvedValue(REPORT as never);
    vi.mocked(api.post).mockResolvedValue({} as never);
    drawAt(<Card {...place([device()])} />);

    fireEvent.click(await screen.findByRole('button', { name: 'New cylinder in' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Left in the old one' }), { target: { value: '35' } });
    fireEvent.click(screen.getByRole('button', { name: 'Note it' }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/entries', {
        kind: 'measurement',
        spaceId: 'space-1',
        deviceId: 'device-1',
        values: {
          kind: 'measurement',
          readings: [
            { key: 'co2FillingInitial', value: 425, plantId: null },
            { key: 'co2FillingRest', value: 35, plantId: null },
          ],
        },
      }),
    );
  });

  it('names those two readings in a diary line where no grow defines them', () => {
    const entry = {
      id: 'entry-1',
      kind: 'measurement',
      source: 'human',
      occurredAt: DateTime.now().toISO(),
      createdAt: DateTime.now().toISO(),
      authorId: 'user-1',
      growId: null,
      spaceId: 'space-1',
      deviceId: 'device-1',
      plantIds: [],
      cameraId: null,
      taskId: null,
      alertId: null,
      severity: null,
      text: null,
      message: null,
      values: { kind: 'measurement', readings: [{ key: 'co2FillingInitial', value: 425, plantId: null }] },
      mediaIds: [],
      undoUntil: null,
    } as unknown as Entry;
    // The row reads the account for the zone its time is drawn in.
    vi.mocked(api.get).mockResolvedValue({ id: 'user-1', handle: 'you' } as never);
    drawAt(
      <ul>
        <EntryRow entry={entry} people={[]} now={DateTime.now()} />
      </ul>,
    );

    expect(screen.getByText(/New CO₂ cylinder 425 g/)).toBeInTheDocument();
  });
});
