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
import type { Co2Report, Device, Entry } from '@fg2/shared-types/v1';
import { api } from '@/api/client';
import { daysLeftOf, items as co2Items } from '@/screens/cockpit/Co2Report.advanced';
import { items as sensorItems } from '@/screens/devices/advanced/SensorFactors.advanced';
import { PhaseTips } from '@/screens/grow/PhaseTips';
import { itemsFor } from '@/ui/advanced/registry';
import { EntryRow } from '@/ui/EntryRow';

/**
 * The settings few growers need, back under Erweitert where the old app had
 * them in its expert screens: the lamp's ramps, a fridge's fans, its
 * maintenance light and its compressor's rest, the leaf offsets and the lux
 * factor the cloud works VPD and PPFD out with, and the CO2 cylinder at the
 * place. And the phase tips, folded on the grow page.
 */

vi.mock('@/api/client', () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn(), upload: vi.fn() },
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

const wrap = (children: React.ReactNode) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>,
  );

const ids = (one: Device, mayManage = true) => itemsFor('device', { device: one, mayManage, offline: false }).map(item => item.id);

beforeAll(async () => {
  const translation = JSON.parse(await readFile(resolve(process.cwd(), 'public/assets/i18n/en.json'), 'utf8'));
  await i18next
    .use(initReactI18next)
    .init({ lng: 'en', resources: { en: { translation } }, nsSeparator: false, interpolation: { escapeValue: false } });
});

beforeEach(() => {
  vi.mocked(api.get).mockReset();
  vi.mocked(api.post).mockReset();
  vi.mocked(api.patch).mockReset();
});

describe('what Erweitert offers a device', () => {
  it('offers a fridge its ramps, its maintenance light, its fans, its compressor rest and its leaf offsets', () => {
    expect(ids(device())).toEqual([
      'operating-mode',
      'light-ramps',
      'maintenance-light',
      'fans',
      'compressor-rest',
      'continue-plan',
      'leaf-offsets',
      'update-channel',
    ]);
  });

  it('offers a tent controller the ramps its lamp runs on, and the lux factor only where it measures light', () => {
    expect(ids(device('controller'))).toEqual(['operating-mode', 'light-ramps', 'continue-plan', 'leaf-offsets', 'update-channel']);
    expect(ids(device('controller', { ppfd: 'on' }))).toContain('lux-factor');
  });

  it('offers nothing to tune before the device has sent its document, and none of this to a lamp or a plug', () => {
    expect(ids(device('fridge', {}, { configuration: null }))).not.toContain('light-ramps');
    // A LIGHT and a smart socket have fine settings of their own, which stand
    // under Erweitert in their own panels; a fridge's are not among them.
    expect(ids(device('light'))).toEqual(['light-ramp', 'light-overheat', 'update-channel']);
    expect(ids(device('plug'))).toEqual(['plug-protections', 'update-channel']);
  });
});

