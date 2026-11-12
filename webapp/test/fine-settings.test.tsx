import { fireEvent, screen, waitFor } from '@testing-library/react';
import { DateTime } from 'luxon';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Co2Report, Device, Entry, SocketPage } from '@fg2/shared-types/v1';
import { api } from '@/api/client';
import { daysLeftOf, items as co2Items } from '@/screens/devices/advanced/Co2Report.advanced';
import { items as sensorItems } from '@/screens/devices/advanced/SensorFactors.advanced';
import { itemsFor } from '@/ui/advanced/registry';
import { EntryRow } from '@/ui/EntryRow';
import { drawAt } from './harness';
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

beforeAll(() => translate());

beforeEach(() => {
  vi.mocked(api.get).mockReset();
  vi.mocked(api.post).mockReset();
  vi.mocked(api.patch).mockReset();
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
  it('write a figure by its name, once it is typed whole and within its range', async () => {
    vi.mocked(api.patch).mockResolvedValue(device() as never);
    const Ramps = itemsFor('device', { device: device(), mayManage: true, offline: false }).find(one => one.id === 'light-ramps')!.Item;
    drawAt(<Ramps device={device()} mayManage offline={false} />);

    const sunrise = screen.getByRole('textbox', { name: 'Sunrise' });
    expect(sunrise).toHaveValue('15');
    fireEvent.change(sunrise, { target: { value: '90' } });
    expect(screen.getByText('From 0 to 60 min.')).toBeInTheDocument();
    fireEvent.change(sunrise, { target: { value: '30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/devices/device-1/configuration', { set: { sunrise: 30 } }));
  });

  it('switch CO2 at night on the tap, and say what it means', async () => {
    vi.mocked(api.patch).mockResolvedValue(device() as never);
    const Co2Night = itemsFor('device', { device: device(), mayManage: true, offline: false }).find(one => one.id === 'co2-night')!.Item;
    drawAt(<Co2Night device={device()} mayManage offline={false} />);

    expect(screen.getByText('CO₂ is dosed only while the light is on.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('switch', { name: 'CO₂ at night too' }));

    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/devices/device-1/configuration', { set: { co2Night: true } }));
  });

  it('show the compressor rest the firmware runs with where the document does not state it', () => {
    const rest = itemsFor('device', { device: device(), mayManage: true, offline: false }).find(one => one.id === 'compressor-rest')!;
    const Rest = rest.Item;
    drawAt(<Rest device={device()} mayManage offline={false} />);

    expect(screen.getByRole('textbox', { name: 'Compressor rest' })).toHaveValue('240');
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
  });

  it('move a leaf offset half a degree a tap and save it with the other factors as they are', async () => {
    vi.mocked(api.patch).mockResolvedValue(device() as never);
    const Offsets = sensorItems[0].Item;
    drawAt(<Offsets device={device()} mayManage offline={false} />);

    fireEvent.click(screen.getByRole('button', { name: 'Leaf against air · day: cooler' }));
    fireEvent.click(screen.getByRole('button', { name: 'Leaf against air · day: cooler' }));
    expect(screen.getByText('−3.0 °C')).toBeInTheDocument();
    expect(api.patch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith('/devices/device-1', {
        settings: { vpdLeafOffsetDay: -3, vpdLeafOffsetNight: 0, ppfdLuxFactor: 0.015 },
      }),
    );
  });

  it('set the lux factor of a known lamp on the tap, and refuse a typed one no lamp has', async () => {
    vi.mocked(api.patch).mockResolvedValue(device() as never);
    const Lux = sensorItems[1].Item;
    drawAt(<Lux device={device('controller', { ppfd: 'on' })} mayManage offline={false} />);

    expect(screen.getByRole('button', { name: 'White LED · 0.015' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'HPS · 0.0122' }));
    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith('/devices/device-1', {
        settings: { vpdLeafOffsetDay: -2, vpdLeafOffsetNight: 0, ppfdLuxFactor: 0.0122 },
      }),
    );

    fireEvent.change(screen.getByRole('textbox', { name: 'Lux to PPFD factor' }), { target: { value: '1,5' } });
    expect(screen.getByText('From 0.005 to 0.05.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
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

  it('reads nothing while its section is folded, and says what is left once it is opened', async () => {
    vi.mocked(api.get).mockResolvedValue(REPORT as never);
    drawAt(
      <details>
        <summary>Advanced</summary>
        <Card {...place([device()])} />
      </details>,
    );

    expect(api.get).not.toHaveBeenCalledWith('/spaces/space-1/co2-report', undefined, expect.anything());
    const section = screen.getByText('Advanced').closest('details')!;
    section.open = true;
    fireEvent(section, new Event('toggle'));

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
