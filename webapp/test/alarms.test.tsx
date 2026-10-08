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
import { boundLabel, channelsLabel, repeatsEvery, routedChannels, scaleNote, type Translate, watchLabel } from '@/screens/control/alarms/rules';
import { ruleFor, templateBody, templatesFor } from '@/screens/control/alarms/templates';
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

const draw = (devices: Device[] = [device()], mayManage = true, at = '/control/alarms?space=space-1') =>
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
    expect(screen.getByRole('link', { name: 'Add a device' })).toHaveAttribute('href', '/claim');
    expect(screen.queryByRole('link', { name: '‹ back to the plan' })).not.toBeInTheDocument();
  });

  it('lists the rules of a plug, which measures no climate and is given one all the same', async () => {
    const offline = rule({
      id: 'rule-plug',
      deviceId: 'plug-1',
      name: 'Plug offline',
      origin: 'always',
      watch: { kind: 'reading', metric: 'offline', upper: null, lower: null },
      repeatSeconds: 1800,
    });
    vi.mocked(api.get).mockImplementation(
      (path: string) => Promise.resolve(path === '/devices/plug-1/alarm-rules' ? { items: [offline], nextCursor: null } : answers(path)) as never,
    );
    draw([device({ id: 'plug-1', type: 'plug', name: 'Pump socket' })]);

    expect(await screen.findByText('Device offline')).toBeInTheDocument();
    expect(screen.queryByText(/Nothing stands here that has alarm rules/)).not.toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Device offline on or off' })).toBeEnabled();
  });

  it('lists a device this build knows nothing about as long as it holds a rule, and offers it no new one', async () => {
    const mystery = rule({ id: 'rule-mystery', deviceId: 'mystery-1', name: 'Tank empty', origin: 'device' });
    vi.mocked(api.get).mockImplementation(
      (path: string) => Promise.resolve(path === '/devices/mystery-1/alarm-rules' ? { items: [mystery], nextCursor: null } : answers(path)) as never,
    );
    draw([device({ id: 'mystery-1', type: 'watering-computer' })]);

    expect(await screen.findByText('Tank empty')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '+ Custom alarm' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Set up/ })).not.toBeInTheDocument();
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
    // No duration is not no condition: the card still has to say what it watches.
    expect(within(row).getByText('Dehumidifier running')).toBeInTheDocument();
  });

  /**
   * A rule on an output is titled from whatever its author typed, which may
   * name nothing - the webhook rule here is called "My Webhook" - so the watch
   * itself is the only thing that can tell the grower what the rule is for.
   */
  it('states what an output rule watches, whatever its author called it', async () => {
    draw();

    const running = await card('Dehumidifier running non-stop');
    expect(within(running).getByText('Dehumidifier running')).toBeInTheDocument();
    expect(within(running).getByText('longer than 2 h')).toBeInTheDocument();

    // A reading rule is titled from its metric already, so it is not said twice.
    const hot = await card('Too hot');
    expect(within(hot).queryByText(/running/)).not.toBeInTheDocument();
  });

  it('groups the rules by where they came from, under the preset the grow stands on', async () => {
    draw();

    expect(await screen.findByText('From the Flower preset')).toBeInTheDocument();
    expect(screen.getByText('thresholds move with the stage')).toBeInTheDocument();
    // The place is named by the title of Steuerung above the page, not a second time here.
    expect(screen.getByText('Alarms')).toBeInTheDocument();
    // The tab opens on the targets unless a plan runs, so that is where the way back leads.
    expect(screen.getByRole('link', { name: '‹ targets' })).toHaveAttribute('href', '/control?space=space-1');

    const labels = screen.getAllByText(/^(From the Flower preset|Always on|From the device|Written here)$/).map(label => label.textContent);
    expect(labels).toEqual(['From the Flower preset', 'Always on', 'From the device', 'Written here']);
  });

  it('writes the bound and the meta line of a preset rule, an always rule and a rule with its own webhook', async () => {
    draw();

    const hot = await card('Too hot');
    expect(within(hot).getByText('above 30 °C')).toBeInTheDocument();
    expect(within(hot).getByText('preset · for 10 min · critical · goes to you by push + Telegram · announced once')).toBeInTheDocument();

    const offline = await card('Device offline');
    expect(within(offline).getByText('always · for 10 min · critical · goes to you by push + Telegram · repeats every 30 min')).toBeInTheDocument();

    const running = await card('Dehumidifier running non-stop');
    expect(within(running).getByText('longer than 2 h')).toBeInTheDocument();
    expect(within(running).getByText('device · warning · goes to you by push · announced once')).toBeInTheDocument();
    expect(within(running).getByRole('img', { name: 'triggered right now' })).toBeInTheDocument();

    const hook = await card('Pump watchdog');
    expect(within(hook).getByText('above 0.5')).toBeInTheDocument();
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
    const offline = await card('Device offline');
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

    // The cloud's own rule is "Device offline" here as on the cockpit, whatever the server stored and the device is called.
    expect(await screen.findByText('Device offline')).toBeInTheDocument();
    expect(screen.queryByText('Controller offline')).not.toBeInTheDocument();
    expect(screen.queryByText('Blue Dream tent offline')).not.toBeInTheDocument();
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

  /**
   * "Does not reach you" used to be the end of the line. It is the account's
   * own settings that decide it, so it is said as the way there - outside the
   * card's button, which a link cannot stand inside.
   */
  it('says once, over the list, that no alarm reaches an account with no way set up, and leaves the cards quiet about it', async () => {
    const unreached = { ...me, pushSubscribed: false, notifications: { ...me.notifications, routing: { alerts: [], warnings: ['push'] } } };
    vi.mocked(api.get).mockImplementation((path: string) => Promise.resolve(path === '/me' ? unreached : answers(path)) as never);
    draw();

    expect(await screen.findByText('Alarms do not reach you')).toBeInTheDocument();
    const offline = await card('Device offline');
    expect(within(offline).getByText('always · for 10 min · critical')).toBeInTheDocument();
    expect(within(offline).queryByRole('link', { name: 'does not reach you · set up ›' })).not.toBeInTheDocument();
  });

  it('says a rule nobody hears as the way to change that, where other alarms do arrive', async () => {
    const warningsLost = {
      ...me,
      pushSubscribed: false,
      notifications: { ...me.notifications, routing: { alerts: ['telegram'], warnings: ['push'] } },
    };
    vi.mocked(api.get).mockImplementation((path: string) => Promise.resolve(path === '/me' ? warningsLost : answers(path)) as never);
    draw();

    // Named on the row but set up nowhere is a dead end, and gets the way out on the card.
    const running = await card('Dehumidifier running non-stop');
    expect(within(running).getByText('device · warning · goes to you by push (off) · announced once')).toBeInTheDocument();
    expect(within(running).getByRole('link', { name: 'does not reach you · set up ›' })).toBeInTheDocument();

    // A rule with a target of its own goes out whatever the account set.
    expect(within(await card('Pump watchdog')).queryByRole('link')).not.toBeInTheDocument();
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
    expect(within(co2).getByText('above 1500 ppm')).toBeInTheDocument();
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

  /**
   * The footer under the list used to put a silence and a maintenance window
   * behind the one word "pause". Only maintenance reaches the engine; a silence
   * is read by the delivery alone, so the rule goes on tripping and the grower
   * who silenced it for an hour is alarmed by it anyway. The page has to say
   * which of the two it is offering - one tap away, rather than in a paragraph
   * under every list.
   */
  it('says that a muted rule keeps watching, and that maintenance is the one that holds the alarm', async () => {
    draw();

    const info = await screen.findByRole('button', { name: 'About Muting and maintenance' });
    expect(info).toHaveAccessibleDescription(/A muted rule keeps watching: .* it only tells nobody\./);
    expect(info).toHaveAccessibleDescription(/Maintenance mode holds the alarms themselves back/);
  });

  /**
   * The engine skips a worked-on device for ten minutes after its window has
   * run out, so a maintenance the app calls fifteen minutes keeps the alarms
   * quiet for twenty-five. The explanation states both spans rather than the
   * one that was promised and not kept.
   */
  it('names the settling the engine adds to a maintenance window, not the window alone', async () => {
    draw();

    expect(await screen.findByRole('button', { name: 'About Muting and maintenance' })).toHaveAccessibleDescription(
      /for its 15 minutes and 10 more, while the climate comes back/,
    );
  });

  /**
   * Nothing in the app read `maintenanceUntil`, so a device whose every alarm
   * the engine was refusing to turn was drawn exactly like one that was being
   * watched: switches armed, dots lit, and the only trace of the step-in a
   * diary line that says when it began. The page says it now, and says when the
   * watch comes back - which is later than the window, because the engine holds
   * a worked-on device for the settling as well.
   */
  it('says that the device is in maintenance and until when the alarms are held, and ends it on request', async () => {
    const until = NOW.plus({ minutes: 9 });
    const there = (at: DateTime) => at.setZone('Europe/Berlin').toFormat('HH:mm');
    vi.mocked(api.post).mockResolvedValue({ publishedAt: NOW.toISO(), deviceOnline: true } as never);
    draw([device({ state: { ...device().state, maintenanceUntil: until.toISO()! } })]);

    const banner = await screen.findByRole('status');
    expect(banner).toHaveTextContent(`In maintenance until ${there(until)}`);
    expect(banner).toHaveTextContent(`no alarm on this device until ${there(until.plus({ minutes: 10 }))}`);

    fireEvent.click(within(banner).getByRole('button', { name: 'End now' }));

    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/devices/device-1/commands', { kind: 'maintenance', forSeconds: 0 }));
  });

  /**
   * The page's clock beats every ten seconds, and a window that End has just
   * moved to this instant was still in that clock's future: for up to ten
   * seconds the card went on saying the device was in maintenance and offered
   * End again.
   */
  it('stops offering End the moment the window it ended comes back', async () => {
    const parked = device({ state: { ...device().state, maintenanceUntil: NOW.plus({ minutes: 9 }).toISO()! } });
    const drawn = draw([parked]);
    await screen.findByRole('button', { name: 'End now' });
    await new Promise(settle => setTimeout(settle, 30));

    const ended = device({ state: { ...device().state, maintenanceUntil: DateTime.now().toISO()! } });
    drawn.rerender(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={['/control/alarms?space=space-1']}>
          <Alarms spaceId="space-1" devices={[ended]} mayManage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByText(/Out of maintenance/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'End now' })).not.toBeInTheDocument();
  });

  /**
   * The ten minutes after the window are the ones nothing named at all: the
   * hardware is running again, so every screen said the device was fine, while
   * the engine went on refusing to raise anything about it.
   */
  it('goes on saying so through the settling after the window, with nothing left to end', async () => {
    const ended = NOW.minus({ minutes: 4 });
    draw([device({ state: { ...device().state, maintenanceUntil: ended.toISO()! } })]);

    const banner = await screen.findByRole('status');
    expect(banner).toHaveTextContent('Out of maintenance');
    expect(banner).toHaveTextContent(`no alarm on this device until ${ended.plus({ minutes: 10 }).setZone('Europe/Berlin').toFormat('HH:mm')}`);
    expect(within(banner).queryByRole('button', { name: 'End now' })).not.toBeInTheDocument();
  });

  it('says nothing about maintenance on a device nobody is working on', async () => {
    draw();

    await screen.findByText('Too hot');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('calls the stage group by the stage alone where nothing grows here yet', async () => {
    vi.mocked(api.get).mockImplementation(
      (path: string) => Promise.resolve(path === '/spaces/space-1/overview' ? { ...overview, grows: [] } : answers(path)) as never,
    );
    draw();

    expect(await screen.findByText('From the stage preset')).toBeInTheDocument();
  });

  it('marks the rule an alert linked to, and opens it for whoever may change it', async () => {
    draw([device()], true, '/control/alarms?space=space-1&rule=rule-offline');

    expect(await card('Device offline')).toHaveAttribute('data-highlight');
    expect(await card('Too hot')).not.toHaveAttribute('data-highlight');
    expect(await screen.findByRole('dialog', { name: 'Edit the alarm' })).toBeInTheDocument();
  });

  it('only marks the linked rule for a reader who may not change it', async () => {
    draw([device()], false, '/control/alarms?space=space-1&rule=rule-offline');

    expect(await card('Device offline')).toHaveAttribute('data-highlight');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
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
    expect(screen.queryByRole('button', { name: '+ Custom alarm' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Set up/ })).not.toBeInTheDocument();
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

  /**
   * Owner's decision G2: the stage's "too humid" rests while its device
   * germinates unless the grower asked to be warned there too, and warns at
   * germination's line where they did. It stays switched on, so the card says
   * it rests and where that is changed. A person's own "too humid" is theirs and
   * watches throughout.
   */
  it('says the stage´s "too humid" rests while the device germinates, and where that is changed', async () => {
    const humid = rule({ id: 'rule-humid', origin: 'preset', watch: { kind: 'reading', metric: 'humidity', upper: 72, lower: null } });
    const mine = rule({ id: 'rule-mine', name: 'Box soaking', watch: { kind: 'reading', metric: 'humidity', upper: 95, lower: null } });
    vi.mocked(api.get).mockImplementation(
      (path: string) =>
        Promise.resolve(path === '/devices/device-1/alarm-rules' ? { items: [humid, mine, RULES[0]], nextCursor: null } : answers(path)) as never,
    );
    const germinating = (warnTooHumid: boolean) =>
      device({
        configuration: { workmode: 'breed' },
        control: {
          running: true,
          drying: false,
          mode: 'germination',
          energySaving: false,
          germinationChoices: { warnTooHumid, humidifierHolds: true },
        },
      });
    const view = draw([germinating(false)]);

    const card_ = await card('Too humid');
    expect(within(card_).getByRole('switch')).toHaveAttribute('aria-checked', 'true');
    expect(within(card_).getByRole('link', { name: 'rests during germination · change under Control ›' })).toHaveAttribute(
      'href',
      '/control?space=space-1',
    );
    expect(within(await card('Too hot')).queryByText(/rests during germination/)).not.toBeInTheDocument();
    expect(within(await card('Box soaking')).queryByText(/rests during germination/)).not.toBeInTheDocument();
    view.unmount();

    draw([germinating(true)]);
    const warning = await card('Too humid');
    expect(within(warning).queryByText(/rests during germination/)).not.toBeInTheDocument();
    // It warns at germination's line, and its own comes back afterwards.
    expect(within(warning).getByText('above 90 %')).toBeInTheDocument();
    expect(within(warning).getByText('during germination · above 72 % again afterwards')).toBeInTheDocument();
    expect(within(await card('Box soaking')).getByText('above 95 %')).toBeInTheDocument();
  });
});

describe('the rule sheet', () => {
  const openNew = async () => {
    draw([device({}, { co2: 'on' })]);
    fireEvent.click(await screen.findByRole('button', { name: '+ Custom alarm' }));

    return screen.getByRole('dialog', { name: 'New alarm' });
  };

  /**
   * A rule written for an account nothing reaches is announced to nobody. For
   * a critical one the fix is offered in the sheet - the same tap the notice on
   * Start offers, which leaves the sheet and its draft where they are; for a
   * warning it is the way to the settings that route one.
   */
  it('offers the fix where a rule would reach nobody, in place for a critical one', async () => {
    const unreached = {
      ...me,
      email: 'login@example.invalid',
      notifications: { ...me.notifications, channels: { email: null, telegram: null, webhook: null }, routing: { alerts: [], warnings: [] } },
    };
    const reached = {
      ...unreached,
      notifications: {
        ...unreached.notifications,
        channels: { ...unreached.notifications.channels, email: 'login@example.invalid' },
        routing: { alerts: ['email'], warnings: [] },
      },
    };
    vi.mocked(api.get).mockImplementation((path: string) => Promise.resolve(path === '/me' ? unreached : answers(path)) as never);
    vi.mocked(api.post).mockImplementation(
      (path: string, body: unknown) => Promise.resolve(path === '/me/email-alarms' ? reached : { ...RULES[0], ...(body as object) }) as never,
    );
    const sheet = await openNew();
    fireEvent.click(within(sheet).getByRole('button', { name: 'critical' }));

    expect(within(sheet).getByText(/^Not announced: no way to reach you is set up for critical yet\.$/)).toBeInTheDocument();
    expect(within(sheet).getByText('to login@example.invalid')).toBeInTheDocument();
    expect(within(sheet).queryByRole('link', { name: /Other ways/ })).not.toBeInTheDocument();
    // The sheet's own Save stays the one green action in it.
    expect(within(sheet).getByRole('button', { name: 'Notify me by e-mail' }).className).not.toMatch(/primary/);

    fireEvent.click(within(sheet).getByRole('button', { name: 'Notify me by e-mail' }));

    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/me/email-alarms'));
    expect(await within(sheet).findByText('Goes out by e-mail.')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'New alarm' })).toBeInTheDocument();

    fireEvent.click(within(sheet).getByRole('button', { name: 'warning' }));
    expect(within(sheet).getByRole('link', { name: 'Set up notifications ›' })).toHaveAttribute('href', '/me/notifications');
  });

  /**
   * A fan runs at 0 to 100 like the light does. The sheet used to show the
   * light's percent and tell everything else it was writing a fraction, so
   * somebody writing a rule on a fan was instructed to type 0.5 on a series that
   * sits at 100 - a rule out of band on every sample from then on.
   */
  it('writes a fan level in percent and offers no fraction to type instead', async () => {
    vi.mocked(api.get).mockImplementation(
      (path: string) => Promise.resolve(path === '/devices/fan-1/alarm-rules' ? { items: [], nextCursor: null } : answers(path)) as never,
    );
    draw([device({ id: 'fan-1', type: 'fan', name: 'Exhaust fan' })]);
    fireEvent.click(await screen.findByRole('button', { name: '+ Custom alarm' }));
    const sheet = screen.getByRole('dialog', { name: 'New alarm' });

    fireEvent.click(within(sheet).getByRole('button', { name: 'Fan' }));
    fireEvent.click(within(sheet).getByRole('button', { name: 'its level' }));

    const bounds = within(sheet).getByRole('spinbutton', { name: 'above' }).closest('label')!;
    expect(bounds).toHaveTextContent('%');
    expect(within(sheet).queryByText(/As a fraction of the time it runs/)).not.toBeInTheDocument();
  });

  it('offers the readings the device reports and the outputs its hardware drives', async () => {
    const sheet = await openNew();
    const watch = within(sheet).getByRole('group', { name: 'Watch' });

    expect(within(watch).getByRole('button', { name: 'CO₂' })).toBeInTheDocument();
    expect(within(watch).queryByRole('button', { name: 'Leaf temperature' })).not.toBeInTheDocument();
    expect(within(watch).queryByRole('button', { name: 'Offline' })).not.toBeInTheDocument();
    expect(within(watch).getByRole('button', { name: 'Dehumidifier' })).toBeInTheDocument();
    expect(within(watch).queryByRole('button', { name: 'Internal fan' })).not.toBeInTheDocument();
    expect(within(watch).queryByRole('button', { name: 'Relay' })).not.toBeInTheDocument();
  });

  /**
   * A plug drives one relay and measures a climate as well, and the sheet used
   * to offer the relay alone - on the grounds that a plug reports nothing but
   * what it is driving, which its own protocol and its own live readings both
   * contradict. Its CO2 stays an answer about this plug rather than about
   * plugs, because whether that sensor is fitted is the device's to say.
   */
  it('calls a fridge´s outputs what the cockpit calls them, and offers the CO2 its tile shows', async () => {
    vi.mocked(api.get).mockImplementation(
      (path: string) => Promise.resolve(path === '/devices/fridge-1/alarm-rules' ? { items: [], nextCursor: null } : answers(path)) as never,
    );
    draw([device({ id: 'fridge-1', type: 'fridge', name: 'Fridge module' })]);

    fireEvent.click(await screen.findByRole('button', { name: '+ Custom alarm' }));
    const watch = within(screen.getByRole('dialog', { name: 'New alarm' })).getByRole('group', { name: 'Watch' });

    expect(within(watch).getByRole('button', { name: 'Compressor' })).toBeInTheDocument();
    expect(within(watch).queryByRole('button', { name: 'Dehumidifier' })).not.toBeInTheDocument();
    expect(within(watch).getByRole('button', { name: 'Clip fan' })).toBeInTheDocument();
    expect(within(watch).getByRole('button', { name: 'CO₂' })).toBeInTheDocument();
    expect(within(watch).getByRole('button', { name: 'CO₂ valve' })).toBeInTheDocument();
  });

  it('offers a plug both the output it drives and the climate it measures', async () => {
    vi.mocked(api.get).mockImplementation(
      (path: string) => Promise.resolve(path === '/devices/plug-1/alarm-rules' ? { items: [], nextCursor: null } : answers(path)) as never,
    );
    draw([device({ id: 'plug-1', type: 'plug', name: 'Pump socket' })]);

    fireEvent.click(await screen.findByRole('button', { name: '+ Custom alarm' }));
    const watch = within(screen.getByRole('dialog', { name: 'New alarm' })).getByRole('group', { name: 'Watch' });

    expect(within(watch).getByRole('button', { name: 'Relay' })).toBeInTheDocument();
    expect(within(watch).getByRole('button', { name: 'Temperature' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(watch).getByRole('button', { name: 'VPD' })).toBeInTheDocument();
    expect(within(watch).queryByRole('button', { name: 'CO₂' })).not.toBeInTheDocument();
  });

  /**
   * The one fan in Place 2 draws that whole tent's climate on Home and on the
   * space overview, and the sheet for writing a rule on it offered no reading
   * at all - while opening a temperature rule that already existed on the same
   * device did offer one. So the only climate in that tent could be alarmed on
   * only by somebody who already had an alarm on it.
   */
  it('offers a fan the temperature, humidity and VPD it measures, not its output alone', async () => {
    vi.mocked(api.get).mockImplementation(
      (path: string) => Promise.resolve(path === '/devices/fan-2/alarm-rules' ? { items: [], nextCursor: null } : answers(path)) as never,
    );
    draw([device({ id: 'fan-2', type: 'fan', name: 'Exhaust fan' })]);

    fireEvent.click(await screen.findByRole('button', { name: '+ Custom alarm' }));
    const watch = within(screen.getByRole('dialog', { name: 'New alarm' })).getByRole('group', { name: 'Watch' });

    expect(within(watch).getByRole('button', { name: 'Temperature' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(watch).getByRole('button', { name: 'Humidity' })).toBeInTheDocument();
    expect(within(watch).getByRole('button', { name: 'VPD' })).toBeInTheDocument();
    expect(within(watch).getByRole('button', { name: 'Fan' })).toBeInTheDocument();
    // A fan reports no CO2 and no light, so neither is offered for it.
    expect(within(watch).queryByRole('button', { name: 'CO₂' })).not.toBeInTheDocument();
    expect(within(watch).queryByRole('button', { name: 'PPFD' })).not.toBeInTheDocument();
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
    fireEvent.click(within(sheet).getByRole('button', { name: 'Humidity' }));
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

  it('repeats a critical rule every half hour, and keeps the repeat of a quieter one under Advanced', async () => {
    const sheet = await openNew();

    expect(within(sheet).getByRole('spinbutton', { name: 'every' })).toHaveValue(30);

    fireEvent.change(within(sheet).getByLabelText('above'), { target: { value: '31' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'warning' }));
    expect(within(sheet).queryByRole('spinbutton', { name: 'every' })).not.toBeInTheDocument();

    fireEvent.click(within(sheet).getByText('Advanced'));
    expect(within(sheet).getByRole('spinbutton', { name: 'every' })).toHaveValue(0);
    fireEvent.change(within(sheet).getByRole('spinbutton', { name: 'every' }), { target: { value: '5' } });

    fireEvent.click(within(sheet).getByRole('button', { name: 'Save the alarm' }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/devices/device-1/alarm-rules', expect.objectContaining({ severity: 'warning', repeatSeconds: 300 })),
    );
  });

  it('fills a Home Assistant webhook from its address and id, through the tunnel for an address at home', async () => {
    const sheet = await openNew();

    fireEvent.change(within(sheet).getByLabelText('above'), { target: { value: '31' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'a webhook' }));
    fireEvent.click(within(sheet).getByText('Advanced'));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Home Assistant' }));
    fireEvent.change(within(sheet).getByRole('textbox', { name: 'Home Assistant URL' }), { target: { value: 'http://homeassistant.local:8123/' } });
    fireEvent.change(within(sheet).getByRole('textbox', { name: 'Webhook ID' }), { target: { value: 'grow-alarm' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Fill in the fields' }));

    expect(within(sheet).getByRole('textbox', { name: 'URL' })).toHaveValue('http://homeassistant.local:8123/api/webhook/grow-alarm');
    expect(within(sheet).getByRole('status')).toHaveTextContent('goes through the device');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save the alarm' }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(
        '/devices/device-1/alarm-rules',
        expect.objectContaining({
          delivery: {
            mode: 'custom',
            custom: expect.objectContaining({
              channel: 'webhook',
              target: 'http://homeassistant.local:8123/api/webhook/grow-alarm',
              webhook: expect.objectContaining({ method: 'POST', tunnel: true }),
            }),
          },
        }),
      ),
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
   * The rules the migration wrote carry a repeat at every severity, and a
   * save that zeroed it would silence a rule nobody meant to change: saving
   * it with nothing changed hands the interval back untouched.
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
    // A quieter rule that already repeats opens Advanced, so the interval is never folded away.
    expect(within(sheet).getByRole('spinbutton', { name: 'every' })).toHaveValue(10);

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

    fireEvent.click(await screen.findByRole('button', { name: /Device offline/ }));
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

  it('opens a rule a stage wrote under the name the list shows, not the server´s English one', async () => {
    vi.mocked(api.get).mockImplementation(
      (path: string) =>
        Promise.resolve(
          path === '/devices/device-1/alarm-rules'
            ? {
                items: [
                  rule({
                    id: 'rule-wet',
                    name: 'Server name',
                    origin: 'preset',
                    watch: { kind: 'reading', metric: 'humidity', upper: 70, lower: null },
                  }),
                ],
                nextCursor: null,
              }
            : answers(path),
        ) as never,
    );
    draw();
    fireEvent.click(await screen.findByRole('button', { name: /Too humid/ }));

    expect(within(screen.getByRole('dialog', { name: 'Edit the alarm' })).getByRole('textbox', { name: 'Name' })).toHaveValue('Too humid');
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

    fireEvent.click(await screen.findByRole('button', { name: /Device offline/ }));
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

/**
 * Too warm, too cold, too humid, too dry: the four alarms most tents want, each
 * one tap from an ordinary rule. The full sheet stays behind "+ Custom alarm".
 */
describe('the alarm templates', () => {
  it('offers the templates whose rule this device lacks, and writes one in a single tap', async () => {
    draw();

    // The stage's "Too hot" already watches the temperature from above, so that one is not offered again.
    expect(await screen.findByRole('button', { name: 'Set up Too cold: below 15 °C · 15 min' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Set up Too warm/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Set up Too dry: below 35 % · 20 min' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Set up Too humid: above 75 % · 20 min' }));

    const body: AlarmRuleCreate = {
      name: 'Too humid',
      watch: { kind: 'reading', metric: 'humidity', upper: 75, lower: null },
      forSeconds: 1200,
      severity: 'critical',
      enabled: true,
      cooldownSeconds: 0,
      repeatSeconds: 0,
      delivery: { mode: 'routing', custom: null },
    };
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/devices/device-1/alarm-rules', body));
    // Nothing else was asked: no sheet opened on the way.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('marks the rule a template wrote, which opens like any other', async () => {
    const made = rule({
      id: 'rule-made',
      name: 'Too cold',
      watch: { kind: 'reading', metric: 'temperature', upper: null, lower: 15 },
      forSeconds: 900,
    });
    let written = false;
    vi.mocked(api.get).mockImplementation(
      (path: string) =>
        Promise.resolve(
          path === '/devices/device-1/alarm-rules' ? { items: written ? [...RULES, made] : RULES, nextCursor: null } : answers(path),
        ) as never,
    );
    vi.mocked(api.post).mockImplementation(() => {
      written = true;
      return Promise.resolve(made) as never;
    });
    draw();

    fireEvent.click(await screen.findByRole('button', { name: /^Set up Too cold/ }));

    const card = await waitFor(() => {
      const one = screen.getByRole('button', { name: /^Too cold/ }).closest('li')!;
      expect(one).toHaveAttribute('data-highlight', 'true');
      return one;
    });
    expect(screen.queryByRole('button', { name: /^Set up Too cold/ })).not.toBeInTheDocument();
    fireEvent.click(within(card).getByRole('button', { name: /^Too cold/ }));
    expect(within(screen.getByRole('dialog')).getByRole('textbox', { name: 'Name' })).toHaveValue('Too cold');
  });

  it('works each line out from the targets the device holds, and falls back where it states none', () => {
    const held = device({ configuration: { day: { temperature: 26, humidity: 60 }, night: { temperature: 20, humidity: 55 } } }, { co2: 'off' });
    const lines = (one: Device) =>
      Object.fromEntries(
        templatesFor(one).map(({ key, watch, forMinutes }) => [
          key,
          watch.kind === 'reading' ? [watch.edge, watch.value, forMinutes] : [watch.output, forMinutes],
        ]),
      );

    expect(lines(held)).toEqual({ warm: ['upper', 31, 10], cold: ['lower', 16, 15], humid: ['upper', 70, 20], dry: ['lower', 35, 20] });
    expect(lines(device({ configuration: null }, { co2: 'off' }))).toEqual({
      warm: ['upper', 30, 10],
      cold: ['lower', 15, 15],
      humid: ['upper', 75, 20],
      dry: ['lower', 35, 20],
    });
  });

  it('offers an empty CO2 cylinder only where CO2 is measured, and a compressor that does not stop only on a fridge', () => {
    const keys = (one: Device) => templatesFor(one).map(template => template.key);

    expect(keys(device({}, { co2: 'off' }))).not.toContain('co2Empty');
    expect(keys(device())).toContain('co2Empty');
    expect(templatesFor(device()).find(template => template.key === 'co2Empty')).toMatchObject({
      watch: { kind: 'reading', metric: 'co2', edge: 'lower', value: 350 },
      forMinutes: 10,
    });
    // A tent controller's dehumidifier is a room machine on a socket, which may well run for hours.
    expect(keys(device())).not.toContain('running');
    expect(templatesFor(device({ type: 'fridge' })).find(template => template.key === 'running')).toMatchObject({
      watch: { kind: 'output_running', output: 'dehumidifier' },
      forMinutes: 30,
    });
  });

  it('is not offered again once a rule watches the same thing, whoever wrote it', () => {
    const fridge = device({ type: 'fridge' });
    const empty = templatesFor(fridge).find(template => template.key === 'co2Empty')!;
    const running = templatesFor(fridge).find(template => template.key === 'running')!;

    expect(ruleFor([rule({ watch: { kind: 'reading', metric: 'co2', upper: null, lower: 300 } })], empty)).not.toBeNull();
    expect(ruleFor([rule({ watch: { kind: 'reading', metric: 'co2', upper: 1500, lower: null } })], empty)).toBeNull();
    expect(ruleFor([rule({ watch: { kind: 'output_running', output: 'dehumidifier' } })], running)).not.toBeNull();
    expect(ruleFor([rule({ watch: { kind: 'output_running', output: 'heater' } })], running)).toBeNull();
  });

  it('writes the compressor rule as a rule on the output running, named for the fridge', () => {
    const running = templatesFor(device({ type: 'fridge' })).find(template => template.key === 'running')!;

    expect(templateBody((key: string) => key, running)).toMatchObject({
      name: 'alarms.template.running.name',
      watch: { kind: 'output_running', output: 'dehumidifier' },
      forSeconds: 1800,
      severity: 'critical',
      repeatSeconds: 0,
    });
  });

  it('offers nothing a device does not measure', () => {
    expect(templatesFor(device({ type: 'watering-computer' }))).toEqual([]);
  });
});

describe('what a rule is called', () => {
  /**
   * The outputs disagree with one another about what their numbers mean, and
   * the card used to sort them into "the light" and "everything else": a fan
   * runs at 0 to 100 like the light does, and its bound was written bare while
   * the inbox printed the same figure as a percent. What each one carries is
   * what each one is written in.
   */
  it('writes a bound in the unit the series carries, output by output, in words', () => {
    const t = i18next.t.bind(i18next) as Translate;
    expect(boundLabel(t, { kind: 'reading', metric: 'temperature', upper: 30, lower: 16 })).toBe('above 30 °C · below 16 °C');
    expect(boundLabel(t, { kind: 'reading', metric: 'vpd', upper: null, lower: 0.8 })).toBe('below 0.80 kPa');
    expect(boundLabel(t, { kind: 'output_level', output: 'light', upper: 80, lower: null })).toBe('above 80 %');
    expect(boundLabel(t, { kind: 'output_level', output: 'fan', upper: null, lower: 60 })).toBe('below 60 %');
    // A PID output is a fraction of the time it runs, so it has no sign - and
    // it keeps its decimals rather than being rounded to the 0 or 1 the
    // inbox used to print it as.
    expect(boundLabel(t, { kind: 'output_level', output: 'heater', upper: 0.5, lower: null })).toBe('above 0.5');
    expect(boundLabel(t, { kind: 'output_level', output: 'dehumidifier', upper: null, lower: 1 })).toBe('below 1');
    // The CO2 output is a count of valve openings, not a level at all.
    expect(boundLabel(t, { kind: 'output_level', output: 'co2', upper: 30, lower: null })).toBe('above 30');
    expect(boundLabel(t, { kind: 'output_running', output: 'co2' })).toBe('');
  });

  it('says what a level means where its own figure does not, and nothing where the percent sign says it', () => {
    expect(scaleNote('fan')).toBeNull();
    expect(scaleNote('light')).toBeNull();
    expect(scaleNote('heater')).toBe('alarms.sheet.fractionNote');
    expect(scaleNote('relais')).toBe('alarms.sheet.switchNote');
    expect(scaleNote('co2')).toBe('alarms.sheet.ticksNote');
  });

  it('names what an output rule watches, and leaves a reading rule to its own title', () => {
    const t = ((key: string, options?: Record<string, unknown>) =>
      key === 'alarms.watchRunning' ? `${String(options?.output)} running` : key.replace('alarms.output.', '')) as Translate;

    expect(watchLabel(t, { kind: 'output_running', output: 'dehumidifier' })).toBe('dehumidifier running');
    expect(watchLabel(t, { kind: 'reading', metric: 'temperature', upper: 30, lower: null })).toBeNull();
    expect(watchLabel(t, { kind: 'output_level', output: 'light', upper: 80, lower: null })).toBeNull();
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

  it('says a rule repeats as often as the server sends it: a mail no more often than every five minutes', () => {
    const mail = { channel: 'email' as const, target: 'you@example.invalid', includeDetails: true, webhook: null };

    expect(repeatsEvery(rule({ repeatSeconds: 60, delivery: { mode: 'custom', custom: mail } }))).toBe(300);
    expect(repeatsEvery(rule({ repeatSeconds: 3600, delivery: { mode: 'custom', custom: mail } }))).toBe(3600);
    // A rule routed through the account's grid is not a mail of its own, whatever delivery it kept from before.
    expect(repeatsEvery(rule({ repeatSeconds: 60, delivery: { mode: 'routing', custom: mail } }))).toBe(60);
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
