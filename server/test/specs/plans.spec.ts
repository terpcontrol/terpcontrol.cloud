import { anonymous, createAccount, demoSession, loginAsAdmin, Session, unique } from '../support/api';
import { provisionDevice } from '../support/device';
import { joinSpace } from '../support/fixtures';

/**
 * The grow plan a controller is run by: writing one, moving through it, putting
 * it away, and the templates one is started from.
 *
 * The plan holds its steps and its position, and the two are written by
 * different routes on purpose - `PUT` is the plan, a transition is where in it
 * the device stands - so both halves are asserted against each other: an edit
 * must not restart a tent, and a move must not rewrite the steps.
 *
 * The templates are the one thing here that `access()` decides nothing about, so
 * what somebody else may do with one is spelled out at length: a published
 * template is readable by anybody with an account and changeable by nobody but
 * its author, and a private one is not there at all.
 */

let owner: Session;
let stranger: Session;
let admin: Session;
let device: string;
let tent: string;

const step = (name: string, over: Record<string, unknown> = {}) => ({
  name,
  stage: null,
  preset: null,
  duration: { value: 1, unit: 'days' },
  settings: {},
  waitForConfirmation: false,
  confirmationMessage: null,
  ...over,
});

const aPlan = (over: Record<string, unknown> = {}) => ({
  templateId: null,
  name: 'Two weeks of veg',
  loop: false,
  notify: { mode: 'on_step', email: 'plans@test.invalid', writeEntries: true },
  steps: [step('Veg'), step('Flower')],
  ...over,
});

/** A controller of its own, so a case that starts a plan cannot disturb the one beside it. */
const aController = async (session: Session): Promise<{ deviceId: string; spaceId: string }> => {
  const claimed = await provisionDevice(session, 'controller');
  const read = await session.client.get(`/v1/devices/${claimed.deviceId}`).expect(200);

  return { deviceId: claimed.deviceId, spaceId: read.body.spaceId };
};

const planOf = async (session: Session, deviceId: string) => (await session.client.get(`/v1/devices/${deviceId}/plan`).expect(200)).body;

const aTemplate = async (session: Session, over: Record<string, unknown> = {}) =>
  (
    await session.client
      .post('/v1/plan-templates')
      .send({ name: unique('template'), isPublic: false, steps: [step('Veg')], ...over })
      .expect(201)
  ).body;

beforeAll(async () => {
  owner = await createAccount('plans-owner');
  stranger = await createAccount('plans-stranger');
  admin = await loginAsAdmin();

  const controller = await aController(owner);
  device = controller.deviceId;
  tent = controller.spaceId;
});

