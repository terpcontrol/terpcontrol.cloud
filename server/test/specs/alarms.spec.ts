import { anonymous, createAccount, demoSession, loginAsAdmin, Session, unique } from '../support/api';
import { capturedMail, resetMail, waitForMail } from '../support/control';
import { DeviceSimulator, provisionDevice, settle, startSimulator } from '../support/device';
import { joinSpace } from '../support/fixtures';

/**
 * The alarms: the rules watching a device, the alerts they open, and who is
 * told.
 *
 * An alert is one document from the moment something is wrong to the moment it
 * is over, so the whole episode is driven here rather than asserted on a stored
 * row - a simulator publishes a reading past the threshold and the inbox is
 * read back over HTTP, which is the only way to know that the state machine,
 * the alert, the diary line and the send decision all agree.
 *
 * The delivery is asserted from both ends. A person who has named an address
 * and asked for alarms on it gets one; a person who has asked for four channels
 * and configured none of them gets nothing, because every channel is off until
 * it is configured and this install has configured neither push nor a bot.
 */

let owner: Session;
let keeper: Session;
let helper: Session;
let stranger: Session;
let admin: Session;
let device: string;
let tent: string;
let simulator: DeviceSimulator;

const aRule = (over: Record<string, unknown> = {}) => ({
  name: unique('Too warm'),
  watch: { kind: 'reading', metric: 'temperature', upper: 30, lower: null },
  forSeconds: 0,
  severity: 'warning',
  enabled: true,
  cooldownSeconds: 0,
  repeatSeconds: 0,
  delivery: { mode: 'routing', custom: null },
  ...over,
});

const createRule = async (session: Session, deviceId: string, body: Record<string, unknown>) =>
  (await session.client.post(`/v1/devices/${deviceId}/alarm-rules`).send(body).expect(201)).body;

/** Polls the inbox until the episode the rule opened is there, or gives up. */
const waitForAlert = async (session: Session, ruleId: string, timeoutMs = 10_000) => {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const alerts = await session.client.get(`/v1/alerts?deviceId=${device}`).expect(200);
    const found = alerts.body.items.find((alert: { ruleId: string }) => alert.ruleId === ruleId);
    if (found) return found;

    await settle(250);
  }

  throw new Error(`Timed out waiting for an alert of rule ${ruleId}`);
};

beforeAll(async () => {
  owner = await createAccount('alarms-owner');
  keeper = await createAccount('alarms-keeper');
  helper = await createAccount('alarms-helper');
  stranger = await createAccount('alarms-stranger');
  admin = await loginAsAdmin();

  const claimed = await provisionDevice(owner, 'controller');
  device = claimed.deviceId;
  tent = (await owner.client.get(`/v1/devices/${device}`).expect(200)).body.spaceId;

  await joinSpace(owner, tent, keeper, 'can_manage');
  await joinSpace(owner, tent, helper, 'can_log');

  simulator = await startSimulator(claimed);
  await settle();
});

afterAll(async () => {
  await simulator?.close();
});

