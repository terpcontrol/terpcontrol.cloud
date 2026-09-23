import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import i18next from 'i18next';
import { DateTime } from 'luxon';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { initReactI18next } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AlarmRule, AlarmRuleCreate, Device, Me, SpaceOverview } from '@fg2/shared-types/v1';
import { api } from '@/api/client';
import { ApiError } from '@/api/problem';
import { Alarms } from '@/screens/control/alarms/Alarms';
import { boundLabel, channelsLabel, routedChannels } from '@/screens/control/alarms/rules';
import { headersOf } from '@/ui/headers';

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
    repeatSeconds: 1800,
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

const me = {
  id: 'user-1',
  pushSubscribed: true,
  preferences: { units: { temperature: 'celsius', weight: 'grams', volume: 'liters' }, locale: 'en', timezone: 'Europe/Berlin' },
  notifications: {
    routing: { alerts: ['telegram', 'push'], warnings: ['push'] },
    channels: { email: 'you@example.invalid', telegram: { chatId: '1', linkedAt: NOW.toISO() }, webhook: null },
  },
} as unknown as Me;

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
  it('says so when nothing here has rules, and offers the one thing there is to do', async () => {
    vi.mocked(api.get).mockImplementation(
      (path: string) => Promise.resolve(path === '/devices/mystery-1/alarm-rules' ? { items: [], nextCursor: null } : answers(path)) as never,
    );
    draw([device({ id: 'mystery-1', type: 'watering-computer' })]);

    expect(await screen.findByText(/Nothing stands here that has alarm rules/)).toBeInTheDocument();
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Add a device' })).toHaveAttribute('href', '/spaces/space-1/devices');
    expect(screen.queryByRole('link', { name: '‹ back to the plan' })).not.toBeInTheDocument();
  });

  it('lists the rules of a plug, which measures no climate and is given one all the same', async () => {
    const offline = rule({
      id: 'rule-plug',
      deviceId: 'plug-1',
      name: 'Device offline',
      origin: 'always',
      watch: { kind: 'reading', metric: 'offline', upper: null, lower: null },
      repeatSeconds: 1800,
    });
    vi.mocked(api.get).mockImplementation(
      (path: string) => Promise.resolve(path === '/devices/plug-1/alarm-rules' ? { items: [offline], nextCursor: null } : answers(path)) as never,
    );
    draw([device({ id: 'plug-1', type: 'plug', name: 'Pump socket' })]);

    expect(await screen.findByText('Plug offline')).toBeInTheDocument();
    expect(screen.queryByText(/Nothing stands here that has alarm rules/)).not.toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Plug offline on or off' })).toBeEnabled();
  });

  it('lists a device this build knows nothing about as long as it holds a rule, and offers it no new one', async () => {
    const mystery = rule({ id: 'rule-mystery', deviceId: 'mystery-1', name: 'Tank empty', origin: 'device' });
    vi.mocked(api.get).mockImplementation(
      (path: string) => Promise.resolve(path === '/devices/mystery-1/alarm-rules' ? { items: [mystery], nextCursor: null } : answers(path)) as never,
    );
    draw([device({ id: 'mystery-1', type: 'watering-computer' })]);

    expect(await screen.findByText('Tank empty')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /\+ Alarm/ })).not.toBeInTheDocument();
  });

  it('draws no bound at all on an output watched for running at all with no duration', async () => {
    const running = RULES.find(rule => rule.watch.kind === 'output_running')!;
    vi.mocked(api.get).mockImplementation(
      (path: string) =>
        Promise.resolve(
          path === '/devices/device-1/alarm-rules' ? { items: [{ ...running, forSeconds: 0 }], nextCursor: null } : answers(path),
        ) as never,
    );
    draw();

    const row = await card('Dehumidifier running non-stop');
    expect(row.textContent).not.toMatch(/›\s*0/);
  });

  it('groups the rules by where they came from, under the preset the grow stands on', async () => {
    draw();

    expect(await screen.findByText('From the Flower preset')).toBeInTheDocument();
    expect(screen.getByText('thresholds move with the stage')).toBeInTheDocument();
    expect(screen.getByText('Alarms · Tent 1')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '‹ back to the plan' })).toHaveAttribute('href', '/spaces/space-1/control');

    const labels = screen.getAllByText(/^(From the Flower preset|Always on|From the device|Written here)$/).map(label => label.textContent);
    expect(labels).toEqual(['From the Flower preset', 'Always on', 'From the device', 'Written here']);
  });

  it('writes the bound and the meta line of a preset rule, an always rule and a rule with its own webhook', async () => {
    draw();

    const hot = await card('Too hot');
    expect(within(hot).getByText('› 30 °C')).toBeInTheDocument();
    expect(within(hot).getByText('preset · for 10 min · critical · goes to you by push + Telegram · announced once')).toBeInTheDocument();

    const offline = await card('Controller offline');
    expect(within(offline).getByText('always · for 10 min · critical · goes to you by push + Telegram · repeats every 30 min')).toBeInTheDocument();

    const running = await card('Dehumidifier running non-stop');
    expect(within(running).getByText('› 2 h')).toBeInTheDocument();
    expect(within(running).getByText('device · warning · goes to you by push · announced once')).toBeInTheDocument();
    expect(within(running).getByRole('img', { name: 'triggered right now' })).toBeInTheDocument();

    const hook = await card('Pump watchdog');
    expect(within(hook).getByText('› 0.5')).toBeInTheDocument();
    expect(within(hook).getByText('custom · for 5 min · warning · webhook · announced once')).toBeInTheDocument();
  });

  /**
   * A mute is absolute on the server: nothing at all goes out while it holds,
   * critical included, so a line promising an e-mail and a repeat every half
   * hour was a promise the account had itself cancelled a tab away. A rule that
   * delivers to a target of its own does not go through the account's channels
   * and really does still send, so it keeps its line.
   */
  it('says the account’s channels are muted instead of promising a delivery and a repeat', async () => {
    const mutedUntil = NOW.plus({ hours: 1 });
    vi.mocked(api.get).mockImplementation(
      (path: string) =>
        Promise.resolve(path === '/me' ? { ...me, notifications: { ...me.notifications, mutedUntil: mutedUntil.toISO() } } : answers(path)) as never,
    );
    draw();

    const until = mutedUntil.setZone('Europe/Berlin').toFormat('HH:mm');
    const offline = await card('Controller offline');
    expect(within(offline).getByText(`always · for 10 min · critical · your channels muted until ${until}`)).toBeInTheDocument();
    expect(offline.textContent).not.toMatch(/goes to you|repeats every/);

    // Its own webhook is not the account's channel, and is not held back with them.
    expect(within(await card('Pump watchdog')).getByText('custom · for 5 min · warning · webhook · announced once')).toBeInTheDocument();
  });

  it('holds a warning back inside the account’s quiet hours and lets a critical rule through, as the server does', async () => {
    const here = NOW.setZone('Europe/Berlin');
    const minute = here.hour * 60 + here.minute;
    const quietHours = { fromMinute: (minute + 1440 - 60) % 1440, toMinute: (minute + 60) % 1440 };
    vi.mocked(api.get).mockImplementation(
      (path: string) => Promise.resolve(path === '/me' ? { ...me, notifications: { ...me.notifications, quietHours } } : answers(path)) as never,
    );
    draw();

    const until = `${String(Math.floor(quietHours.toMinute / 60)).padStart(2, '0')}:${String(quietHours.toMinute % 60).padStart(2, '0')}`;
    expect(within(await card('Dehumidifier running non-stop')).getByText(`device · warning · your quiet hours until ${until}`)).toBeInTheDocument();
    expect(
      within(await card('Too hot')).getByText('preset · for 10 min · critical · goes to you by push + Telegram · announced once'),
    ).toBeInTheDocument();
  });

  it('names the two rules nobody here wrote by what they watch, so they read in the language of the page', async () => {
    draw();

    expect(await screen.findByText('Controller offline')).toBeInTheDocument();
    expect(await screen.findByText('CO₂ too high')).toBeInTheDocument();
    expect(screen.queryByText('CO2')).not.toBeInTheDocument();
    expect(screen.getByText('Pump watchdog')).toBeInTheDocument();
  });

  it('marks a routed channel the account cannot be reached on', async () => {
    vi.mocked(api.get).mockImplementation(
      (path: string) => Promise.resolve(path === '/me' ? { ...me, pushSubscribed: false } : answers(path)) as never,
    );
    draw();

    expect(
      within(await card('Too hot')).getByText('preset · for 10 min · critical · goes to you by push (off) + Telegram · announced once'),
    ).toBeInTheDocument();
  });

  it('says nothing about where a rule goes until the account has answered', async () => {
    vi.mocked(api.get).mockImplementation((path: string) => (path === '/me' ? new Promise(() => {}) : Promise.resolve(answers(path))) as never);
    draw();

    expect(within(await card('Too hot')).getByText('preset · for 10 min · critical · announced once')).toBeInTheDocument();
    expect(screen.queryByText(/does not reach you/)).not.toBeInTheDocument();
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

    const co2 = await card('CO₂ too high');
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
    expect(within(hot).getByText(`silenced until ${until.setZone('Europe/Berlin').toFormat('HH:mm')}`)).toBeInTheDocument();
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

  /**
   * The demo tours somebody else's space and has no account of its own, so the
   * server refuses `/me` for it. The refusal stands in the mock to say so: the
   * page must never reach it, because a screen that drew its whole list on the
   * back of a 403 would be one refusal away from drawing nothing.
   */
  it('offers the demo everything to read and nothing to move, and never asks for an account it has not got', async () => {
    session.demo = true;
    vi.mocked(api.get).mockImplementation(
      (path: string) =>
        (path === '/me'
          ? Promise.reject(new ApiError({ status: 403, code: 'demo', title: 'Refused', detail: 'Not the demo account.', errors: [] }))
          : Promise.resolve(answers(path))) as never,
    );
    draw([device()], false);

    const hot = await card('Too hot');
    // Whether a rule is watching is worth reading; the switch that throws it is
    // absent rather than drawn dead, which is the rule for every control here.
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    expect(within(hot as HTMLElement).getByText('On')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /\+ Alarm/ })).not.toBeInTheDocument();
    expect(screen.getAllByText('preset · for 10 min · critical · announced once')).toHaveLength(1);
    expect(vi.mocked(api.get).mock.calls.map(([path]) => path)).not.toContain('/me');
  });

  it('asks for the account where there is one, because the routing verdict is read off it', async () => {
    draw([device()], false);

    await card('Too hot');
    expect(vi.mocked(api.get).mock.calls.map(([path]) => path)).toContain('/me');
  });

  it('says a switched-off rule is off rather than how often it would announce itself', async () => {
    draw();

    const co2 = await card('CO₂ too high');
    expect(within(co2).getByText('preset · for 10 min · critical · switched off')).toBeInTheDocument();
    expect(within(co2).getByRole('switch')).toHaveAttribute('aria-checked', 'false');
    expect(co2.textContent).not.toMatch(/goes to you|announced once|repeats every/);

    const hot = await card('Too hot');
    expect(within(hot).getByText('preset · for 10 min · critical · goes to you by push + Telegram · announced once')).toBeInTheDocument();
  });
});