describe('writing the plan', () => {
  it('creates it at rest, because saving a plan is not starting one', async () => {
    const written = await owner.client.put(`/v1/devices/${device}/plan`).send(aPlan()).expect(200);

    expect(written.body).toMatchObject({ deviceId: device, name: 'Two weeks of veg', loop: false, templateId: null });
    expect(written.body.state).toMatchObject({ status: 'stopped', activeStepIndex: 0, stepStartedAt: null, pausedElapsedMs: 0 });
    expect(written.body.id).toEqual(expect.any(String));

    // Every step comes back with an id of its own, which is what an edit sends
    // back for the steps it kept.
    expect(written.body.steps.map((one: { id: string }) => one.id)).toEqual([expect.any(String), expect.any(String)]);
    expect(await planOf(owner, device)).toEqual(written.body);
  });

  it('replaces the whole plan rather than merging with the one that was there', async () => {
    const mine = await aController(owner);
    await owner.client.put(`/v1/devices/${mine.deviceId}/plan`).send(aPlan()).expect(200);

    const second = await owner.client
      .put(`/v1/devices/${mine.deviceId}/plan`)
      .send(aPlan({ name: 'Autoflower', loop: true, steps: [step('Only')] }))
      .expect(200);

    expect(second.body.name).toBe('Autoflower');
    expect(second.body.loop).toBe(true);
    expect(second.body.steps.map((one: { name: string }) => one.name)).toEqual(['Only']);
  });

  it('keeps the running step running when another is inserted above it', async () => {
    const mine = await aController(owner);
    const first = await owner.client.put(`/v1/devices/${mine.deviceId}/plan`).send(aPlan()).expect(200);
    await owner.client.post(`/v1/devices/${mine.deviceId}/plan/transitions`).send({ kind: 'resume' }).expect(201);
    await owner.client.post(`/v1/devices/${mine.deviceId}/plan/transitions`).send({ kind: 'skip' }).expect(201);

    const running = await planOf(owner, mine.deviceId);
    expect(running.state).toMatchObject({ status: 'running', activeStepIndex: 1 });

    const edited = await owner.client
      .put(`/v1/devices/${mine.deviceId}/plan`)
      .send(aPlan({ steps: [step('Seedling'), ...first.body.steps] }))
      .expect(200);

    // The step the tent is on moved down the list and the plan moved with it,
    // still running and with the time it had already served.
    expect(edited.body.state).toMatchObject({ status: 'running', activeStepIndex: 2, stepStartedAt: running.state.stepStartedAt });
    expect(edited.body.steps[2].id).toBe(first.body.steps[1].id);
  });

  it('refuses two steps that carry the same id', async () => {
    const written = await owner.client.put(`/v1/devices/${device}/plan`).send(aPlan()).expect(200);
    const one = written.body.steps[0];

    const refused = await owner.client
      .put(`/v1/devices/${device}/plan`)
      .send(aPlan({ steps: [one, { ...one, name: 'A second under one id' }] }))
      .expect(422);

    expect(refused.body.code).toBe('duplicate_step_id');
  });

  it('refuses a body the contract does not describe', async () => {
    const refused = await owner.client
      .put(`/v1/devices/${device}/plan`)
      .send({ ...aPlan(), name: undefined })
      .expect(400);

    expect(refused.body.code).toBe('validation_failed');
    expect(refused.body.errors.map((issue: { field: string }) => issue.field)).toContain('name');
  });

  it('says a device that has no plan is not running one', async () => {
    const bare = await aController(owner);

    const refused = await owner.client.get(`/v1/devices/${bare.deviceId}/plan`).expect(404);
    expect(refused.body.code).toBe('plan_not_found');
    await owner.client.post(`/v1/devices/${bare.deviceId}/plan/transitions`).send({ kind: 'resume' }).expect(404);
    await owner.client.delete(`/v1/devices/${bare.deviceId}/plan`).expect(404);
  });
});

