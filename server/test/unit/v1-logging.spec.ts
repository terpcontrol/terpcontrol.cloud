import type { PlanStep } from '@fg2/shared-types/v1';
import { dosesFor } from '@fg2/shared-types/v1-schemas';
import { AccessContext } from '@common/v1/access.types';
import { AccessService } from '@common/v1/access.service';
import { EntryWriterService, UNDO_WINDOW_SECONDS } from '@common/v1/entry-writer.service';
import { ProblemException } from '@common/v1/problem';
import { MailService } from '@modules/mail/mail.service';
import { PhaseWriterService } from '@modules/v1/phase/phase-writer.service';
import { StageAlarms } from '@modules/v1/phase/stage-alarms.port';
import { EntryWritesService, VISIT_SECONDS } from '@modules/v1/diary/entry-writes.service';
import { MaintenancePort } from '@modules/v1/diary/maintenance.port';
import { TaskCompletionsService } from '@modules/v1/diary/task-completions.service';
import { planTaskId } from '@modules/v1/diary/task-ids';
import { PlanProgressService } from '@modules/v1/plan/plan-progress.service';
import { PlanService } from '@modules/v1/plan/plan.service';
import { startV1TestDatabase, V1TestDatabase } from './support/v1-database';

/**
 * Writing the diary.
 *
 * The world is the one the access spec uses - a tent in a room, a grow standing
 * in it with a feeding scheme, a controller, a member who may log and one who
 * may manage - plus a stranger with a tent of their own, so that "may write
 * here" and "may write anywhere" are two different questions.
 *
 * What is asserted is who may write against what, the window an author has to
 * take a line back, that a backdated line lands where it belongs, and the one
 * kind with arithmetic in it.
 */

const OWNER = 'user-owner';
const MANAGER = 'user-manager';
const LOGGER = 'user-logger';
const STRANGER = 'user-stranger';

const ROOM = 'room-1';
const SPACE = 'space-1';
const GROW = 'grow-1';
const PLANT = 'plant-1';
const DEVICE = 'device-1';

const ELSEWHERE = 'space-elsewhere';
const OTHER_GROW = 'grow-elsewhere';

const LINK = 'token-grow';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Day 1 of the grow. Chosen so that "now" falls in its week 5, which is what the feed sheet was drawn on. */
const STARTED_AT = new Date(Date.now() - 34 * DAY_MS);
const IN_WEEK_THREE = new Date(STARTED_AT.getTime() + 15 * DAY_MS);

const session = (userId: string): AccessContext => ({ userId, isAdmin: false, isDemo: false, shareToken: null });
const demo: AccessContext = { userId: 'user-demo', isAdmin: false, isDemo: true, shareToken: null };
const link: AccessContext = { userId: null, isAdmin: false, isDemo: false, shareToken: LINK };

/** Biobizz as the client ships it, cut to what week 3 and week 5 need. */
const GRID = [
  { week: 3, stage: 'vegetative' as const, amounts: [{ productKey: 'bio_grow', name: 'Bio·Grow', value: 2, unit: 'ml/l' }] },
  {
    week: 5,
    stage: 'flowering' as const,
    amounts: [
      { productKey: 'bio_bloom', name: 'Bio·Bloom', value: 2, unit: 'ml/l' },
      { productKey: 'top_max', name: 'Top·Max', value: 1, unit: 'ml/l' },
      { productKey: 'bio_grow', name: 'Bio·Grow', value: null, unit: 'ml/l' },
    ],
  },
];

let db: V1TestDatabase;
let entries: EntryWritesService;
let completions: TaskCompletionsService;
let plans: PlanService;
let quietened: { deviceId: string; forSeconds: number }[];

const problem = async (act: Promise<unknown>): Promise<{ status: number; code: string }> => {
  try {
    await act;
  } catch (error) {
    if (error instanceof ProblemException) return { status: error.problem.status, code: error.problem.code };
    throw error;
  }

  throw new Error('That was allowed, and should not have been.');
};

