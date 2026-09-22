import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import i18next from 'i18next';
import { DateTime } from 'luxon';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { initReactI18next } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AlarmRule, AlarmRuleCreate, Device, Me, NotificationRouting, SpaceOverview } from '@fg2/shared-types/v1';
import { api } from '@/api/client';
import { ApiError } from '@/api/problem';
import { Alarms } from '@/screens/control/alarms/Alarms';
import { boundLabel, headersOf, routedChannels } from '@/screens/control/alarms/rules';

/**
 * The alarm rules page: what it says about each rule, and what the two things
 * it writes actually send.
 *
 * Every request is the app's own client, mocked at that one seam, so what is
 * asserted is the body that would go on the wire: a switch sends one field, a
 * new rule the whole contract shape. Who is looking decides what is offered,
 * and a rule about a sensor the device does not have is drawn but not switched.
 */
vi.mock('@/api/client', () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn(), upload: vi.fn() },
}));

const session = vi.hoisted(() => ({ demo: false }));

vi.mock('@/api/session', async importOriginal => {
  const { SIGNED_IN, ON_THE_DEMO } = await import('./session');

  return { ...(await importOriginal<object>()), useSession: () => (session.demo ? ON_THE_DEMO : SIGNED_IN) };
});

const NOW = DateTime.now();

const device = (over: Partial<Device> = {}, hardware: Record<string, string> = {}): Device =>
  ({
    id: 'device-1',
    type: 'controller',
    name: 'Blue Dream tent',
    spaceId: 'space-1',
    state: { lastSeenAt: NOW.toISO(), hardware, socketStateChangedAt: {}, socketsReportedAt: null, maintenanceUntil: null },
    ...over,
  }) as Device;

const rule = (over: Partial<AlarmRule>): AlarmRule => ({
  id: 'rule-x',
  createdAt: NOW.minus({ days: 3 }).toISO()!,
  deviceId: 'device-1',
  name: 'A rule',
  watch: { kind: 'reading', metric: 'temperature', upper: 30, lower: null },
  forSeconds: 600,
  severity: 'critical',
  origin: 'human',
  presetId: null,
  enabled: true,
  cooldownSeconds: 0,
  repeatSeconds: 0,
  delivery: { mode: 'routing', custom: null },
  silencedUntil: null,
  state: { triggered: false, lastTriggeredAt: null, lastResolvedAt: null, extremeValue: null, lastSampleAt: null },
  ...over,
});

const RULES: AlarmRule[] = [
  rule({ id: 'rule-hot', name: 'Too hot', origin: 'preset', presetId: 'preset-flower' }),
  rule({
    id: 'rule-co2',
    name: 'CO2',
    origin: 'preset',
    watch: { kind: 'reading', metric: 'co2', upper: 1500, lower: null },
    enabled: false,
  }),
  rule({
    id: 'rule-offline',
    name: 'Controller offline',
    origin: 'always',
    watch: { kind: 'reading', metric: 'offline', upper: null, lower: null },
    repeatSeconds: 600,
  }),
  rule({
    id: 'rule-dehum',
    name: 'Dehumidifier running non-stop',
    origin: 'device',
    watch: { kind: 'output_running', output: 'dehumidifier' },
    forSeconds: 7200,
    severity: 'warning',
    state: { triggered: true, lastTriggeredAt: NOW.minus({ hours: 1 }).toISO(), lastResolvedAt: null, extremeValue: null, lastSampleAt: NOW.toISO() },
  }),
  rule({
    id: 'rule-hook',
    name: 'Pump watchdog',
    watch: { kind: 'output_level', output: 'heater', upper: 0.5, lower: null },
    forSeconds: 300,
    severity: 'warning',
    delivery: {
      mode: 'custom',
      custom: {
        channel: 'webhook',
        target: 'http://10.0.0.5/alarm',
        includeDetails: true,
        webhook: { method: 'POST', headers: { 'X-Token': 'abc' }, triggeredPayload: '', resolvedPayload: '', reportErrors: true, tunnel: true },
      },
    },
  }),
];

const overview = {
  spaceId: 'space-1',
  name: 'Tent 1',
  grows: [{ growId: 'grow-1', stage: 'flowering', preset: 'flower' }],
} as unknown as SpaceOverview;

const me = { id: 'user-1', notifications: { routing: { alerts: ['telegram', 'push'], warnings: ['push'] } } } as unknown as Me;