describe('moving through the plan', () => {
  it('starts it, stops its clock and picks it up where it stopped', async () => {
    const mine = await aController(owner);
    await owner.client.put(`/v1/devices/${mine.deviceId}/plan`).send(aPlan()).expect(200);

    const started = await owner.client.post(`/v1/devices/${mine.deviceId}/plan/transitions`).send({ kind: 'resume' }).expect(201);
    expect(started.body.state).toMatchObject({ status: 'running', activeStepIndex: 0 });
    expect(started.body.state.stepStartedAt).toEqual(expect.any(String));

    const paused = await owner.client
      .post(`/v1/devices/${mine.deviceId}/plan/transitions`)
      .send({ kind: 'pause', reason: 'Fans are out' })
      .expect(201);
    expect(paused.body.state).toMatchObject({ status: 'paused', stepStartedAt: null, pauseReason: 'Fans are out' });

    const resumed = await owner.client.post(`/v1/devices/${mine.deviceId}/plan/transitions`).send({ kind: 'resume' }).expect(201);
    // The time the step had already served is kept, so the plan continues the
    // step rather than starting it again.
    expect(resumed.body.state).toMatchObject({ status: 'running', pauseReason: null, pausedElapsedMs: paused.body.state.pausedElapsedMs });
  });

  it('skips and extends without touching the steps themselves', async () => {
    const mine = await aController(owner);
    const written = await owner.client.put(`/v1/devices/${mine.deviceId}/plan`).send(aPlan()).expect(200);
    await owner.client.post(`/v1/devices/${mine.deviceId}/plan/transitions`).send({ kind: 'resume' }).expect(201);

    const skipped = await owner.client.post(`/v1/devices/${mine.deviceId}/plan/transitions`).send({ kind: 'skip' }).expect(201);
    expect(skipped.body.state.activeStepIndex).toBe(1);

    const extended = await owner.client
      .post(`/v1/devices/${mine.deviceId}/plan/transitions`)
      .send({ kind: 'extend', by: { value: 12, unit: 'hours' } })
      .expect(201);

    // The clock is put back; the step keeps the duration it was written with.
    expect(extended.body.steps).toEqual(written.body.steps);
    expect(new Date(extended.body.state.stepStartedAt).getTime()).toBeGreaterThan(new Date(skipped.body.state.stepStartedAt).getTime());
  });

  it('refuses a confirmation nothing is waiting for, and a move it does not know', async () => {
    const mine = await aController(owner);
    await owner.client.put(`/v1/devices/${mine.deviceId}/plan`).send(aPlan()).expect(200);

    const refused = await owner.client.post(`/v1/devices/${mine.deviceId}/plan/transitions`).send({ kind: 'confirm' }).expect(409);
    expect(refused.body.code).toBe('nothing_to_confirm');

    await owner.client.post(`/v1/devices/${mine.deviceId}/plan/transitions`).send({ kind: 'stop' }).expect(400);
  });

  it('refuses to start a plan that has no steps to run', async () => {
    const mine = await aController(owner);
    await owner.client
      .put(`/v1/devices/${mine.deviceId}/plan`)
      .send(aPlan({ steps: [] }))
      .expect(200);

    const refused = await owner.client.post(`/v1/devices/${mine.deviceId}/plan/transitions`).send({ kind: 'resume' }).expect(409);
    expect(refused.body.code).toBe('plan_has_no_steps');
  });
});

describe('stopping the plan', () => {
  it('puts it away with its steps, and lets it be started again', async () => {
    const mine = await aController(owner);
    const written = await owner.client.put(`/v1/devices/${mine.deviceId}/plan`).send(aPlan()).expect(200);
    await owner.client.post(`/v1/devices/${mine.deviceId}/plan/transitions`).send({ kind: 'resume' }).expect(201);
    await owner.client.post(`/v1/devices/${mine.deviceId}/plan/transitions`).send({ kind: 'skip' }).expect(201);

    await owner.client.delete(`/v1/devices/${mine.deviceId}/plan`).expect(204);

    const put = await planOf(owner, mine.deviceId);
    expect(put.state).toMatchObject({ status: 'stopped', activeStepIndex: 0, stepStartedAt: null });
    // Stopping is not deleting: the plan is still there to be started over.
    expect(put.steps).toEqual(written.body.steps);

    // And it is idempotent, because a screen may stop a plan it last read a
    // minute ago.
    await owner.client.delete(`/v1/devices/${mine.deviceId}/plan`).expect(204);

    const again = await owner.client.post(`/v1/devices/${mine.deviceId}/plan/transitions`).send({ kind: 'resume' }).expect(201);
    expect(again.body.state).toMatchObject({ status: 'running', activeStepIndex: 0 });
  });
});

