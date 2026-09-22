import { anonymous, createAccount, Session, unique } from '../support/api';
import { capturedMail, resetMail, waitForMail } from '../support/control';
import { provisionDevice, settle } from '../support/device';
import { joinSpace } from '../support/fixtures';

/**
 * The account's half of the notification channels.
 *
 * The harness configures neither Web Push nor Telegram, which is what a fresh
 * install is - and is exactly the state worth asserting: the account screens
 * are told there is no key pair and no bot, the link route refuses instead of
 * handing out something that could never work, and the webhook Telegram would
 * post to does not exist at all. An outward-facing route that answers on an
 * install nobody has set up is the failure this spec is here to catch.
 *
 * What a person can still configure without the install's help - the addresses,
 * the routing grid, quiet hours and the mute - are fields of the account and go
 * through `PATCH /me` with everything else.
 */

let owner: Session;
let other: Session;

const aSubscription = () => ({
  endpoint: `https://push.test.invalid/${unique('endpoint')}`,
  keys: { p256dh: 'BLc4xRzKlKORKWlbdgFaBrrPK3ydWAHo4M0gs0i1oEKgPpWG', auth: 'FPssMOQPmLmXWmdSTdbKVw' },
});

beforeAll(async () => {
  owner = await createAccount('notify-owner');
  other = await createAccount('notify-other');
});

describe('what the account screens are told about this install', () => {
  it('offers neither channel while the install has configured neither', async () => {
    const me = await owner.client.get('/v1/me').expect(200);

    expect(me.body.pushPublicKey).toBeNull();
    expect(me.body.telegramAvailable).toBe(false);
  });

  it('starts every account announcing nothing at all', async () => {
    const me = await owner.client.get('/v1/me').expect(200);

    expect(me.body.notifications.channels).toEqual({ email: null, telegram: null, webhook: null });
    expect(Object.values(me.body.notifications.routing).every(channels => (channels as string[]).length === 0)).toBe(true);
    expect(me.body.notifications.quietHours).toBeNull();
    expect(me.body.notifications.mutedUntil).toBeNull();
  });
});

describe('the settings an account writes for itself', () => {
  it('takes an address, a grid, a window and a mute, and reads them back', async () => {
    const mutedUntil = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const written = await owner.client
      .patch('/v1/me')
      .send({
        notifications: {
          channels: {
            email: 'alarms@test.invalid',
            telegram: null,
            webhook: { url: 'https://home.test.invalid/hook', method: 'POST', headers: { 'x-token': 'secret' } },
          },
          routing: { alerts: ['email'], warnings: ['push'], tasks: ['webhook'], plan: [], weekly_timelapse: [] },
          quietHours: { fromMinute: 1320, toMinute: 420 },
          mutedUntil,
        },
      })
      .expect(200);

    expect(written.body.notifications).toMatchObject({
      channels: { email: 'alarms@test.invalid', webhook: { url: 'https://home.test.invalid/hook', method: 'POST' } },
      routing: { alerts: ['email'], warnings: ['push'], tasks: ['webhook'] },
      quietHours: { fromMinute: 1320, toMinute: 420 },
      mutedUntil,
    });
  });

  it('refuses a window that is not a time of day', async () => {
    await owner.client
      .patch('/v1/me')
      .send({
        notifications: {
          channels: { email: null, telegram: null, webhook: null },
          routing: {},
          quietHours: { fromMinute: -1, toMinute: 0 },
          mutedUntil: null,
        },
      })
      .expect(400);
  });

  it('refuses a channel it has never heard of', async () => {
    await owner.client
      .patch('/v1/me')
      .send({
        notifications: {
          channels: { email: null, telegram: null, webhook: null },
          routing: { alerts: ['carrier_pigeon'] },
          quietHours: null,
          mutedUntil: null,
        },
      })
      .expect(400);
  });
});

describe('a browser that agreed to be pushed to', () => {
  it('is remembered, and remembered once however often it subscribes', async () => {
    const subscription = aSubscription();

    const first = await owner.client.post('/v1/me/push-subscriptions').send(subscription).expect(201);
    expect(first.body).toMatchObject({ userId: owner.userId, endpoint: subscription.endpoint });

    const again = await owner.client.post('/v1/me/push-subscriptions').send(subscription).expect(201);
    expect(again.body.id).toBe(first.body.id);
  });

  it('is forgotten when the browser says so', async () => {
    const created = await owner.client.post('/v1/me/push-subscriptions').send(aSubscription()).expect(201);

    await owner.client.delete(`/v1/me/push-subscriptions/${created.body.id}`).expect(204);
    await owner.client.delete(`/v1/me/push-subscriptions/${created.body.id}`).expect(404);
  });

  it('is nobody else´s to forget', async () => {
    const created = await owner.client.post('/v1/me/push-subscriptions').send(aSubscription()).expect(201);

    await other.client.delete(`/v1/me/push-subscriptions/${created.body.id}`).expect(404);
    await anonymous().post('/v1/me/push-subscriptions').send(aSubscription()).expect(401);
  });

  it('refuses a subscription without the keys a message is encrypted with', async () => {
    await owner.client.post('/v1/me/push-subscriptions').send({ endpoint: 'https://push.test.invalid/x' }).expect(400);
  });
});

