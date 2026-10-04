import { randomUUID } from 'node:crypto';
import { anonymous, createAccount, demoSession, loginAsAdmin, Session, unique } from '../support/api';
import { provisionDevice } from '../support/device';
import { joinSpace, seedRow, setRow, shareLinkOnGrow } from '../support/fixtures';

/**
 * The rhythms a place is kept to, and the work they put on somebody's list.
 *
 * The two belong in one spec because they are two halves of one thing: a
 * reminder is the only row, a task is derived from it on every read, and "done"
 * is a diary entry carrying the task's id. What is worth asserting is that the
 * three agree - a task appears when the rhythm says so, disappears when the
 * line is written, and comes back on the next occurrence.
 *
 * The access matrix is asserted at length for one reason. A reminder is
 * `manage` and not `log`: it is not a line somebody adds but a standing
 * arrangement that puts work on everybody's card, so a member who may water the
 * plants may read the rhythms and not rewrite them.
 */

let owner: Session;
let keeper: Session;
let helper: Session;
let stranger: Session;
let admin: Session;
let tent: string;
let device: string;

const DAY_MS = 24 * 60 * 60 * 1000;

const aReminder = (over: Record<string, unknown> = {}) => ({
  subject: { type: 'space', id: tent },
  kind: 'water',
  label: unique('Water'),
  everyDays: 3,
  onceAt: null,
  ...over,
});

/** A reminder that is already due, so a task derives from it straight away. */
const dueNow = (over: Record<string, unknown> = {}) => aReminder({ everyDays: null, onceAt: new Date(Date.now() - DAY_MS).toISOString(), ...over });

const create = async (session: Session, body: Record<string, unknown>) => (await session.client.post('/v1/reminders').send(body).expect(201)).body;

const tasksOf = async (session: Session, query = '') => (await session.client.get(`/v1/tasks${query}`).expect(200)).body.items;

beforeAll(async () => {
  owner = await createAccount('reminders-owner');
  keeper = await createAccount('reminders-keeper');
  helper = await createAccount('reminders-helper');
  stranger = await createAccount('reminders-stranger');
  admin = await loginAsAdmin();

  const claimed = await provisionDevice(owner, 'controller');
  device = claimed.deviceId;
  tent = (await owner.client.get(`/v1/devices/${device}`).expect(200)).body.spaceId;

  await joinSpace(owner, tent, keeper, 'can_manage');
  await joinSpace(owner, tent, helper, 'can_log');
});

describe('writing a reminder', () => {
  it('records the rhythm and who set it', async () => {
    const written = await create(owner, aReminder({ label: 'Water the tent' }));

    expect(written).toMatchObject({
      subject: { type: 'space', id: tent },
      kind: 'water',
      label: 'Water the tent',
      everyDays: 3,
      onceAt: null,
      assigneeId: null,
      defaults: null,
      createdBy: owner.userId,
    });
    expect(written.id).toEqual(expect.any(String));
  });

  it('keeps what a completion should be prefilled with', async () => {
    const written = await create(owner, aReminder({ kind: 'feed', defaults: { kind: 'feed', litres: 4 } }));

    expect(written.defaults).toEqual({ kind: 'feed', litres: 4 });
  });

  it('refuses a reminder that is both a rhythm and a date, and one that is neither', async () => {
    const both = await owner.client
      .post('/v1/reminders')
      .send(aReminder({ onceAt: new Date().toISOString() }))
      .expect(422);
    expect(both.body.code).toBe('reminder_has_no_rhythm');

    await owner.client
      .post('/v1/reminders')
      .send(aReminder({ everyDays: null }))
      .expect(422);
  });

  it('refuses a rhythm shorter than a day, which would fall due again the moment it was done', async () => {
    const refused = await owner.client
      .post('/v1/reminders')
      .send(aReminder({ everyDays: 0 }))
      .expect(422);

    expect(refused.body.code).toBe('rhythm_too_short');
  });

  it('refuses to give the work to somebody who may not write in this diary', async () => {
    const refused = await owner.client
      .post('/v1/reminders')
      .send(aReminder({ assigneeId: stranger.userId }))
      .expect(422);

    expect(refused.body.code).toBe('assignee_cannot_log');
  });

  it('gives the work to somebody who may', async () => {
    const written = await create(owner, aReminder({ assigneeId: helper.userId }));

    expect(written.assigneeId).toBe(helper.userId);
  });
});