describe('the rules watching a device', () => {
  it('writes one at rest, with the watching half the server´s own', async () => {
    const rule = await createRule(owner, device, aRule({ name: 'Tent too warm' }));

    expect(rule).toMatchObject({
      deviceId: device,
      name: 'Tent too warm',
      watch: { kind: 'reading', metric: 'temperature', upper: 30, lower: null },
      origin: 'human',
      enabled: true,
      silencedUntil: null,
    });
    expect(rule.state).toMatchObject({ triggered: false, lastTriggeredAt: null, extremeValue: null });
  });

  it('watches an output for running at all, which has no band to give', async () => {
    const rule = await createRule(owner, device, aRule({ watch: { kind: 'output_running', output: 'dehumidifier' }, forSeconds: 3600 }));

    expect(rule.watch).toEqual({ kind: 'output_running', output: 'dehumidifier' });
  });

  it('gives an output watched for running at all no threshold, whatever was sent with it', async () => {
    const rule = await createRule(owner, device, aRule({ watch: { kind: 'output_running', output: 'dehumidifier', upper: 0.5 } }));

    // The contract's watch is a choice between shapes rather than a wider
    // enum, so a band on a running output is not a field of the rule at all -
    // and nothing can read one back off it later.
    expect(rule.watch).toEqual({ kind: 'output_running', output: 'dehumidifier' });
  });

  it('lists them, and pages through them', async () => {
    const listed = await owner.client.get(`/v1/devices/${device}/alarm-rules?limit=1`).expect(200);

    expect(listed.body.items).toHaveLength(1);
    expect(listed.body.nextCursor).toEqual(expect.any(String));
  });

  it('changes what a rule watches for, and puts it away again', async () => {
    const rule = await createRule(owner, device, aRule());

    const changed = await owner.client.patch(`/v1/alarm-rules/${rule.id}`).send({ enabled: false, forSeconds: 120 }).expect(200);
    expect(changed.body).toMatchObject({ enabled: false, forSeconds: 120 });

    await owner.client.delete(`/v1/alarm-rules/${rule.id}`).expect(204);
    await owner.client.patch(`/v1/alarm-rules/${rule.id}`).send({ enabled: true }).expect(404);
  });

  it('keeps watching while it is silenced, and says so again when the silence is lifted', async () => {
    const rule = await createRule(owner, device, aRule());

    const silenced = await owner.client.put(`/v1/alarm-rules/${rule.id}/silence`).send({ forSeconds: 3600 }).expect(200);
    expect(Date.parse(silenced.body.silencedUntil)).toBeGreaterThan(Date.now());

    const again = await owner.client.delete(`/v1/alarm-rules/${rule.id}/silence`).expect(200);
    expect(again.body.silencedUntil).toBeNull();
  });
});

describe('who may do what to a rule', () => {
  let rule: { id: string };

  beforeAll(async () => {
    rule = await createRule(owner, device, aRule({ name: unique('Matrix') }));
  });

  it('lets a manager write them', async () => {
    const theirs = await createRule(keeper, device, aRule({ name: unique('By the manager') }));

    await keeper.client.patch(`/v1/alarm-rules/${theirs.id}`).send({ severity: 'critical' }).expect(200);
    await keeper.client.delete(`/v1/alarm-rules/${theirs.id}`).expect(204);
  });

  it('lets somebody who may only log read them and change nothing', async () => {
    const listed = await helper.client.get(`/v1/devices/${device}/alarm-rules`).expect(200);
    expect(listed.body.items.map((one: { id: string }) => one.id)).toContain(rule.id);

    await helper.client.post(`/v1/devices/${device}/alarm-rules`).send(aRule()).expect(403);
    await helper.client.patch(`/v1/alarm-rules/${rule.id}`).send({ enabled: false }).expect(403);
    await helper.client.delete(`/v1/alarm-rules/${rule.id}`).expect(403);
    await helper.client.put(`/v1/alarm-rules/${rule.id}/silence`).send({ forSeconds: 60 }).expect(403);
  });

  it('tells a stranger there is no such device', async () => {
    await stranger.client.get(`/v1/devices/${device}/alarm-rules`).expect(404);
    await stranger.client.post(`/v1/devices/${device}/alarm-rules`).send(aRule()).expect(404);
    await stranger.client.patch(`/v1/alarm-rules/${rule.id}`).send({ enabled: false }).expect(404);
    await stranger.client.delete(`/v1/alarm-rules/${rule.id}`).expect(404);
  });

  it('asks anybody without a session to sign in', async () => {
    await anonymous().get(`/v1/devices/${device}/alarm-rules`).expect(401);
    await anonymous().get('/v1/alerts').expect(401);
  });

  /**
   * A rule that reports to somebody's home automation names a host on their own
   * network and carries whatever header that host asks for. That it reports
   * somewhere is not the secret; where, is.
   */
  it('hides a rule´s own webhook from a reader who may not manage the device', async () => {
    const custom = {
      mode: 'custom',
      custom: {
        channel: 'webhook',
        target: 'https://home.test.invalid/hook',
        includeDetails: true,
        webhook: { method: 'POST', headers: { 'x-token': 'secret' }, triggeredPayload: '', resolvedPayload: '', reportErrors: false, tunnel: false },
      },
    };
    const reporting = await createRule(owner, device, aRule({ name: unique('Reports home'), delivery: custom }));

    const asManager = await keeper.client.get(`/v1/devices/${device}/alarm-rules`).expect(200);
    expect(asManager.body.items.find((one: { id: string }) => one.id === reporting.id).delivery.custom).not.toBeNull();

    const asLogger = await helper.client.get(`/v1/devices/${device}/alarm-rules`).expect(200);
    const seen = asLogger.body.items.find((one: { id: string }) => one.id === reporting.id);
    expect(seen.delivery).toEqual({ mode: 'custom', custom: null });

    await owner.client.delete(`/v1/alarm-rules/${reporting.id}`).expect(204);
  });
});