describe('who may read and who may change a plan', () => {
  beforeAll(async () => {
    await owner.client.put(`/v1/devices/${device}/plan`).send(aPlan()).expect(200);
  });

  it('hides the plan from everybody the device is hidden from', async () => {
    await stranger.client.get(`/v1/devices/${device}/plan`).expect(404);
    await stranger.client.put(`/v1/devices/${device}/plan`).send(aPlan()).expect(404);
    await stranger.client.delete(`/v1/devices/${device}/plan`).expect(404);
    await stranger.client.post(`/v1/devices/${device}/plan/transitions`).send({ kind: 'pause', reason: null }).expect(404);

    await anonymous().get(`/v1/devices/${device}/plan`).expect(401);
    await (await demoSession()).client.get(`/v1/devices/${device}/plan`).expect(404);
  });

  it('lets a member read the plan and only a manager change it', async () => {
    const reader = await createAccount('plans-reader');
    const manager = await createAccount('plans-manager');
    await joinSpace(tent, reader.userId, 'can_log');
    await joinSpace(tent, manager.userId, 'can_manage');

    const read = await reader.client.get(`/v1/devices/${device}/plan`).expect(200);
    expect(read.body.name).toBe('Two weeks of veg');

    const refused = await reader.client.put(`/v1/devices/${device}/plan`).send(aPlan()).expect(403);
    expect(refused.body.code).toBe('insufficient_access');
    await reader.client.delete(`/v1/devices/${device}/plan`).expect(403);
    await reader.client.post(`/v1/devices/${device}/plan/transitions`).send({ kind: 'pause', reason: null }).expect(403);

    await manager.client.put(`/v1/devices/${device}/plan`).send(aPlan()).expect(200);
    await admin.client.get(`/v1/devices/${device}/plan`).expect(200);
  });

  it('keeps the address the plan mails to from anybody who may not manage the device', async () => {
    const reader = await createAccount('plans-mail-reader');
    await joinSpace(tent, reader.userId, 'can_log');

    // That the plan mails somewhere is not the secret; the address is, and it
    // is often somebody's own.
    expect((await owner.client.get(`/v1/devices/${device}/plan`).expect(200)).body.notify).toMatchObject({
      mode: 'on_step',
      email: 'plans@test.invalid',
    });
    expect((await reader.client.get(`/v1/devices/${device}/plan`).expect(200)).body.notify).toMatchObject({ mode: 'on_step', email: null });
  });

  it('answers a share link only while its window is open, and without the address', async () => {
    const mine = await aController(owner);
    await owner.client.put(`/v1/devices/${mine.deviceId}/plan`).send(aPlan()).expect(200);

    const open = await owner.client
      .post('/v1/share-links')
      .send({ kind: 'view', subject: { type: 'space', id: mine.spaceId } })
      .expect(201);
    const shut = await owner.client
      .post('/v1/share-links')
      .send({
        kind: 'view',
        subject: { type: 'space', id: mine.spaceId },
        range: { startsAt: '2024-01-01T00:00:00.000Z', endsAt: '2024-03-01T00:00:00.000Z' },
      })
      .expect(201);

    const shared = await stranger.client.get(`/v1/devices/${mine.deviceId}/plan?share=${open.body.token}`).expect(200);
    expect(shared.body.notify.email).toBeNull();
    // A link is a key to what it was cut for and never to changing it.
    await stranger.client.put(`/v1/devices/${mine.deviceId}/plan?share=${open.body.token}`).send(aPlan()).expect(403);

    // A key to a spring that is over is not a key to what the tent is being run
    // by today.
    await stranger.client.get(`/v1/devices/${mine.deviceId}/plan?share=${shut.body.token}`).expect(404);
  });
});