describe('changing and ending one', () => {
  it('changes the rhythm and what it is called', async () => {
    const written = await create(owner, aReminder());
    const changed = await owner.client.patch(`/v1/reminders/${written.id}`).send({ everyDays: 7, label: 'Every Sunday' }).expect(200);

    expect(changed.body).toMatchObject({ everyDays: 7, label: 'Every Sunday', onceAt: null });
  });

  it('refuses to move it to a different place, which would be a different arrangement', async () => {
    const written = await create(owner, aReminder());
    const elsewhere = (
      await owner.client
        .post('/v1/spaces')
        .send({ kind: 'tent', name: unique('Other') })
        .expect(201)
    ).body;

    const refused = await owner.client
      .patch(`/v1/reminders/${written.id}`)
      .send({ subject: { type: 'space', id: elsewhere.id } })
      .expect(422);

    expect(refused.body.code).toBe('reminder_moved');
  });

  it('refuses a change that would leave it with two rhythms', async () => {
    const written = await create(owner, aReminder());

    await owner.client.patch(`/v1/reminders/${written.id}`).send({ onceAt: new Date().toISOString() }).expect(422);
  });

  it('deletes it, and the lines it already produced stay', async () => {
    const written = await create(owner, dueNow());
    const task = (await tasksOf(owner)).find((one: { id: string }) => one.id === written.id);
    await owner.client.post(`/v1/tasks/${task.id}/completions`).send({}).expect(201);

    await owner.client.delete(`/v1/reminders/${written.id}`).expect(204);

    await owner.client.get(`/v1/reminders?spaceId=${tent}`).expect(200);
    const lines = await owner.client.get(`/v1/entries?spaceId=${tent}`).expect(200);
    expect(lines.body.items.some((entry: { taskId: string }) => entry.taskId === task.id)).toBe(true);
  });
});

describe('reading them', () => {
  it('lists what is kept here, and pages through it from the cursor', async () => {
    const mine = await createAccount('reminders-pager');
    const space = (
      await mine.client
        .post('/v1/spaces')
        .send({ kind: 'tent', name: unique('Pager') })
        .expect(201)
    ).body;
    for (const index of [1, 2, 3]) {
      await create(mine, { subject: { type: 'space', id: space.id }, kind: 'chore', label: `Chore ${index}`, everyDays: index, onceAt: null });
    }

    const first = await mine.client.get('/v1/reminders?limit=2').expect(200);
    expect(first.body.items).toHaveLength(2);
    expect(first.body.nextCursor).toEqual(expect.any(String));

    const second = await mine.client.get(`/v1/reminders?limit=2&cursor=${encodeURIComponent(first.body.nextCursor)}`).expect(200);
    expect(second.body.items).toHaveLength(1);

    const ids = [...first.body.items, ...second.body.items].map((one: { id: string }) => one.id);
    expect(new Set(ids).size).toBe(3);
  });

  it('narrows to one place when asked', async () => {
    const here = await create(owner, aReminder({ label: unique('Here') }));

    const listed = await owner.client.get(`/v1/reminders?spaceId=${tent}`).expect(200);
    expect(listed.body.items.map((one: { id: string }) => one.id)).toContain(here.id);
    expect(listed.body.items.every((one: { subject: { id: string } }) => one.subject.id === tent)).toBe(true);
  });

  it('answers a stranger an empty list rather than somebody else´s rhythms', async () => {
    await create(owner, aReminder());

    const listed = await stranger.client.get('/v1/reminders').expect(200);
    expect(listed.body.items).toEqual([]);
  });
});

describe('who may do what to a reminder', () => {
  let written: { id: string };

  beforeAll(async () => {
    written = await create(owner, aReminder({ label: unique('Matrix') }));
  });

  it('lets a manager read and rewrite them', async () => {
    const listed = await keeper.client.get(`/v1/reminders?spaceId=${tent}`).expect(200);
    expect(listed.body.items.map((one: { id: string }) => one.id)).toContain(written.id);

    const mine = await create(keeper, aReminder({ label: unique('By the manager') }));
    await keeper.client.patch(`/v1/reminders/${mine.id}`).send({ label: 'Renamed' }).expect(200);
    await keeper.client.delete(`/v1/reminders/${mine.id}`).expect(204);
  });

  it('lets somebody who may only log read them and change nothing', async () => {
    const listed = await helper.client.get(`/v1/reminders?spaceId=${tent}`).expect(200);
    expect(listed.body.items.map((one: { id: string }) => one.id)).toContain(written.id);

    // Told what they may not do rather than that the tent is not there: they
    // can see it, so pretending otherwise would only be confusing.
    await helper.client.post('/v1/reminders').send(aReminder()).expect(403);
    await helper.client.patch(`/v1/reminders/${written.id}`).send({ label: 'Mine now' }).expect(403);
    await helper.client.delete(`/v1/reminders/${written.id}`).expect(403);
  });

  it('tells a stranger there is nothing there', async () => {
    await stranger.client.get(`/v1/reminders?spaceId=${tent}`).expect(404);
    await stranger.client.post('/v1/reminders').send(aReminder()).expect(404);
    await stranger.client.patch(`/v1/reminders/${written.id}`).send({ label: 'Mine now' }).expect(404);
    await stranger.client.delete(`/v1/reminders/${written.id}`).expect(404);
  });

  it('asks anybody without a session to sign in', async () => {
    await anonymous().get('/v1/reminders').expect(401);
    await anonymous().post('/v1/reminders').send(aReminder()).expect(401);
    await anonymous().get('/v1/tasks').expect(401);
  });

  it('lets an administrator read one', async () => {
    const listed = await admin.client.get(`/v1/reminders?spaceId=${tent}`).expect(200);
    expect(listed.body.items.map((one: { id: string }) => one.id)).toContain(written.id);
  });
});