describe('an episode, from the reading to the inbox', () => {
  it('opens one alert, writes one line, and closes both when the reading comes back', async () => {
    const rule = await createRule(owner, device, aRule({ name: unique('Heat') }));

    await simulator.reportStatus({ temperature: 34 });
    const alert = await waitForAlert(owner, rule.id);

    expect(alert).toMatchObject({ deviceId: device, spaceId: tent, kind: 'threshold', severity: 'warning', value: 34, resolvedAt: null });

    const read = await owner.client.get(`/v1/alerts/${alert.id}`).expect(200);
    expect(read.body.id).toBe(alert.id);

    const lines = await owner.client.get(`/v1/entries?deviceId=${device}&kinds=alarm`).expect(200);
    expect(lines.body.items.some((entry: { alertId: string }) => entry.alertId === alert.id)).toBe(true);

    await simulator.reportStatus({ temperature: 21 });
    await settle(1500);

    const closed = await owner.client.get(`/v1/alerts/${alert.id}`).expect(200);
    expect(closed.body.resolvedAt).toEqual(expect.any(String));
  });

  it('re-grades an open alert with its rule, and leaves an episode that is already over at the grade it was raised with', async () => {
    const rule = await createRule(owner, device, aRule({ name: unique('Heat'), severity: 'warning' }));

    await simulator.reportStatus({ temperature: 34 });
    const alert = await waitForAlert(owner, rule.id);
    expect(alert.severity).toBe('warning');

    await owner.client.patch(`/v1/alarm-rules/${rule.id}`).send({ severity: 'critical' }).expect(200);
    expect((await owner.client.get(`/v1/alerts/${alert.id}`).expect(200)).body.severity).toBe('critical');

    await simulator.reportStatus({ temperature: 21 });
    await settle(1500);
    await owner.client.patch(`/v1/alarm-rules/${rule.id}`).send({ severity: 'info' }).expect(200);

    const over = await owner.client.get(`/v1/alerts/${alert.id}`).expect(200);
    expect(over.body).toMatchObject({ resolvedAt: expect.any(String), severity: 'critical' });
  });

  /**
   * A rule can be retired and what it caught stays: the episodes are the record
   * of nights that really happened, and nobody deleting a rule is saying they
   * did not. What they must not become is rows naming a rule nothing can look
   * up - the inbox draws a card from its rule, so such a row read "alarm" and a
   * bare figure with no metric, no unit and no name. So the episode carries its
   * own copy of what the rule was called and watched from the moment it opens,
   * and the copy is still there after the rule is gone.
   */
  it('keeps what an episode watched after its rule is deleted, and closes the one still open', async () => {
    const rule = await createRule(owner, device, aRule({ name: unique('Remembered') }));

    await simulator.reportStatus({ temperature: 34 });
    const alert = await waitForAlert(owner, rule.id);
    expect(alert.watched).toEqual({ name: rule.name, watch: { kind: 'reading', metric: 'temperature', upper: 30, lower: null } });

    await owner.client.delete(`/v1/alarm-rules/${rule.id}`).expect(204);
    await owner.client.get(`/v1/alarm-rules/${rule.id}`).expect(404);

    const orphan = await owner.client.get(`/v1/alerts/${alert.id}`).expect(200);
    expect(orphan.body).toMatchObject({
      ruleId: rule.id,
      resolvedAt: expect.any(String),
      watched: { name: rule.name, watch: { kind: 'reading', metric: 'temperature', upper: 30, lower: null } },
    });

    await simulator.reportStatus({ temperature: 21 });
    await settle(1000);
  });

  it('lists what is open and what is over, apart', async () => {
    const open = await owner.client.get(`/v1/alerts?deviceId=${device}&open=true`).expect(200);
    expect(open.body.items.every((one: { resolvedAt: string | null }) => one.resolvedAt === null)).toBe(true);

    const over = await owner.client.get(`/v1/alerts?deviceId=${device}&open=false`).expect(200);
    expect(over.body.items.every((one: { resolvedAt: string | null }) => one.resolvedAt !== null)).toBe(true);
    expect(over.body.items.length).toBeGreaterThan(0);
  });

  it('narrows to a tent, and refuses one the caller cannot see', async () => {
    const here = await owner.client.get(`/v1/alerts?spaceId=${tent}`).expect(200);
    expect(here.body.items.every((one: { spaceId: string }) => one.spaceId === tent)).toBe(true);

    await stranger.client.get(`/v1/alerts?spaceId=${tent}`).expect(404);
    await stranger.client.get(`/v1/alerts?deviceId=${device}`).expect(404);
  });

  it('answers a stranger an empty inbox, and a demo session the same', async () => {
    expect((await stranger.client.get('/v1/alerts').expect(200)).body.items).toEqual([]);

    const demo = await demoSession();
    expect((await demo.client.get('/v1/alerts').expect(200)).body.items).toEqual([]);
  });

  it('is in the inbox of everybody the tent is shared with', async () => {
    const shared = await helper.client.get(`/v1/alerts?deviceId=${device}`).expect(200);
    expect(shared.body.items.length).toBeGreaterThan(0);
  });

  it('lets an administrator read one whatever it is about', async () => {
    const any = await admin.client.get(`/v1/alerts?deviceId=${device}`).expect(200);
    expect(any.body.items.length).toBeGreaterThan(0);
  });

  /**
   * Named subject and no subject are two different questions. Asked about this
   * device the office answers; asked for "my alerts" it is one more person with
   * an inbox, and somebody else's tent is not in it.
   */
  it('answers an administrator asking for no subject in particular their own inbox alone', async () => {
    const mine = await admin.client.get('/v1/alerts').expect(200);

    expect(mine.body.items.map((one: { deviceId: string | null }) => one.deviceId)).not.toContain(device);
  });
});