const seed = async (): Promise<void> => {
  await db.spaces.create([
    { id: ROOM, ownerId: OWNER, kind: 'room', name: 'The room', roomId: null },
    { id: SPACE, ownerId: OWNER, kind: 'tent', name: 'The tent', roomId: ROOM },
    { id: ELSEWHERE, ownerId: STRANGER, kind: 'tent', name: 'Somebody else’s tent', roomId: null },
  ]);

  await db.grows.create([
    {
      id: GROW,
      ownerId: OWNER,
      name: 'Spring run',
      type: 'photoperiod',
      slug: 'spring-run',
      startedAt: STARTED_AT,
      phases: [{ id: 'phase-1', stage: 'vegetative', startedAt: STARTED_AT, source: 'human', plantIds: null, deviceId: DEVICE, setBy: OWNER }],
      placements: [{ id: 'placement-1', spaceId: SPACE, startedAt: STARTED_AT, endedAt: null, plantIds: null }],
      scheme: {
        origin: { type: 'asset', assetId: 'biobizz', version: '2026-01' },
        strength: 1,
        waterEc: null,
        plantType: 'soil',
        flipWeek: 4,
        edited: false,
        grid: GRID,
      },
    },
    {
      id: OTHER_GROW,
      ownerId: STRANGER,
      name: 'Not yours',
      type: 'photoperiod',
      slug: 'not-yours',
      startedAt: STARTED_AT,
      placements: [{ id: 'placement-2', spaceId: ELSEWHERE, startedAt: STARTED_AT, endedAt: null, plantIds: null }],
    },
  ]);

  await db.plants.create({ id: PLANT, growId: GROW, strain: 'Amnesia', label: 'Amnesia 1' });
  await db.devices.create({ id: DEVICE, type: 'controller', ownerId: OWNER, spaceId: SPACE });

  await db.memberships.create([
    { id: 'membership-manager', spaceId: ROOM, userId: MANAGER, role: 'can_manage' },
    { id: 'membership-logger', spaceId: SPACE, userId: LOGGER, role: 'can_log' },
  ]);

  await db.shareLinks.create({
    id: 'link-1',
    token: LINK,
    kind: 'view',
    subject: { type: 'grow', id: GROW },
    includeCameras: true,
    createdBy: OWNER,
  });

  await db.users.create({ id: OWNER, email: 'owner@example.invalid', passwordHash: 'x', handle: 'owner' });
};

beforeAll(async () => {
  db = await startV1TestDatabase();
});

afterAll(async () => {
  await db.stop();
});

beforeEach(async () => {
  await db.reset();
  quietened = [];

  const access = new AccessService(db.spaces, db.grows, db.plants, db.devices, db.cameras, db.entries, db.media, db.memberships, db.shareLinks);
  const maintenance: MaintenancePort = {
    startMaintenance: async (deviceId, forSeconds) => void quietened.push({ deviceId, forSeconds }),
  };

  entries = new EntryWritesService(db.entries, db.grows, db.plants, db.devices, access, new EntryWriterService(db.entries), maintenance);

  const alarms: StageAlarms = { applyStage: async () => undefined };
  const mail = { send: async () => undefined } as unknown as MailService;
  const phases = new PhaseWriterService(db.grows, new EntryWriterService(db.entries), db.entries, db.devices, alarms);
  plans = new PlanService(db.plans, new PlanProgressService(db.plans, db.devices, db.users, new EntryWriterService(db.entries), phases, mail));

  completions = new TaskCompletionsService(db.reminders, db.entries, access, entries, plans);

  await seed();
});

describe('who may write a line, and against what', () => {
  const aNote = { kind: 'note' as const, growId: GROW, values: { kind: 'note' as const }, text: 'Topped the two in front.' };

  it('lets the owner write', async () => {
    expect((await entries.create(session(OWNER), aNote)).authorId).toBe(OWNER);
  });

  it('lets a member who may log write', async () => {
    expect((await entries.create(session(LOGGER), aNote)).authorId).toBe(LOGGER);
  });

  it('lets a member who may manage write', async () => {
    expect((await entries.create(session(MANAGER), aNote)).authorId).toBe(MANAGER);
  });

  it('tells a stranger the grow is not there', async () => {
    expect(await problem(entries.create(session(STRANGER), aNote))).toEqual({ status: 404, code: 'grow_not_found' });
    expect(await db.entries.countDocuments()).toBe(0);
  });

  it('refuses a demo session, which is a tour and not an account', async () => {
    expect((await problem(entries.create(demo, aNote))).status).toBe(403);
  });

  it('never lets a share link write, however much of the grow it may read', async () => {
    expect((await problem(entries.create(link, aNote))).status).toBe(401);
    expect(await db.entries.countDocuments()).toBe(0);
  });

  /**
   * The one that a primary subject would have let through: every reference is
   * decided about, so naming a tent you may log in beside a grow you may not
   * does not buy you the grow.
   */
  it('decides about every reference on the line, not about one of them', async () => {
    const acrossTwo = { ...aNote, growId: OTHER_GROW, spaceId: SPACE };

    expect(await problem(entries.create(session(OWNER), acrossTwo))).toEqual({ status: 404, code: 'grow_not_found' });
    expect(await problem(entries.create(session(STRANGER), { ...aNote, growId: OTHER_GROW, spaceId: SPACE }))).toEqual({
      status: 404,
      code: 'space_not_found',
    });
  });

  it('refuses a line that is about nothing at all', async () => {
    expect(await problem(entries.create(session(OWNER), { kind: 'note', values: { kind: 'note' } }))).toEqual({
      status: 400,
      code: 'entry_about_nothing',
    });
  });

  it('writes against named plants, and finds their grow from them', async () => {
    const entry = await entries.create(session(LOGGER), { kind: 'training', plantIds: [PLANT], values: { kind: 'training' } });

    expect(entry.plantIds).toEqual([PLANT]);
    expect(entry.growId).toBe(GROW);
  });
});