describe('the rule sheet', () => {
  const openNew = async () => {
    draw([device({}, { co2: 'on' })]);
    fireEvent.click(await screen.findByRole('button', { name: /\+ Alarm/ }));

    return screen.getByRole('dialog', { name: 'New alarm' });
  };

  it('offers the readings the device reports and the outputs its hardware drives', async () => {
    const sheet = await openNew();
    const watch = within(sheet).getByRole('group', { name: 'Watch' });

    expect(within(watch).getByRole('button', { name: 'CO₂' })).toBeInTheDocument();
    expect(within(watch).queryByRole('button', { name: 'Leaf temp' })).not.toBeInTheDocument();
    expect(within(watch).queryByRole('button', { name: 'Offline' })).not.toBeInTheDocument();
    expect(within(watch).getByRole('button', { name: 'Dehumidifier' })).toBeInTheDocument();
    expect(within(watch).queryByRole('button', { name: 'Internal fan' })).not.toBeInTheDocument();
    expect(within(watch).queryByRole('button', { name: 'Relay' })).not.toBeInTheDocument();
  });

  it('offers a plug the one output it drives and none of the climate it cannot measure', async () => {
    vi.mocked(api.get).mockImplementation(
      (path: string) => Promise.resolve(path === '/devices/plug-1/alarm-rules' ? { items: [], nextCursor: null } : answers(path)) as never,
    );
    draw([device({ id: 'plug-1', type: 'plug', name: 'Pump socket' })]);

    fireEvent.click(await screen.findByRole('button', { name: /\+ Alarm/ }));
    const watch = within(screen.getByRole('dialog', { name: 'New alarm' })).getByRole('group', { name: 'Watch' });

    expect(within(watch).getByRole('button', { name: 'Relay' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(watch).queryByRole('button', { name: 'Temp' })).not.toBeInTheDocument();
    expect(within(watch).queryByRole('button', { name: 'VPD' })).not.toBeInTheDocument();
  });

  it('keeps an output the hardware does not report where a rule already watches it', async () => {
    const backwall = rule({ id: 'rule-fan', name: 'Back-wall fan', watch: { kind: 'output_level', output: 'fanBackwall', upper: 0.9, lower: null } });
    vi.mocked(api.get).mockImplementation(
      (path: string) => Promise.resolve(path === '/devices/device-1/alarm-rules' ? { items: [backwall], nextCursor: null } : answers(path)) as never,
    );
    draw();

    fireEvent.click(await screen.findByRole('button', { name: /Back-wall fan/ }));
    const watch = within(screen.getByRole('dialog')).getByRole('group', { name: 'Watch' });

    expect(within(watch).getByRole('button', { name: 'Back-wall fan' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(watch).queryByRole('button', { name: 'Internal fan' })).not.toBeInTheDocument();
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
    fireEvent.change(within(sheet).getByRole('spinbutton', { name: 'every' }), { target: { value: '15' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save the alarm' }));

    const body: AlarmRuleCreate = {
      name: 'Too humid',
      watch: { kind: 'reading', metric: 'humidity', upper: 60, lower: null },
      forSeconds: 1200,
      severity: 'critical',
      enabled: true,
      cooldownSeconds: 0,
      repeatSeconds: 900,
      delivery: { mode: 'routing', custom: null },
    };
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/devices/device-1/alarm-rules', body));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('repeats a critical rule every half hour, and asks nothing about repeating a quieter one', async () => {
    const sheet = await openNew();

    expect(within(sheet).getByRole('spinbutton', { name: 'every' })).toHaveValue(30);

    fireEvent.change(within(sheet).getByLabelText('above'), { target: { value: '31' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'warning' }));
    expect(within(sheet).queryByRole('spinbutton', { name: 'every' })).not.toBeInTheDocument();

    fireEvent.click(within(sheet).getByRole('button', { name: 'Save the alarm' }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/devices/device-1/alarm-rules', expect.objectContaining({ severity: 'warning', repeatSeconds: 0 })),
    );
  });

  it('leaves a repeat somebody typed alone when the severity is chosen again', async () => {
    const sheet = await openNew();

    fireEvent.change(within(sheet).getByLabelText('above'), { target: { value: '31' } });
    fireEvent.change(within(sheet).getByRole('spinbutton', { name: 'every' }), { target: { value: '45' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'critical' }));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save the alarm' }));

    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/devices/device-1/alarm-rules', expect.objectContaining({ repeatSeconds: 2700 })));
  });

  /**
   * The sheet asks about repeating only where the question is offered, so a
   * quieter rule that already repeats is edited without ever seeing that
   * field. Saving it must therefore hand the interval back untouched: the
   * rules the migration wrote carry one at every severity, and a save that
   * zeroed it would silence a rule nobody meant to change.
   */
  it('gives a warning rule its repeat back when it is saved with nothing changed', async () => {
    const carried = rule({
      id: 'rule-carried',
      name: 'Fridge running non-stop',
      origin: 'human',
      watch: { kind: 'reading', metric: 'humidity', upper: 80, lower: null },
      forSeconds: 900,
      severity: 'warning',
      repeatSeconds: 600,
      delivery: { mode: 'custom', custom: { channel: 'email', target: 'you@example.invalid', includeDetails: true, webhook: null } },
    });
    vi.mocked(api.get).mockImplementation(
      (path: string) => Promise.resolve(path === '/devices/device-1/alarm-rules' ? { items: [carried], nextCursor: null } : answers(path)) as never,
    );
    draw();

    fireEvent.click(await screen.findByRole('button', { name: /Fridge running non-stop/ }));
    const sheet = screen.getByRole('dialog', { name: 'Edit the alarm' });
    expect(within(sheet).queryByRole('spinbutton', { name: 'every' })).not.toBeInTheDocument();

    fireEvent.click(within(sheet).getByRole('button', { name: 'Save the alarm' }));

    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith('/alarm-rules/rule-carried', {
        name: 'Fridge running non-stop',
        watch: { kind: 'reading', metric: 'humidity', upper: 80, lower: null },
        forSeconds: 900,
        severity: 'warning',
        repeatSeconds: 600,
        delivery: { mode: 'custom', custom: { channel: 'email', target: 'you@example.invalid', includeDetails: true, webhook: null } },
      }),
    );
  });

  it('asks the offline rule none of the questions it has no answer to, and saves it', async () => {
    draw();

    fireEvent.click(await screen.findByRole('button', { name: /Controller offline/ }));
    const sheet = screen.getByRole('dialog', { name: 'Edit the alarm' });

    expect(within(sheet).queryByRole('group', { name: 'Watch' })).not.toBeInTheDocument();
    expect(within(sheet).queryByLabelText('above')).not.toBeInTheDocument();
    // Nor the name: this rule is titled from the hardware it watches, in the
    // reader's language, so a name typed here changed nothing any screen drew.
    expect(within(sheet).queryByRole('textbox', { name: 'Name' })).not.toBeInTheDocument();
    expect(within(sheet).getByText(/watches whether the device reports at all/)).toBeInTheDocument();
    expect(within(sheet).getByText(/On top of the ten minutes/)).toBeInTheDocument();

    fireEvent.click(within(sheet).getByRole('button', { name: 'Save the alarm' }));

    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith('/alarm-rules/rule-offline', {
        name: 'Controller offline',
        watch: { kind: 'reading', metric: 'offline', upper: null, lower: null },
        forSeconds: 600,
        severity: 'critical',
        repeatSeconds: 1800,
        delivery: { mode: 'routing', custom: null },
      }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('holds the keyboard inside itself, closes on Escape and hands the focus back', async () => {
    draw();
    const opener = await screen.findByRole('button', { name: /Too hot/ });
    opener.focus();
    fireEvent.click(opener);

    const sheet = screen.getByRole('dialog', { name: 'Edit the alarm' });
    expect(document.activeElement).toBe(sheet);

    const first = within(sheet).getByRole('button', { name: 'Close' });
    const last = within(sheet).getByRole('button', { name: 'Delete the alarm' });

    last.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(first);

    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(document.activeElement).toBe(opener);
  });

  it('leaves the cursor where it is typing when the page clock ticks', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      draw();
      fireEvent.click(await screen.findByRole('button', { name: /Too hot/ }));
      const name = within(screen.getByRole('dialog')).getByRole('textbox', { name: 'Name' });
      name.focus();

      await act(async () => {
        vi.advanceTimersByTime(10_000);
      });

      expect(document.activeElement).toBe(name);
    } finally {
      vi.useRealTimers();
    }
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

  it('keeps what the sheet is for out of the part that scrolls, so a long rule still shows its Save', async () => {
    const sheet = await openNew();

    expect(sheet.querySelector('footer')).toContainElement(within(sheet).getByRole('button', { name: 'Save the alarm' }));
    expect(within(sheet).getByRole('group', { name: 'Watch' }).closest('footer')).toBeNull();
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

  it('names the channels the grid routes that severity to, in one order, and says which of them go nowhere', () => {
    const account = {
      ...me,
      pushSubscribed: false,
      notifications: { routing: { alerts: ['webhook', 'push'], warnings: [], tasks: ['push'] }, channels: { ...me.notifications.channels } },
    } as unknown as Me;

    expect(routedChannels(account, 'critical')).toEqual([
      { channel: 'push', configured: false },
      { channel: 'webhook', configured: false },
    ]);
    expect(routedChannels(account, 'warning')).toEqual([]);
    expect(routedChannels(account, 'info')).toEqual([]);
    expect(routedChannels(undefined, 'critical')).toEqual([]);

    const t = ((key: string, options?: Record<string, unknown>) =>
      key === 'alarms.channelOff' ? `${String(options?.channel)} (off)` : key.split('.').pop()!) as (
      key: string,
      options?: Record<string, unknown>,
    ) => string;
    expect(channelsLabel(t, routedChannels(account, 'critical'))).toBe('push (off) + webhook (off)');
  });

  it('reads headers off their lines and drops what is not one', () => {
    expect(headersOf('X-Token: abc\n\nAuthorization: Bearer a:b\nnothing')).toEqual({ 'X-Token': 'abc', Authorization: 'Bearer a:b' });
  });

  /**
   * The three stand next to each other in one row of chips, where one of them
   * in another case reads as a mistake - and the inbox says the same word
   * about the same rule one screen away, where the two spellings side by side
   * read as two different things.
   */
  it('writes the three severities in one case in each language, and writes them the same way in the inbox', async () => {
    for (const language of ['en', 'de']) {
      const catalogue = JSON.parse(await readFile(resolve(process.cwd(), `public/assets/i18n/${language}.json`), 'utf8'));
      const cased = Object.values(catalogue.alarms.severity).map(label => /^\p{Lu}/u.test(String(label)));

      expect(new Set(cased).size).toBe(1);
      expect(catalogue.alerts.severity).toEqual(catalogue.alarms.severity);
    }
  });
});