const answers = (path: string): unknown => {
  if (path === '/spaces/space-1/overview') return overview;
  if (path === '/me') return me;
  if (path === '/devices/device-1/alarm-rules') return { items: RULES, nextCursor: null };
  throw new Error(`no answer for ${path}`);
};

const draw = (devices: Device[] = [device()], mayManage = true, at = '/spaces/space-1/control/alarms') =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
      <MemoryRouter initialEntries={[at]}>
        <Alarms spaceId="space-1" devices={devices} mayManage={mayManage} />
      </MemoryRouter>
    </QueryClientProvider>,
  );

const card = async (name: string) => (await screen.findByText(name)).closest('li')!;

beforeAll(async () => {
  const translation = JSON.parse(await readFile(resolve(process.cwd(), 'public/assets/i18n/en.json'), 'utf8'));
  await i18next
    .use(initReactI18next)
    .init({ lng: 'en', resources: { en: { translation } }, nsSeparator: false, interpolation: { escapeValue: false } });
});

beforeEach(() => {
  session.demo = false;
  vi.mocked(api.get).mockReset();
  vi.mocked(api.post).mockReset();
  vi.mocked(api.patch).mockReset();
  vi.mocked(api.get).mockImplementation((path: string) => Promise.resolve(answers(path)) as never);
  vi.mocked(api.post).mockImplementation((_path: string, body: unknown) => Promise.resolve({ ...RULES[0], ...(body as object) }) as never);
  vi.mocked(api.patch).mockImplementation((_path: string, body: unknown) => Promise.resolve({ ...RULES[0], ...(body as object) }) as never);
});