/**
 * The warning that a camera has stopped sending pictures is opted out of, never
 * into: a camera arrives with it on and somebody who does not want it turns it
 * off. Nobody should have to go and switch it on, on a fresh install or on one
 * that has just been migrated.
 */
describe('the stale warning', () => {
  const rtsp = () => ({ kind: 'rtsp', spaceId: tent, name: unique('Tapo'), url: 'rtsp://viewer:hunter2@10.0.0.30:554/stream1' });

  it('is on for a camera nobody has said anything about', async () => {
    const created = await owner.client.post('/v1/cameras').send(rtsp()).expect(201);

    expect(created.body.staleWarning).toBe(true);
  });

  it('is switched off by the camera´s own settings, and switched on again', async () => {
    const created = await owner.client.post('/v1/cameras').send(rtsp()).expect(201);

    const off = await owner.client.patch(`/v1/cameras/${created.body.id}`).send({ staleWarning: false }).expect(200);
    expect(off.body.staleWarning).toBe(false);

    const on = await owner.client.patch(`/v1/cameras/${created.body.id}`).send({ staleWarning: true }).expect(200);
    expect(on.body.staleWarning).toBe(true);
  });

  it('is nobody else´s to switch off', async () => {
    const created = await owner.client.post('/v1/cameras').send(rtsp()).expect(201);

    await stranger.client.patch(`/v1/cameras/${created.body.id}`).send({ staleWarning: false }).expect(404);
    await helper.client.patch(`/v1/cameras/${created.body.id}`).send({ staleWarning: false }).expect(403);
  });
});

/**
 * The send decision, end to end. The alarm engine hands the alert to the
 * routing, the routing reads this person's grid, and the channel either has an
 * address or has not. Which row of the grid is read is the rule's severity: a
 * critical rule is `alerts`, a warning is `warnings`, and an info rule is on
 * neither row and reaches no channel at all.
 */