describe('the undo window', () => {
  const later = (seconds: number) => new Date(Date.now() + seconds * 1000);

  const written = () => entries.create(session(LOGGER), { kind: 'water', growId: GROW, values: { kind: 'water', litres: 2 } });

  it('gives the author an instant to take it back by', async () => {
    const entry = await written();

    expect(Date.parse(entry.undoUntil!) - Date.parse(entry.createdAt)).toBe(UNDO_WINDOW_SECONDS * 1000);
  });

  it('lets the author take their own line back inside it', async () => {
    const entry = await written();
    await entries.remove(session(LOGGER), entry.id);

    expect(await db.entries.countDocuments()).toBe(0);
  });

  it('is the author´s alone: nobody else undoes it for them', async () => {
    const entry = await written();

    // The owner and the manager may still remove it - they manage the tent - but
    // a stranger is told there is no such line.
    expect(await problem(entries.remove(session(STRANGER), entry.id))).toEqual({ status: 404, code: 'entry_not_found' });
  });

  it('closes, after which removing a line takes managing the place it was written in', async () => {
    const entry = await written();
    const afterwards = later(UNDO_WINDOW_SECONDS + 1);

    expect(await problem(entries.remove(session(LOGGER), entry.id, afterwards))).toEqual({ status: 403, code: 'insufficient_access' });

    await entries.remove(session(MANAGER), entry.id, afterwards);
    expect(await db.entries.countDocuments()).toBe(0);
  });

  it('leaves editing one´s own line open, and somebody else´s to a manager', async () => {
    const entry = await written();

    expect((await entries.update(session(LOGGER), entry.id, { text: 'Two litres, not three.' })).text).toBe('Two litres, not three.');
    expect((await entries.update(session(MANAGER), entry.id, { text: 'Corrected.' })).text).toBe('Corrected.');
    expect((await problem(entries.update(session(STRANGER), entry.id, { text: 'Mine now.' }))).status).toBe(404);
  });

  it('keeps an entry the kind it is', async () => {
    const entry = await written();

    expect((await problem(entries.update(session(LOGGER), entry.id, { values: { kind: 'note' } }))).code).toBe('kind_mismatch');
  });
});

describe('when a line says it happened', () => {
  it('records the moment it happened and the moment it was written down, separately', async () => {
    const occurredAt = new Date(Date.now() - 3 * DAY_MS);
    const entry = await entries.create(session(OWNER), {
      kind: 'note',
      growId: GROW,
      occurredAt: occurredAt.toISOString(),
      values: { kind: 'note' },
    });

    expect(entry.occurredAt).toBe(occurredAt.toISOString());
    expect(Date.parse(entry.createdAt)).toBeGreaterThan(occurredAt.getTime());
  });

  it('lands a backdated line where it belongs on the timeline, not at the top', async () => {
    const older = await entries.create(session(OWNER), {
      kind: 'note',
      growId: GROW,
      occurredAt: new Date(Date.now() - 5 * DAY_MS).toISOString(),
      values: { kind: 'note' },
    });
    const newer = await entries.create(session(OWNER), { kind: 'note', growId: GROW, values: { kind: 'note' } });

    const byTime = await db.entries.find({ growId: GROW }).sort({ occurredAt: -1 }).lean();
    expect(byTime.map(row => row.id)).toEqual([newer.id, older.id]);
  });

  it('refuses a line dated in the future, which is a mistyped year and not a diary', async () => {
    const tomorrow = new Date(Date.now() + DAY_MS).toISOString();

    expect(await problem(entries.create(session(OWNER), { kind: 'note', growId: GROW, occurredAt: tomorrow, values: { kind: 'note' } }))).toEqual({
      status: 400,
      code: 'occurred_in_the_future',
    });
  });
});