describe('the tasks a reminder derives', () => {
  it('puts what is due on the list, and takes it off once the line is written', async () => {
    const reminder = await create(owner, dueNow({ label: unique('Once') }));

    const due = await tasksOf(owner);
    const task = due.find((one: { id: string }) => one.id === reminder.id);
    expect(task).toMatchObject({
      source: 'reminder',
      sourceId: reminder.id,
      subject: { type: 'space', id: tent },
      kind: 'water',
      done: false,
    });

    const line = await owner.client.post(`/v1/tasks/${task.id}/completions`).send({}).expect(201);
    expect(line.body).toMatchObject({ kind: 'water', taskId: task.id, spaceId: tent });

    expect((await tasksOf(owner)).map((one: { id: string }) => one.id)).not.toContain(task.id);
  });

  it('shows what was ticked off when it is asked for, with the line that did it', async () => {
    const reminder = await create(owner, dueNow({ label: unique('Ticked') }));
    const waiting = (await tasksOf(owner)).find((one: { id: string }) => one.id === reminder.id);
    expect(waiting).toMatchObject({ done: false, completion: null });

    const line = await owner.client.post(`/v1/tasks/${reminder.id}/completions`).send({}).expect(201);

    const done = await tasksOf(owner, '?done=true');
    expect(done.find((one: { id: string }) => one.id === reminder.id)).toMatchObject({
      done: true,
      sourceId: reminder.id,
      completion: { entryId: line.body.id, occurredAt: line.body.occurredAt, authorId: owner.userId },
    });
  });

  it('lists the week ahead, where the home card shows only the next two days', async () => {
    const reminder = await create(
      owner,
      aReminder({ everyDays: null, onceAt: new Date(Date.now() + 5 * DAY_MS).toISOString(), label: unique('Friday') }),
    );

    // Five days out sorts behind everything this spec has put on the list, so the page is asked for whole.
    expect((await tasksOf(owner, '?limit=200')).map((one: { id: string }) => one.id)).toContain(reminder.id);

    const cards = (await owner.client.get('/v1/home').expect(200)).body.spaces;
    const card = cards.find((one: { spaceId: string }) => one.spaceId === tent);
    expect(card.dueTasks.map((one: { id: string }) => one.id)).not.toContain(reminder.id);
  });

  it('refuses to tick the same task off twice', async () => {
    const reminder = await create(owner, dueNow({ label: unique('Twice') }));
    await owner.client.post(`/v1/tasks/${reminder.id}/completions`).send({}).expect(201);

    const refused = await owner.client.post(`/v1/tasks/${reminder.id}/completions`).send({}).expect(409);
    expect(refused.body.code).toBe('task_done_already');
  });

  it('gives a rhythm an occurrence of its own, which carries the instant it falls due', async () => {
    const mine = await createAccount('reminders-rhythm');
    const space = (
      await mine.client
        .post('/v1/spaces')
        .send({ kind: 'tent', name: unique('Rhythm') })
        .expect(201)
    ).body;
    const reminder = await create(mine, { subject: { type: 'space', id: space.id }, kind: 'water', label: 'Daily', everyDays: 1, onceAt: null });

    const [task] = await tasksOf(mine);
    expect(task.id).toBe(`${reminder.id}:${Date.parse(task.dueAt)}`);
  });

  it('moves a daily rhythm on after a tick taken the day before, rather than jamming it on the occurrence just closed', async () => {
    const mine = await createAccount('reminders-early');
    const space = (
      await mine.client
        .post('/v1/spaces')
        .send({ kind: 'tent', name: unique('Early') })
        .expect(201)
    ).body;
    const reminder = await create(mine, { subject: { type: 'space', id: space.id }, kind: 'water', label: 'Daily', everyDays: 1, onceAt: null });

    const [first] = await tasksOf(mine);
    await mine.client.post(`/v1/tasks/${first.id}/completions`).send({}).expect(201);

    const [next] = await tasksOf(mine);
    expect(next.id.startsWith(`${reminder.id}:`)).toBe(true);
    expect(next.id).not.toBe(first.id);
    await mine.client.post(`/v1/tasks/${next.id}/completions`).send({}).expect(201);

    const done = await mine.client.get('/v1/tasks?done=true').expect(200);
    expect(done.body.items.find((task: { id: string }) => task.id === first.id).dueAt).toBe(first.dueAt);
  });

  it('narrows to one place, and refuses a place the caller cannot see', async () => {
    await create(owner, dueNow({ label: unique('Narrow') }));

    const here = await owner.client.get(`/v1/tasks?spaceId=${tent}`).expect(200);
    expect(here.body.items.every((one: { subject: { id: string } }) => one.subject.id === tent)).toBe(true);

    await stranger.client.get(`/v1/tasks?spaceId=${tent}`).expect(404);
  });

  it('lists only what is for one person when asked', async () => {
    const reminder = await create(owner, dueNow({ label: unique('Assigned'), assigneeId: helper.userId }));

    const theirs = await tasksOf(owner, `?assigneeId=${helper.userId}`);
    expect(theirs.map((one: { id: string }) => one.id)).toContain(reminder.id);
    expect(theirs.every((one: { assigneeId: string }) => one.assigneeId === helper.userId)).toBe(true);
  });

  it('answers a stranger nothing at all', async () => {
    await create(owner, dueNow({ label: unique('Not yours') }));

    expect(await tasksOf(stranger)).toEqual([]);
  });

  /**
   * The rule round six spent itself on: a page somebody was sent a link to is a
   * diary and a climate, never the working half of a tent. A demo session is
   * the same kind of visitor.
   */
  it('shows nothing to a demo session, and is not a list a share link opens at all', async () => {
    await create(owner, dueNow({ label: unique('Private work') }));
    const grow = (
      await owner.client
        .post('/v1/grows')
        .send({ name: unique('Shared'), type: 'photoperiod', plants: [] })
        .expect(201)
    ).body;
    const token = unique('share-token');
    await shareLinkOnGrow(grow.id, token);

    const demo = await demoSession();
    expect((await demo.client.get('/v1/tasks').expect(200)).body.items).toEqual([]);

    await anonymous().get('/v1/tasks').set('x-share-token', token).expect(401);
  });
});