describe('the fine settings themselves', () => {
  it('write a figure by its name, once it is typed whole and within its range', async () => {
    vi.mocked(api.patch).mockResolvedValue(device() as never);
    const [, ramps] = itemsFor('device', { device: device(), mayManage: true, offline: false });
    const Ramps = ramps.Item;
    wrap(<Ramps device={device()} mayManage offline={false} />);

    const sunrise = screen.getByRole('textbox', { name: 'Sunrise' });
    expect(sunrise).toHaveValue('15');
    fireEvent.change(sunrise, { target: { value: '90' } });
    expect(screen.getByText('From 0 to 60 min.')).toBeInTheDocument();
    fireEvent.change(sunrise, { target: { value: '30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/devices/device-1/configuration', { set: { sunrise: 30 } }));
  });

  it('ask before a fridge goes dark for germination, and go back to the standard at once', async () => {
    vi.mocked(api.patch).mockResolvedValue(device() as never);
    const mode = itemsFor('device', { device: device(), mayManage: true, offline: false }).find(one => one.id === 'operating-mode')!;
    const Mode = mode.Item;
    const view = wrap(<Mode device={device()} mayManage offline={false} />);

    fireEvent.click(screen.getByRole('button', { name: 'Germination · dark' }));
    expect(api.patch).not.toHaveBeenCalled();
    expect(screen.getByText(/^Switch to Germination · dark\? For seeds germinating in the dark: no light, no CO₂/)).toBeInTheDocument();
    // What going back does to the night is said before it is chosen.
    expect(screen.getByText(/Back on standard, the night temperature from before holds again/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByText(/^Switch to Germination · dark\?/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Germination · dark' }));
    fireEvent.click(screen.getByRole('button', { name: 'Switch to Germination · dark' }));
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/devices/device-1/configuration', { set: { mode: 'germination' } }));

    view.unmount();
    vi.mocked(api.patch).mockClear();
    const germinating = device('fridge', {}, {
      control: { running: true, drying: false, mode: 'germination', energySaving: false },
    } as Partial<Device>);
    wrap(<Mode device={germinating} mayManage offline={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Standard' }));
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/devices/device-1/configuration', { set: { mode: 'standard' } }));
  });

  it('offer a tent controller the standard and germination in the dark, and not the greenhouse mode a fridge has', () => {
    const tent = device('controller');
    const Mode = itemsFor('device', { device: tent, mayManage: true, offline: false }).find(one => one.id === 'operating-mode')!.Item;
    wrap(<Mode device={tent} mayManage offline={false} />);

    expect(screen.getByRole('button', { name: 'Standard' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Germination · dark' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Greenhouse' })).not.toBeInTheDocument();
  });

  it('show the compressor rest the firmware runs with where the document does not state it', () => {
    const rest = itemsFor('device', { device: device(), mayManage: true, offline: false }).find(one => one.id === 'compressor-rest')!;
    const Rest = rest.Item;
    wrap(<Rest device={device()} mayManage offline={false} />);

    expect(screen.getByRole('textbox', { name: 'Compressor rest' })).toHaveValue('240');
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
  });

  it('move a leaf offset half a degree a tap and save it with the other factors as they are', async () => {
    vi.mocked(api.patch).mockResolvedValue(device() as never);
    const Offsets = sensorItems[0].Item;
    wrap(<Offsets device={device()} mayManage offline={false} />);

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
    wrap(<Lux device={device('controller', { ppfd: 'on' })} mayManage offline={false} />);

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

describe('the CO2 cylinder at the place', () => {
  const REPORT: Co2Report = {
    cylinders: [
      { since: '2026-09-25T10:00:00.000Z', until: null, filledGrams: 425, restGrams: null, openings: 1000, openingsPerGram: null },
      { since: '2026-09-01T10:00:00.000Z', until: '2026-09-25T10:00:00.000Z', filledGrams: 500, restGrams: 100, openings: 2000, openingsPerGram: 5 },
    ],
    openingsPerGram: 5,
    restGrams: 225,
  };
  const Card = co2Items[0].Item;
  const place = (devices: Device[]) => ({ spaceId: 'space-1', devices, mayManage: true });

  it('is offered where something doses CO2, and nowhere else', () => {
    expect(co2Items[0].shows(place([device()]))).toBe(true);
    expect(co2Items[0].shows(place([device('controller', { co2: 'off' })]))).toBe(false);
    expect(co2Items[0].shows(place([device('plug')]))).toBe(false);
  });

  it('works out how long the cylinder in use lasts at the rate it has gone down', () => {
    // 200 g used in 7 days is 28.6 g a day; 225 g lasts 7 more.
    expect(daysLeftOf(REPORT, DateTime.fromISO('2026-10-02T10:00:00.000Z'))).toBe(7);
    expect(daysLeftOf(REPORT, DateTime.fromISO('2026-09-25T18:00:00.000Z'))).toBeNull();
    expect(daysLeftOf({ ...REPORT, openingsPerGram: null, restGrams: null }, DateTime.fromISO('2026-10-02T10:00:00.000Z'))).toBeNull();
  });

  it('reads nothing while its section is folded, and says what is left once it is opened', async () => {
    vi.mocked(api.get).mockResolvedValue(REPORT as never);
    wrap(
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
    wrap(<Card {...place([device()])} />);

    expect(await screen.findByText('By the estimate it should be empty – check the cylinder.')).toBeInTheDocument();
    expect(screen.getByText(/^Worked out from what the empty cylinder used/)).toBeInTheDocument();
    expect(screen.queryByText(/About 0 g left/)).not.toBeInTheDocument();
    expect(screen.queryByText(/lasts about 0/)).not.toBeInTheDocument();
  });

  it('notes a cylinder going in as a measurement of the place, with what was left in the old one', async () => {
    vi.mocked(api.get).mockResolvedValue(REPORT as never);
    vi.mocked(api.post).mockResolvedValue({} as never);
    wrap(<Card {...place([device()])} />);

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
    wrap(
      <ul>
        <EntryRow entry={entry} people={[]} now={DateTime.now()} />
      </ul>,
    );

    expect(screen.getByText(/New CO₂ cylinder 425 g/)).toBeInTheDocument();
  });
});

describe('the phase tips', () => {
  it('fold four tips for the phase the grow is in under one line', () => {
    wrap(<PhaseTips stage="flowering" />);

    const section = screen.getByText('Tips for this stage').closest('details')!;
    expect(section).not.toHaveAttribute('open');
    expect(section.querySelectorAll('li')).toHaveLength(4);
    expect(section).toHaveTextContent(/Keep humidity at or below 50 %/);
  });

  it('give germination its own tips in the dark and curing the end of drying´s, and nothing without a phase', () => {
    wrap(<PhaseTips stage="germination" />);
    expect(screen.getByText(/^Seeds germinate dark and moist/)).toBeInTheDocument();
    expect(screen.getByText(/it needs light: switch to “Seedling · with light”/)).toBeInTheDocument();

    const { container } = wrap(<PhaseTips stage={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
