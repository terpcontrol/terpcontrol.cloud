import { fireEvent, screen, waitFor } from '@testing-library/react';
import { DateTime } from 'luxon';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Device } from '@fg2/shared-types/v1';
import { api } from '@/api/client';
import { ModePage } from '@/screens/control/Mode';
import { drawAt } from './harness';
import { translate } from './translations';

/**
 * Betriebsart, the page behind its row under Steuerung: the work modes a type
 * has, each one but the standard asked first; what germination does about the
 * humidity while it runs; a fridge's energy saving; and the ways out of a
 * drying spell and of control switched off.
 */

vi.mock('@/api/client', () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

vi.mock('@/api/session', async importOriginal => {
  const { SIGNED_IN } = await import('./session');
  return { ...(await importOriginal<object>()), useSession: () => SIGNED_IN };
});

const CONTROL = { running: true, drying: false, mode: 'standard', energySaving: false } as NonNullable<Device['control']>;

const device = (type = 'fridge', over: Partial<Device> = {}): Device =>
  ({
    id: 'device-1',
    type,
    name: 'Fridge',
    spaceId: 'space-1',
    configuration: { workmode: 'small', night: { temperature: 21, humidity: 55 } },
    settings: { vpdLeafOffsetDay: -2, vpdLeafOffsetNight: 0, ppfdLuxFactor: 0.015 },
    control: CONTROL,
    state: { lastSeenAt: DateTime.now().toISO(), hardware: {}, socketStateChangedAt: {}, socketsReportedAt: null, maintenanceUntil: null },
    ...over,
  }) as Device;

/** The device's socket table, which is where a humidifier is found. */
const paired = (...roles: string[]) =>
  vi.mocked(api.get).mockImplementation((path: string) =>
    path === '/devices/device-1/sockets'
      ? (Promise.resolve({
          items: roles.map((role, slot) => ({
            slot,
            role,
            hardwareId: '',
            address: '',
            state: 'off',
            override: null,
            timer: null,
            stateChangedAt: null,
          })),
          nextCursor: null,
          capabilities: { socketOverride: true, socketTimer: true, lightOverride: true, roles, pulseSeconds: {} },
        }) as never)
      : (Promise.reject(new Error(`no stub for ${path}`)) as never),
  );

const draw = (one: Device, mayManage = true) => drawAt(<ModePage devices={[one]} mayManage={mayManage} />);

beforeAll(() => translate());

beforeEach(() => {
  vi.mocked(api.patch).mockReset();
  vi.mocked(api.patch).mockResolvedValue(device() as never);
  paired();
});

describe('the work mode', () => {
  /** Germination and drying darken the device: a tap in bloom would cost a night of light, so each is asked first. */
  it('asks before a fridge goes dark for germination, and goes back to the standard at once', async () => {
    const view = draw(device());

    fireEvent.click(screen.getByRole('button', { name: 'Germination · dark' }));
    expect(api.patch).not.toHaveBeenCalled();
    expect(screen.getByText(/^Switch to Germination · dark\? For seeds germinating in the dark: no light, no CO₂/)).toBeInTheDocument();
    // What going back does to the night is said before it is chosen, the humidity germination brings, and what it does about it.
    expect(
      screen.getByText(/the night temperature at first, to be changed under Targets – and 75 % humidity for a humidifier\./),
    ).toBeInTheDocument();
    expect(screen.getByText(/Back on standard, the night from before holds again/)).toBeInTheDocument();
    expect(
      screen.getByText(
        /“Too humid” rests until germination ends\. Alarms you set up yourself stay awake\. This can be changed here once it is switched\.$/,
      ),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByText(/^Switch to Germination · dark\?/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Germination · dark' }));
    fireEvent.click(screen.getByRole('button', { name: 'Switch to Germination · dark' }));
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/devices/device-1/configuration', { set: { mode: 'germination' } }));

    view.unmount();
    vi.mocked(api.patch).mockClear();
    draw(device('fridge', { control: { ...CONTROL, mode: 'germination' } }));
    fireEvent.click(screen.getByRole('button', { name: 'Standard' }));
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/devices/device-1/configuration', { set: { mode: 'standard' } }));
  });

  /**
   * While the device germinates, what germination does about the humidity is
   * chosen under the mode, each switch on the tap like the mode itself; the
   * humidifier's only where a socket is paired as one.
   */
  it('offers what germination does about the humidity while the device germinates, and writes each choice on the tap', async () => {
    const view = draw(device());
    // Standard says nothing of germination.
    expect(screen.queryByRole('group', { name: 'During germination' })).not.toBeInTheDocument();
    view.unmount();

    paired('humidifier');
    draw(
      device('fridge', {
        configuration: { workmode: 'breed', night: { temperature: 24, humidity: 62 } },
        control: { ...CONTROL, mode: 'germination', germinationChoices: { warnTooHumid: false, humidifierHolds: true } },
      }),
    );

    expect(await screen.findByText('The humidifier holds 62 % – it never makes it wetter than that.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('switch', { name: 'Warn when it gets too humid' }));
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/devices/device-1/configuration', { set: { germinationWarnTooHumid: true } }));
    fireEvent.click(screen.getByRole('switch', { name: 'Hold the humidity with the humidifier' }));
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/devices/device-1/configuration', { set: { germinationHumidifier: false } }));
  });

  it('offers a tent controller the standard, germination and drying, and not the greenhouse mode a fridge has', () => {
    draw(device('controller'));

    expect(screen.getByRole('button', { name: 'Standard' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Germination · dark' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Greenhouse' })).not.toBeInTheDocument();
    // Energy saving is a fridge's.
    expect(screen.queryByRole('switch', { name: 'Energy saving' })).not.toBeInTheDocument();
  });

  it('switches a fridge’s energy saving on the tap, in its standard mode only', async () => {
    const view = draw(device());
    fireEvent.click(screen.getByRole('switch', { name: 'Energy saving' }));
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/devices/device-1/configuration', { set: { energySaving: true } }));
    view.unmount();

    draw(device('fridge', { control: { ...CONTROL, mode: 'greenhouse' } }));
    expect(screen.queryByRole('switch', { name: 'Energy saving' })).not.toBeInTheDocument();
  });
});

describe('the ways back to the standard day and night', () => {
  /** Somebody who keeps no diary has no phase to end a drying spell with. */
  it('ends a drying spell after asking, and says which targets come back', async () => {
    draw(
      device('fridge', {
        control: {
          ...CONTROL,
          drying: true,
          afterDrying: { dayTemperature: 25, dayHumidity: 60, nightTemperature: 20, nightHumidity: 55, lightLimit: 80, co2: 900 },
        },
      }),
    );

    fireEvent.click(screen.getByRole('button', { name: 'End drying …' }));
    expect(api.patch).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toHaveTextContent('day 25 °C · 60 %, night 20 °C · 55 %, light 80 %, CO₂ 900 ppm');
    fireEvent.click(screen.getByRole('button', { name: 'End drying' }));

    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/devices/device-1/configuration', { set: { drying: false } }));
  });

  it('says control is off instead of offering a mode, with the one tap that switches it on', async () => {
    draw(device('fridge', { control: { ...CONTROL, running: false } }));

    expect(screen.getByText('Control off.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Standard' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Switch control on' }));
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/devices/device-1/configuration', { set: { control: true } }));
  });

  /** A control the reader may not use is absent or said as a fact, and the page says once whose it is. */
  it('offers a session that may only look nothing that writes', () => {
    draw(device('fridge', { control: { ...CONTROL, running: false } }), false);

    expect(screen.queryByRole('button', { name: 'Switch control on' })).not.toBeInTheDocument();
    expect(screen.getByText('This session may look and not set.')).toBeInTheDocument();
  });
});