describe('a plan step waiting to be confirmed', () => {
  let waiting: string;
  let startedAt: Date;
  const taskId = (): string => `plan:${waiting}:0:${startedAt.getTime()}`;

  beforeAll(async () => {
    const claimed = await provisionDevice(owner, 'fridge');
    waiting = claimed.deviceId;
    startedAt = new Date(Date.now() - 2 * 60 * 60 * 1000);

    // Seeded rather than driven: a step is only a task once its time is up, and
    // the shortest step the API takes is a day long.
    await seedRow('plans', {
      id: randomUUID(),
      createdAt: new Date(),
      deviceId: waiting,
      templateId: null,
      name: 'Dry it',
      loop: false,
      notify: { mode: 'off', email: null, writeEntries: false },
      steps: [
        {
          id: 'step-1',
          name: 'Dry',
          stage: null,
          preset: null,
          duration: { value: 1, unit: 'hours' },
          settings: {},
          waitForConfirmation: true,
          confirmationMessage: 'Are the buds dry?',
        },
      ],
      state: {
        status: 'running',
        activeStepIndex: 0,
        stepStartedAt: startedAt,
        pausedElapsedMs: 0,
        pauseReason: null,
        lastAppliedAt: null,
        confirmationNotifiedAt: null,
      },
    });
  });

  it('is a task, named by what the step asks', async () => {
    const due = await tasksOf(owner);
    const task = due.find((one: { id: string }) => one.id === taskId());

    expect(task).toMatchObject({ source: 'plan_step', sourceId: 'step-1', label: 'Are the buds dry?', kind: 'chore', done: false });
  });

  it('confirms the step when it is ticked off, and stops being a task', async () => {
    await owner.client.post(`/v1/tasks/${taskId()}/completions`).send({}).expect(201);

    const plan = await owner.client.get(`/v1/devices/${waiting}/plan`).expect(200);
    expect(plan.body.state.status).toBe('completed');

    expect((await tasksOf(owner)).map((one: { id: string }) => one.id)).not.toContain(taskId());
  });

  /**
   * A plan that comes back to a step it was confirmed on - by looping, or by
   * being stopped and started again - asks again, because the tick that
   * answered the earlier turn answered that turn and not this one.
   */
  it('asks again when the step is entered a second time', async () => {
    const again = new Date(Date.now() - 3 * 60 * 60 * 1000);
    await setRow(
      'plans',
      { deviceId: waiting },
      { 'state.status': 'running', 'state.activeStepIndex': 0, 'state.stepStartedAt': again, 'state.confirmationNotifiedAt': null },
    );
    startedAt = again;

    const due = await tasksOf(owner);
    expect(due.map((one: { id: string }) => one.id)).toContain(taskId());
  });
});