describe('the Telegram bot this install does not have', () => {
  it('refuses to hand out a link to a bot that is not there', async () => {
    const refused = await owner.client.post('/v1/me/telegram-link').expect(409);

    expect(refused.body.code).toBe('telegram_not_configured');
  });

  it('serves no webhook at all, whatever secret is guessed', async () => {
    await anonymous().post('/telegram/').send({}).expect(404);
    await anonymous()
      .post('/telegram/anything-at-all')
      .send({ message: { chat: { id: 1 }, text: '/start x' } })
      .expect(404);
  });

  it('asks anybody without a session to sign in first', async () => {
    await anonymous().post('/v1/me/telegram-link').expect(401);
  });
});

/**
 * A recipe that has stopped to ask something.
 *
 * Two deliveries meet here and neither is the other. The address written on the
 * recipe is what its author asked of this plan and predates the routing grid
 * entirely; the grid is what each person asked of their own phone, and it is
 * read for everybody who keeps the tent - so a plan that mails nobody is still
 * announced to whoever wanted to hear about it, and a plan that mails somebody
 * goes on doing exactly that.
 *
 * The step is given a length of three seconds so that the engine, which comes
 * past every twenty, meets it waiting within one pass.
 */
describe('a plan step that is waiting for somebody', () => {
  const KEEPER = 'plan-keeper@test.invalid';
  const HELPER = 'plan-helper@test.invalid';
  const RECIPE = 'the-recipe@test.invalid';

  /** Long enough for the engine's twenty-second pass, and for the send that follows it. */
  const A_PASS_MS = 30_000;

  let keeper: Session;
  let helper: Session;
  let controller: string;

  const grid = (session: Session, email: string, plan: string[]) =>
    session.client
      .patch('/v1/me')
      .send({
        notifications: {
          channels: { email, telegram: null, webhook: null },
          routing: { alerts: [], warnings: [], tasks: [], plan, weekly_timelapse: [] },
          quietHours: null,
          mutedUntil: null,
        },
      })
      .expect(200);

  const recipe = (mode: string) => ({
    templateId: null,
    name: unique('Ask me'),
    loop: false,
    notify: { mode, email: RECIPE, writeEntries: true },
    steps: [
      {
        name: 'Defoliate',
        stage: null,
        preset: null,
        duration: { value: 0.05, unit: 'minutes' },
        settings: {},
        waitForConfirmation: true,
        confirmationMessage: 'Take the big fan leaves off.',
      },
      {
        name: 'Flower',
        stage: null,
        preset: null,
        duration: { value: 1, unit: 'days' },
        settings: {},
        waitForConfirmation: false,
        confirmationMessage: null,
      },
    ],
  });

  /**
   * Writes the recipe, puts it at rest - a plan left waiting by the case before
   * has nothing to resume - clears what has been sent so far, and starts it.
   */
  const startWaiting = async (mode: string) => {
    await keeper.client.put(`/v1/devices/${controller}/plan`).send(recipe(mode)).expect(200);
    await keeper.client.delete(`/v1/devices/${controller}/plan`).expect(204);
    await resetMail();
    await keeper.client.post(`/v1/devices/${controller}/plan/transitions`).send({ kind: 'resume' }).expect(201);
  };

  const to = (address: string) => (mail: { to: string[] }) => mail.to.includes(address);

  beforeAll(async () => {
    keeper = await createAccount('plan-ask-keeper');
    helper = await createAccount('plan-ask-helper');

    const claimed = await provisionDevice(keeper, 'controller');
    controller = claimed.deviceId;
    const device = await keeper.client.get(`/v1/devices/${controller}`).expect(200);
    await joinSpace(keeper, device.body.spaceId, helper);

    await grid(keeper, KEEPER, ['email']);
    await grid(helper, HELPER, []);
  });

  it('announces the ask to whoever routed it, sends the recipe´s own mail as before, and says nothing to anybody who routed nothing', async () => {
    await startWaiting('on_step');

    const announced = await waitForMail(to(KEEPER), A_PASS_MS);
    expect(announced.subject).toContain('step #1 Defoliate is waiting for you');
    expect(announced.body).toContain('Take the big fan leaves off.');

    const recipes = await waitForMail(to(RECIPE), A_PASS_MS);
    expect(recipes.subject).toContain('waiting for confirmation');
    expect((await capturedMail()).filter(to(HELPER))).toEqual([]);
  }, 60_000);

  it('announces it once, however long the step keeps waiting and whatever the recipe sends of its own', async () => {
    await startWaiting('off');

    await waitForMail(to(KEEPER), A_PASS_MS);
    // A recipe that sends nothing of its own writes nothing down about having
    // asked either, so the engine works the same step out as waiting on every
    // pass from here on: what keeps it to one message is the notification log.
    await settle(A_PASS_MS);

    expect((await capturedMail()).filter(to(KEEPER))).toHaveLength(1);
    expect((await capturedMail()).filter(to(RECIPE))).toEqual([]);
  }, 120_000);

  afterAll(async () => {
    await keeper.client.delete(`/v1/devices/${controller}/plan`).expect(204);
    await resetMail();
  });
});