describe('the alarm rules page', () => {
  it('says so when nothing here has rules', async () => {
    draw([device({ id: 'plug-1', type: 'plug' })]);

    expect(screen.getByText(/Nothing stands here that has alarm rules/)).toBeInTheDocument();
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
  });

  it('groups the rules by where they came from, under the preset the grow stands on', async () => {
    draw();

    expect(await screen.findByText('From the Flower preset')).toBeInTheDocument();
    expect(screen.getByText('thresholds move with the stage')).toBeInTheDocument();
    expect(screen.getByText('Alarms · Tent 1')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '‹ back to the plan' })).toHaveAttribute('href', '/spaces/space-1/control');

    const labels = screen.getAllByText(/^(From the Flower preset|Always on|From the device|Yours)$/).map(label => label.textContent);
    expect(labels).toEqual(['From the Flower preset', 'Always on', 'From the device', 'Yours']);
  });

  it('writes the bound and the meta line of a preset rule, an always rule and a rule with its own webhook', async () => {
    draw();

    const hot = await card('Too hot');
    expect(within(hot).getByText('› 30 °C')).toBeInTheDocument();
    expect(within(hot).getByText('for 10 min · critical · push + Telegram')).toBeInTheDocument();
    expect(within(hot).getByText('preset')).toBeInTheDocument();

    const offline = await card('Controller offline');
    expect(within(offline).getByText('for 10 min · critical · push + Telegram · repeats until back')).toBeInTheDocument();
    expect(within(offline).getByText('always')).toBeInTheDocument();

    const running = await card('Dehumidifier running non-stop');
    expect(within(running).getByText('› 2 h')).toBeInTheDocument();
    expect(within(running).getByText('warning · push')).toBeInTheDocument();
    expect(within(running).getByRole('img', { name: 'triggered right now' })).toBeInTheDocument();

    const hook = await card('Pump watchdog');
    expect(within(hook).getByText('› 0.5')).toBeInTheDocument();
    expect(within(hook).getByText('for 5 min · warning · webhook')).toBeInTheDocument();
    expect(within(hook).getByText('yours')).toBeInTheDocument();
  });

  it('switches a rule off with one field', async () => {
    draw();

    fireEvent.click(await screen.findByRole('switch', { name: 'Too hot on or off' }));

    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/alarm-rules/rule-hot', { enabled: false }));
  });

  it('shows what the server said when it refused', async () => {
    vi.mocked(api.patch).mockRejectedValue(
      new ApiError({ status: 409, code: 'device_busy', title: 'Refused', detail: 'The device is in maintenance mode.', errors: [] }),
    );
    draw();

    fireEvent.click(await screen.findByRole('switch', { name: 'Too hot on or off' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('The device is in maintenance mode.');
  });

  it('draws a CO2 rule on a controller with no sensor, and does not offer its switch', async () => {
    draw([device({}, { co2: 'off' })]);

    const co2 = await card('CO2');
    expect(within(co2).getByText('› 1500 ppm')).toBeInTheDocument();
    expect(within(co2).getByRole('switch')).toBeDisabled();
    expect(within(co2).getByText('needs a CO₂ sensor')).toBeInTheDocument();
    expect(within(await card('Too hot')).getByRole('switch')).toBeEnabled();
  });

  it('says until when a rule is silenced, and offers to lift it', async () => {
    const until = NOW.plus({ minutes: 45 });
    const silenced = RULES.map(one => (one.id === 'rule-hot' ? { ...one, silencedUntil: until.toISO()! } : one));
    vi.mocked(api.get).mockImplementation(
      (path: string) => Promise.resolve(path === '/devices/device-1/alarm-rules' ? { items: silenced, nextCursor: null } : answers(path)) as never,
    );
    vi.mocked(api.delete).mockResolvedValue(undefined as never);
    draw();

    const hot = await card('Too hot');
    expect(within(hot).getByText(`silenced until ${until.toLocaleString(DateTime.TIME_SIMPLE)}`)).toBeInTheDocument();
    fireEvent.click(within(hot).getByRole('button', { name: 'unsilence' }));

    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/alarm-rules/rule-hot/silence'));
  });

  it('calls the stage group by the stage alone where nothing grows here yet', async () => {
    vi.mocked(api.get).mockImplementation(
      (path: string) => Promise.resolve(path === '/spaces/space-1/overview' ? { ...overview, grows: [] } : answers(path)) as never,
    );
    draw();

    expect(await screen.findByText('From the stage preset')).toBeInTheDocument();
  });

  it('marks the rule an alert linked to', async () => {
    draw([device()], true, '/spaces/space-1/control/alarms?rule=rule-offline');

    expect(await card('Controller offline')).toHaveAttribute('data-highlight');
    expect(await card('Too hot')).not.toHaveAttribute('data-highlight');
  });

  it('offers the demo everything to read and nothing to move', async () => {
    session.demo = true;
    draw([device()], false);

    await card('Too hot');
    for (const one of screen.getAllByRole('switch')) expect(one).toBeDisabled();
    expect(screen.queryByRole('button', { name: /\+ Alarm/ })).not.toBeInTheDocument();
    expect(screen.getAllByText('for 10 min · critical · push + Telegram')).toHaveLength(2);
  });
});

describe('the rule sheet', () => {
  const openNew = async () => {
    draw([device({}, { co2: 'on' })]);
    fireEvent.click(await screen.findByRole('button', { name: /\+ Alarm/ }));

    return screen.getByRole('dialog', { name: 'New alarm' });
  };

  it('offers the readings the device reports and every output', async () => {
    const sheet = await openNew();
    const watch = within(sheet).getByRole('group', { name: 'Watch' });

    expect(within(watch).getByRole('button', { name: 'CO₂' })).toBeInTheDocument();
    expect(within(watch).queryByRole('button', { name: 'Leaf temp' })).not.toBeInTheDocument();
    expect(within(watch).queryByRole('button', { name: 'Offline' })).not.toBeInTheDocument();
    expect(within(watch).getByRole('button', { name: 'Dehumidifier' })).toBeInTheDocument();
  });

  it('refuses a band with no edge before the server has to', async () => {
    const sheet = await openNew();

    fireEvent.click(within(sheet).getByRole('button', { name: 'Save the alarm' }));

    expect(within(sheet).getByRole('alert')).toHaveTextContent('Give it a line to cross');
    expect(api.post).not.toHaveBeenCalled();
  });

  it('creates a rule with exactly the body the contract names', async () => {
    const sheet = await openNew();

    fireEvent.change(within(sheet).getByRole('textbox', { name: 'Name' }), { target: { value: 'Too humid' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'RH' }));
    fireEvent.change(within(sheet).getByLabelText('above'), { target: { value: '60' } });
    fireEvent.change(within(sheet).getByRole('spinbutton', { name: 'For how long' }), { target: { value: '20' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'warning' }));
    fireEvent.change(within(sheet).getByRole('spinbutton', { name: 'every' }), { target: { value: '15' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save the alarm' }));

    const body: AlarmRuleCreate = {
      name: 'Too humid',
      watch: { kind: 'reading', metric: 'humidity', upper: 60, lower: null },
      forSeconds: 1200,
      severity: 'warning',
      enabled: true,
      cooldownSeconds: 0,
      repeatSeconds: 900,
      delivery: { mode: 'routing', custom: null },
    };
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/devices/device-1/alarm-rules', body));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('sends a webhook of its own with its headers as a record', async () => {
    const sheet = await openNew();

    fireEvent.change(within(sheet).getByRole('textbox', { name: 'Name' }), { target: { value: 'Pump' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Heater' }));
    fireEvent.click(within(sheet).getByRole('button', { name: 'running at all' }));
    fireEvent.click(within(sheet).getByRole('button', { name: 'a webhook' }));
    fireEvent.change(within(sheet).getByRole('textbox', { name: 'URL' }), { target: { value: 'http://10.0.0.5/alarm' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'GET' }));
    fireEvent.change(within(sheet).getByRole('textbox', { name: 'Headers' }), { target: { value: 'X-Token: abc\nnot a header' } });
    fireEvent.click(within(sheet).getByRole('switch', { name: "Through the device's tunnel" }));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save the alarm' }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(
        '/devices/device-1/alarm-rules',
        expect.objectContaining({
          watch: { kind: 'output_running', output: 'heater' },
          delivery: {
            mode: 'custom',
            custom: {
              channel: 'webhook',
              target: 'http://10.0.0.5/alarm',
              includeDetails: true,
              webhook: { method: 'GET', headers: { 'X-Token': 'abc' }, triggeredPayload: '', resolvedPayload: '', reportErrors: true, tunnel: true },
            },
          },
        }),
      ),
    );
  });

  it('opens a rule filled in, says what the stage will do to it, and patches the whole of what it asks', async () => {
    draw();
    fireEvent.click(await screen.findByRole('button', { name: /Too hot/ }));
    const sheet = screen.getByRole('dialog', { name: 'Edit the alarm' });

    expect(within(sheet).getByRole('textbox', { name: 'Name' })).toHaveValue('Too hot');
    expect(within(sheet).getByLabelText('above')).toHaveValue(30);
    expect(within(sheet).getByText(/The next stage writes its thresholds again/)).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: 'Delete the alarm' })).toBeInTheDocument();

    fireEvent.change(within(sheet).getByLabelText('above'), { target: { value: '31' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save the alarm' }));

    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith('/alarm-rules/rule-hot', {
        name: 'Too hot',
        watch: { kind: 'reading', metric: 'temperature', upper: 31, lower: null },
        forSeconds: 600,
        severity: 'critical',
        repeatSeconds: 0,
        delivery: { mode: 'routing', custom: null },
      }),
    );
  });

  it('asks before deleting, and never offers to delete what the cloud keeps', async () => {
    vi.mocked(api.delete).mockResolvedValue(undefined as never);
    draw();

    fireEvent.click(await screen.findByRole('button', { name: /Controller offline/ }));
    expect(within(screen.getByRole('dialog')).queryByRole('button', { name: 'Delete the alarm' })).not.toBeInTheDocument();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close' }));

    fireEvent.click(await screen.findByRole('button', { name: /Pump watchdog/ }));
    const sheet = screen.getByRole('dialog', { name: 'Edit the alarm' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Delete the alarm' }));
    expect(api.delete).not.toHaveBeenCalled();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Delete it' }));

    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/alarm-rules/rule-hook'));
  });
});

describe('what a rule is called', () => {
  it('writes a bound in the unit the series carries', () => {
    expect(boundLabel({ kind: 'reading', metric: 'temperature', upper: 30, lower: 16 })).toBe('› 30 °C ‹ 16 °C');
    expect(boundLabel({ kind: 'reading', metric: 'vpd', upper: null, lower: 0.8 })).toBe('‹ 0.80 kPa');
    expect(boundLabel({ kind: 'output_level', output: 'light', upper: 80, lower: null })).toBe('› 80 %');
    expect(boundLabel({ kind: 'output_level', output: 'fan', upper: null, lower: 0.2 })).toBe('‹ 0.2');
    expect(boundLabel({ kind: 'output_running', output: 'co2' })).toBe('');
  });

  it('names the channels the grid routes that severity to, in one order, and none for info', () => {
    const routing: NotificationRouting = { alerts: ['webhook', 'push'], warnings: [], tasks: ['push'] };

    expect(routedChannels(routing, 'critical')).toEqual(['push', 'webhook']);
    expect(routedChannels(routing, 'warning')).toEqual([]);
    expect(routedChannels({ ...routing, plan: ['email'] }, 'info')).toEqual([]);
    expect(routedChannels(undefined, 'critical')).toEqual([]);
  });

  it('reads headers off their lines and drops what is not one', () => {
    expect(headersOf('X-Token: abc\n\nAuthorization: Bearer a:b\nnothing')).toEqual({ 'X-Token': 'abc', Authorization: 'Bearer a:b' });
  });
});