describe('a feed, which is the one with arithmetic in it', () => {
  it('reads the doses off the grow´s grid at the week it is now', async () => {
    const entry = await entries.create(session(OWNER), { kind: 'feed', growId: GROW, values: { kind: 'feed', litres: 4 } });

    expect(entry.values).toEqual({
      kind: 'feed',
      litres: 4,
      schemeWeek: 5,
      doses: [
        { productKey: 'bio_bloom', name: 'Bio·Bloom', amount: 8, unit: 'ml' },
        { productKey: 'top_max', name: 'Top·Max', amount: 4, unit: 'ml' },
      ],
      readings: [],
    });
  });

  it('resolves a backdated feed at the week it happened in', async () => {
    const entry = await entries.create(session(OWNER), {
      kind: 'feed',
      growId: GROW,
      occurredAt: IN_WEEK_THREE.toISOString(),
      values: { kind: 'feed', litres: 3 },
    });

    expect(entry.values).toMatchObject({ schemeWeek: 3, doses: [{ productKey: 'bio_grow', amount: 6, unit: 'ml' }] });
  });

  it('stores what was actually given when the doses were edited', async () => {
    const given = [{ productKey: 'bio_bloom', name: 'Bio·Bloom', amount: 6, unit: 'ml' }];
    const entry = await entries.create(session(OWNER), { kind: 'feed', growId: GROW, values: { kind: 'feed', litres: 4, doses: given } });

    expect(entry.values).toMatchObject({ doses: given, schemeWeek: 5 });
  });

  /** The whole point of storing them resolved: the line reads the same afterwards. */
  it('leaves a line alone when the scheme it came from is edited later', async () => {
    const entry = await entries.create(session(OWNER), { kind: 'feed', growId: GROW, values: { kind: 'feed', litres: 4 } });
    await db.grows.updateOne({ id: GROW }, { $set: { 'scheme.grid': [] } });

    expect((await db.entries.findOne({ id: entry.id }).lean())!.values).toEqual(entry.values);
  });

  it('doses nothing for a grow that feeds without a scheme', async () => {
    await db.grows.updateOne({ id: GROW }, { $set: { scheme: null } });
    const entry = await entries.create(session(OWNER), { kind: 'feed', growId: GROW, values: { kind: 'feed', litres: 4 } });

    expect(entry.values).toMatchObject({ litres: 4, schemeWeek: null, doses: [] });
  });

  it('gives a person two decimals rather than seventeen', () => {
    const week = { week: 1, stage: null, amounts: [{ productKey: 'x', name: 'X', value: 0.1, unit: 'ml/l' }] };

    expect(dosesFor(week, 3)).toEqual([{ productKey: 'x', name: 'X', amount: 0.3, unit: 'ml' }]);
  });
});

describe('a quarter of an hour in the tent', () => {
  it('writes the line and quietens every device standing there', async () => {
    await db.devices.create({ id: 'device-2', type: 'plug', ownerId: OWNER, spaceId: SPACE });

    const entry = await entries.create(session(LOGGER), { kind: 'visit', growId: GROW, values: { kind: 'visit' } });

    expect(entry.kind).toBe('visit');
    expect(quietened).toEqual([
      { deviceId: DEVICE, forSeconds: VISIT_SECONDS },
      { deviceId: 'device-2', forSeconds: VISIT_SECONDS },
    ]);
  });

  it('follows the grow to the tent it stands in now, without being told which', async () => {
    const entry = await entries.create(session(OWNER), { kind: 'visit', growId: GROW, values: { kind: 'visit' } });

    expect(entry.spaceId).toBeNull();
    expect(quietened.map(one => one.deviceId)).toEqual([DEVICE]);
  });

  it('quietens nothing for a visit to a grow that stands nowhere', async () => {
    await db.grows.updateOne({ id: GROW }, { $set: { placements: [] } });
    await entries.create(session(OWNER), { kind: 'visit', growId: GROW, values: { kind: 'visit' } });

    expect(quietened).toEqual([]);
  });
});