describe('being told about it', () => {
  let alarmed: Session;
  let theirDevice: string;
  let theirSimulator: DeviceSimulator;

  beforeAll(async () => {
    alarmed = await createAccount('alarms-told');
    const claimed = await provisionDevice(alarmed, 'controller');
    theirDevice = claimed.deviceId;
    theirSimulator = await startSimulator(claimed);
    await settle();
  });

  afterAll(async () => {
    await theirSimulator?.close();
  });

  it('says nothing on channels nobody has configured, however many the grid names', async () => {
    await alarmed.client
      .patch('/v1/me')
      .send({
        notifications: {
          channels: { email: null, telegram: null, webhook: null },
          routing: {
            alerts: ['email', 'push', 'telegram', 'webhook'],
            warnings: ['email', 'push', 'telegram', 'webhook'],
            tasks: [],
            plan: [],
            weekly_timelapse: [],
          },
          quietHours: null,
          mutedUntil: null,
        },
      })
      .expect(200);
    await resetMail();

    const rule = await createRule(alarmed, theirDevice, aRule({ name: unique('Unconfigured') }));
    await theirSimulator.reportStatus({ temperature: 35 });
    await settle(2000);

    const alerts = await alarmed.client.get(`/v1/alerts?deviceId=${theirDevice}`).expect(200);
    expect(alerts.body.items.some((one: { ruleId: string }) => one.ruleId === rule.id)).toBe(true);
    expect(await capturedMail()).toEqual([]);

    await theirSimulator.reportStatus({ temperature: 20 });
    await settle(1000);
    await alarmed.client.delete(`/v1/alarm-rules/${rule.id}`).expect(204);
  });

  /** The person's grid, with the address named, so that what a case asserts is the row an alarm lands in. */
  const routeTo = async (alerts: string[], warnings: string[], mutedUntil: string | null = null) => {
    await alarmed.client
      .patch('/v1/me')
      .send({
        notifications: {
          channels: { email: 'told@test.invalid', telegram: null, webhook: null },
          routing: { alerts, warnings, tasks: [], plan: [], weekly_timelapse: [] },
          quietHours: null,
          mutedUntil,
        },
      })
      .expect(200);
    await resetMail();
  };

  /** Raises the rule, gives the send decision time to run, and settles the tent again. */
  const raiseAndClear = async (rule: { id: string }, temperature: number) => {
    await theirSimulator.reportStatus({ temperature });
    await settle(2000);
    const mails = await capturedMail();

    await theirSimulator.reportStatus({ temperature: 20 });
    await settle(1000);
    await alarmed.client.delete(`/v1/alarm-rules/${rule.id}`).expect(204);

    return mails;
  };

  it('mails the address the person named once they have asked for it', async () => {
    await routeTo(['email'], []);

    const rule = await createRule(alarmed, theirDevice, aRule({ name: 'Freezing in here', severity: 'critical' }));
    await theirSimulator.reportStatus({ temperature: 36 });

    const mail = await waitForMail(message => message.to.includes('told@test.invalid'));
    expect(mail.subject).toContain('Freezing in here');

    await theirSimulator.reportStatus({ temperature: 20 });
    await settle(1000);
    await alarmed.client.delete(`/v1/alarm-rules/${rule.id}`).expect(204);
  });

  it('sends a warning on the warnings row of the grid and not on the alerts row', async () => {
    await routeTo([], ['email']);
    const onWarnings = await createRule(alarmed, theirDevice, aRule({ name: unique('Read in the morning'), severity: 'warning' }));
    const mails = await raiseAndClear(onWarnings, 38);
    expect(mails.map(mail => mail.subject)).toEqual([expect.stringContaining('Read in the morning')]);

    await routeTo(['email'], []);
    const offAlerts = await createRule(alarmed, theirDevice, aRule({ name: unique('Not a wake-up'), severity: 'warning' }));
    expect(await raiseAndClear(offAlerts, 39)).toEqual([]);
  });

  it('announces an info rule nowhere, and still opens its alert', async () => {
    await routeTo(['email'], ['email']);

    const rule = await createRule(alarmed, theirDevice, aRule({ name: unique('For the record'), severity: 'info' }));
    await theirSimulator.reportStatus({ temperature: 40 });
    await settle(2000);

    const alerts = await alarmed.client.get(`/v1/alerts?deviceId=${theirDevice}`).expect(200);
    expect(alerts.body.items.find((one: { ruleId: string }) => one.ruleId === rule.id)).toMatchObject({ severity: 'info', resolvedAt: null });
    expect(await raiseAndClear(rule, 40)).toEqual([]);
  });

  it('says nothing to somebody who has muted everything, a critical alarm included', async () => {
    await routeTo(['email'], ['email'], new Date(Date.now() + 60 * 60 * 1000).toISOString());

    const rule = await createRule(alarmed, theirDevice, aRule({ name: unique('Muted'), severity: 'critical' }));
    expect(await raiseAndClear(rule, 37)).toEqual([]);
  });
});