describe('the plans kept to start others from', () => {
  it('belongs to whoever saved it, whatever the body says', async () => {
    const created = await owner.client
      .post('/v1/plan-templates')
      .send({ name: unique('mine'), isPublic: false, steps: [step('Veg'), step('Flower')], ownerId: stranger.userId, id: 'chosen' })
      .expect(201);

    expect(created.body.ownerId).toBe(owner.userId);
    expect(created.body.id).not.toBe('chosen');
    expect(created.body.steps.map((one: { id: string }) => one.id)).toEqual([expect.any(String), expect.any(String)]);
    expect((await owner.client.get(`/v1/plan-templates/${created.body.id}`).expect(200)).body).toEqual(created.body);
  });

  it('keeps a name unique to the person who saved it, and to nobody else', async () => {
    const name = unique('shared-name');
    await aTemplate(owner, { name });

    const refused = await owner.client.post('/v1/plan-templates').send({ name, isPublic: false, steps: [] }).expect(409);
    expect(refused.body.code).toBe('plan_template_name_taken');

    // Somebody else's notebook is their own.
    await stranger.client.post('/v1/plan-templates').send({ name, isPublic: false, steps: [] }).expect(201);
  });

  it('is renamed, published and thrown away by its author', async () => {
    const template = await aTemplate(owner);

    const published = await owner.client.patch(`/v1/plan-templates/${template.id}`).send({ isPublic: true }).expect(200);
    expect(published.body).toMatchObject({ isPublic: true, name: template.name });
    // Each field only if it changes, so publishing does not ask for the steps back.
    expect(published.body.steps).toEqual(template.steps);

    const renamed = await owner.client
      .patch(`/v1/plan-templates/${template.id}`)
      .send({ name: unique('renamed') })
      .expect(200);
    expect(renamed.body.isPublic).toBe(true);

    await owner.client.delete(`/v1/plan-templates/${template.id}`).expect(204);
    await owner.client.get(`/v1/plan-templates/${template.id}`).expect(404);
  });

  it('is not there at all for anybody else until it is published', async () => {
    const template = await aTemplate(owner);

    await stranger.client.get(`/v1/plan-templates/${template.id}`).expect(404);
    await stranger.client
      .patch(`/v1/plan-templates/${template.id}`)
      .send({ name: unique('theirs') })
      .expect(404);
    await stranger.client.delete(`/v1/plan-templates/${template.id}`).expect(404);
    await anonymous().get(`/v1/plan-templates/${template.id}`).expect(401);

    await owner.client.patch(`/v1/plan-templates/${template.id}`).send({ isPublic: true }).expect(200);

    // Published: readable by anybody with an account, and changeable by nobody
    // but its author - which is said as a refusal rather than as a 404, because
    // they can plainly see it.
    await stranger.client.get(`/v1/plan-templates/${template.id}`).expect(200);
    const refused = await stranger.client
      .patch(`/v1/plan-templates/${template.id}`)
      .send({ name: unique('theirs') })
      .expect(403);
    expect(refused.body.code).toBe('insufficient_access');
    await stranger.client.delete(`/v1/plan-templates/${template.id}`).expect(403);

    await owner.client.delete(`/v1/plan-templates/${template.id}`).expect(204);
  });

  it('lists what somebody may start from, page after page, and never what they may not', async () => {
    const first = await aTemplate(owner, { name: unique('paging-first') });
    const hidden = await aTemplate(stranger, { name: unique('paging-hidden') });
    const second = await aTemplate(owner, { name: unique('paging-second') });

    const seen: string[] = [];
    let cursor: string | null = null;

    // One row per page: a visibility filter spread beside the cursor instead of
    // combined with it reads correctly on the first page and hands out the whole
    // collection from the second, which is what walking the pages catches.
    for (let page = 0; page < 25; page++) {
      const where: string = `/v1/plan-templates?limit=1${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
      const answer = await owner.client.get(where).expect(200);

      seen.push(...answer.body.items.map((one: { id: string }) => one.id));
      cursor = answer.body.nextCursor;
      if (!cursor) break;
    }

    expect(seen).toContain(first.id);
    expect(seen).toContain(second.id);
    expect(seen).not.toContain(hidden.id);
    // Newest first, and each row exactly once.
    expect(seen.indexOf(second.id)).toBeLessThan(seen.indexOf(first.id));
    expect(new Set(seen).size).toBe(seen.length);

    await owner.client.delete(`/v1/plan-templates/${first.id}`).expect(204);
    await owner.client.delete(`/v1/plan-templates/${second.id}`).expect(204);
    await stranger.client.delete(`/v1/plan-templates/${hidden.id}`).expect(204);
  });

  it('is what a plan says it was started from, and outlives being thrown away', async () => {
    const mine = await aController(owner);
    const template = await aTemplate(owner, { name: unique('started-from') });

    const written = await owner.client
      .put(`/v1/devices/${mine.deviceId}/plan`)
      .send(aPlan({ templateId: template.id }))
      .expect(200);
    expect(written.body.templateId).toBe(template.id);

    await owner.client.delete(`/v1/plan-templates/${template.id}`).expect(204);

    // A plan holds its own steps, so it runs on naming a template that is gone.
    const survivor = await planOf(owner, mine.deviceId);
    expect(survivor.templateId).toBe(template.id);
    expect(survivor.steps).toHaveLength(2);
  });
});