describe('ticking a task off', () => {
  const aReminder = (over: Record<string, unknown> = {}) =>
    db.reminders.create({
      id: 'reminder-1',
      subject: { type: 'grow', id: GROW },
      kind: 'feed',
      label: 'Feed the tent',
      everyDays: 3,
      onceAt: null,
      assigneeId: null,
      defaults: { kind: 'feed', litres: 4 },
      createdBy: OWNER,
      ...over,
    });

  it('writes the entry the task implies, with the task´s defaults, and links the two', async () => {
    await aReminder();
    const entry = await completions.complete(session(LOGGER), 'reminder-1:2026-09-18', {});

    expect(entry).toMatchObject({ kind: 'feed', growId: GROW, taskId: 'reminder-1:2026-09-18', authorId: LOGGER });
    expect(entry.values).toMatchObject({ litres: 4, schemeWeek: 5 });
  });

  it('takes the caller´s own values over the task´s where they gave any', async () => {
    await aReminder();
    const entry = await completions.complete(session(OWNER), 'reminder-1', { values: { kind: 'feed', litres: 10 } });

    expect(entry.values).toMatchObject({ litres: 10 });
  });

  it('says what a chore was, because a chore has nothing else to record', async () => {
    await aReminder({ kind: 'chore', label: 'Clean the filter', defaults: null });
    const entry = await completions.complete(session(OWNER), 'reminder-1', {});

    expect(entry).toMatchObject({ kind: 'note', text: 'Clean the filter' });
  });

  it('is refused to a stranger, who is told there is no such task', async () => {
    await aReminder();

    expect(await problem(completions.complete(session(STRANGER), 'reminder-1', {}))).toEqual({ status: 404, code: 'grow_not_found' });
  });

  it('is nothing at all when no reminder derives it', async () => {
    expect(await problem(completions.complete(session(OWNER), 'reminder-nobody-has', {}))).toEqual({ status: 404, code: 'task_not_found' });
  });

  it('is done once, however often the card was tapped', async () => {
    await aReminder();
    await completions.complete(session(OWNER), 'reminder-1', {});

    expect(await problem(completions.complete(session(OWNER), 'reminder-1', {}))).toEqual({ status: 409, code: 'task_done_already' });
    expect(await db.entries.countDocuments({ taskId: 'reminder-1' })).toBe(1);
  });

  it('is due again once the line that ticked it off has been taken back', async () => {
    await aReminder();
    const entry = await completions.complete(session(OWNER), 'reminder-1', {});
    await entries.remove(session(OWNER), entry.id);

    await expect(completions.complete(session(OWNER), 'reminder-1', {})).resolves.toMatchObject({ taskId: 'reminder-1' });
  });

  it('tells a stranger there is no such task before it tells them what is due there', async () => {
    await aReminder();
    await completions.complete(session(OWNER), 'reminder-1', {});

    expect(await problem(completions.complete(session(STRANGER), 'reminder-1', {}))).toEqual({ status: 404, code: 'grow_not_found' });
  });
});

describe('ticking a plan step off', () => {
  const step = (partial: Partial<PlanStep> & Pick<PlanStep, 'id' | 'name'>): PlanStep => ({
    stage: null,
    preset: null,
    duration: { value: 1, unit: 'days' },
    settings: {},
    waitForConfirmation: false,
    confirmationMessage: null,
    ...partial,
  });

  const aWaitingPlan = () =>
    db.plans.create({
      id: 'plan-1',
      deviceId: DEVICE,
      templateId: null,
      name: 'The plan',
      steps: [step({ id: 'a', name: 'Soak', waitForConfirmation: true }), step({ id: 'b', name: 'Veg' })],
      loop: false,
      notify: { mode: 'off', email: null, writeEntries: true },
      // Started two days ago, so the one-day step has run out and is waiting.
      state: { status: 'running', activeStepIndex: 0, stepStartedAt: new Date(Date.now() - 2 * DAY_MS), pausedElapsedMs: 0 },
    });

  it('confirms the step and writes the line that says who did', async () => {
    await aWaitingPlan();
    const entry = await completions.complete(session(LOGGER), planTaskId(DEVICE, 0, null), {});

    expect(entry).toMatchObject({ kind: 'note', deviceId: DEVICE, taskId: planTaskId(DEVICE, 0, null), text: 'Soak' });
    expect((await plans.forDevice(DEVICE))!.state.activeStepIndex).toBe(1);
  });

  it('moves nobody else´s plan on, and is refused before it would have', async () => {
    await aWaitingPlan();

    expect(await problem(completions.complete(session(STRANGER), planTaskId(DEVICE, 0, null), {}))).toEqual({
      status: 404,
      code: 'device_not_found',
    });
    expect((await plans.forDevice(DEVICE))!.state.activeStepIndex).toBe(0);
  });

  it('says so rather than leaving a line behind when the plan has moved on already', async () => {
    await aWaitingPlan();

    expect(await problem(completions.complete(session(OWNER), planTaskId(DEVICE, 1, null), {}))).toEqual({ status: 409, code: 'task_moved_on' });
    expect(await db.entries.countDocuments()).toBe(0);
  });
});
