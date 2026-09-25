import { AccessService } from '@common/v1/access.service';
import { AccessContext } from '@common/v1/access.types';
import type { SeriesPoint } from '@fg2/shared-types/v1';
import { DataService, LiveReading } from '@modules/data/data.service';
import { DevicesService } from '@modules/v1/device/devices.service';
import { dueTasksOf } from '@modules/v1/home/due-tasks';
import { HomeService } from '@modules/v1/home/home.service';
import { SpaceLiveService } from '@modules/v1/space/space-live.service';
import { SpacesService } from '@modules/v1/space/spaces.service';
import { EntryDocument } from '@database/schemas/v1/entries.schema';
import { ReminderDocument } from '@database/schemas/v1/reminders.schema';
import { startV1TestDatabase, V1TestDatabase } from './support/v1-database';

/**
 * The home screen's read model: one card per space, with what stands in it.
 *
 * What is asserted is what a card says and where it says it from - the newest
 * reading among several devices, the target from the one that holds it, the
 * grow that stands in the space with its counter, the diary's newest lines with
 * who wrote them, what is due and what is alarming - and that a room groups
 * cards without being one.
 *
 * The world is one room with a tent and a fridge in it, a controller and a
 * plug in the tent, a grow in the tent, a balcony with a grow and no device, and
 * a stranger whose grow the owner follows.
 */

const OWNER = 'user-owner';
const MEMBER = 'user-member';
const STRANGER = 'user-stranger';

const ROOM = 'room-1';
const TENT = 'tent-1';
const FRIDGE = 'fridge-1';
const BALCONY = 'balcony-1';
const CONTROLLER = 'device-controller';
const PLUG = 'device-plug';
const GROW = 'grow-tent';
const BALCONY_GROW = 'grow-balcony';
const PUBLIC_GROW = 'grow-public';

const NOW = new Date('2026-06-10T12:00:00.000Z');
const STARTED_AT = new Date('2026-05-08T08:00:00.000Z');

const session = (userId: string): AccessContext => ({ userId, isAdmin: false, isDemo: false, shareToken: null });

let db: V1TestDatabase;
let home: HomeService;
let readings: Record<string, LiveReading>;

const at = (secondsAgo: number): string => new Date(NOW.getTime() - secondsAgo * 1000).toISOString();

const reading = (values: Record<string, [number, number]>, isDay: boolean | null = true): LiveReading => ({
  metrics: Object.fromEntries(
    Object.entries(values).map(([name, [value, secondsAgo]]) => [
      name,
      { value, measuredAt: at(secondsAgo), state: secondsAgo < 120 ? 'live' : 'stale' },
    ]),
  ),
  outputs: {},
  isDay,
  lightOn: null,
});

let trends: Map<string, SeriesPoint[]>;

const fakeData = {
  live: async (deviceId: string) => readings[deviceId] ?? { metrics: {}, outputs: {}, isDay: null, lightOn: null },
  trends: async () => trends,
} as unknown as DataService;

const build = (): HomeService => {
  const access = new AccessService(db.spaces, db.grows, db.plants, db.devices, db.cameras, db.entries, db.media, db.memberships, db.shareLinks);
  const devices = new DevicesService(db.devices, db.claimCodes, db.spaces, db.memberships, db.cameras, db.plans, db.alarmRules, access);
  const spaces = new SpacesService(db.spaces, db.memberships, db.invites, db.shareLinks, db.devices, db.cameras, db.grows, devices, access);
  const live = new SpaceLiveService(db.devices, db.cameras, fakeData);

  return new HomeService(
    db.spaces,
    db.grows,
    db.plants,
    db.cameras,
    db.entries,
    db.media,
    db.alerts,
    db.alarmRules,
    db.reminders,
    db.follows,
    db.users,
    spaces,
    live,
    fakeData,
  );
};

const entry = (over: Partial<EntryDocument>): EntryDocument =>
  ({
    id: `entry-${Math.random()}`,
    createdAt: NOW,
    kind: 'note',
    occurredAt: NOW,
    source: 'human',
    authorId: OWNER,
    growId: null,
    spaceId: null,
    deviceId: null,
    plantIds: [],
    cameraId: null,
    taskId: null,
    alertId: null,
    severity: null,
    text: null,
    message: null,
    values: { kind: 'note' },
    mediaIds: [],
    undoUntil: null,
    ...over,
  }) as EntryDocument;

const world = async (): Promise<void> => {
  await db.users.create([
    { id: OWNER, email: 'owner@test.invalid', handle: 'owner', passwordHash: 'x' },
    { id: MEMBER, email: 'member@test.invalid', handle: 'mia', passwordHash: 'x' },
    { id: STRANGER, email: 'stranger@test.invalid', handle: 'greenthumb', passwordHash: 'x' },
  ]);

  await db.spaces.create([
    { id: ROOM, ownerId: OWNER, kind: 'room', name: 'The room', roomId: null, createdAt: new Date('2026-01-01T00:00:00.000Z') },
    { id: TENT, ownerId: OWNER, kind: 'tent', name: 'Tent 1', roomId: ROOM, createdAt: new Date('2026-01-02T00:00:00.000Z') },
    { id: FRIDGE, ownerId: OWNER, kind: 'fridge', name: 'Fridge', roomId: ROOM, createdAt: new Date('2026-01-03T00:00:00.000Z') },
    { id: BALCONY, ownerId: OWNER, kind: 'balcony', name: 'Balcony', roomId: null, createdAt: new Date('2026-01-04T00:00:00.000Z') },
  ]);
  await db.memberships.create({ id: 'membership-member', spaceId: TENT, userId: MEMBER, role: 'can_log' });

  await db.devices.create([
    {
      id: CONTROLLER,
      type: 'controller',
      ownerId: OWNER,
      spaceId: TENT,
      configuration: { day: { temperature: 25, humidity: 55 }, night: { temperature: 20 } },
    },
    { id: PLUG, type: 'plug', ownerId: OWNER, spaceId: TENT, configuration: null },
  ]);
  readings = {
    [CONTROLLER]: reading({ temperature: [25.1, 20], humidity: [55, 20], co2: [1010, 20] }),
    // The plug's thermometer reported later, and reports no targets.
    [PLUG]: reading({ temperature: [25.4, 5] }, null),
  };
  trends = new Map([[CONTROLLER, [24.8, 25.2, null].map((value, index) => ({ measuredAt: at((3 - index) * 1800), value }))]]);

  const phase = {
    id: 'phase-1',
    stage: 'flowering',
    preset: 'flower',
    startedAt: STARTED_AT,
    source: 'preset',
    plantIds: null,
    deviceId: CONTROLLER,
    targets: null,
    setBy: null,
  };
  await db.grows.create([
    {
      id: GROW,
      ownerId: OWNER,
      name: 'Spring run',
      type: 'photoperiod',
      phases: [phase],
      placements: [{ id: 'placement-1', spaceId: TENT, startedAt: STARTED_AT, endedAt: null, plantIds: null }],
      slug: 'spring-run',
      startedAt: STARTED_AT,
      endedAt: null,
    },
    {
      id: BALCONY_GROW,
      ownerId: OWNER,
      name: 'Balcony tomatoes',
      type: 'photoperiod',
      phases: [{ ...phase, id: 'phase-2', stage: 'seedling', preset: null, source: 'human', setBy: OWNER, deviceId: null }],
      placements: [{ id: 'placement-2', spaceId: BALCONY, startedAt: STARTED_AT, endedAt: null, plantIds: null }],
      slug: 'balcony-tomatoes',
      startedAt: STARTED_AT,
      endedAt: null,
    },
    {
      id: PUBLIC_GROW,
      ownerId: STRANGER,
      name: 'Autoflower run',
      type: 'autoflower',
      phases: [{ ...phase, id: 'phase-3', stage: 'vegetative', preset: null, source: 'human', setBy: STRANGER, deviceId: null }],
      placements: [{ id: 'placement-3', spaceId: null, startedAt: STARTED_AT, endedAt: null, plantIds: null }],
      slug: 'autoflower-run',
      visibility: 'public',
      startedAt: STARTED_AT,
      endedAt: null,
    },
  ]);
  await db.plants.create([
    { id: 'plant-1', growId: GROW, strain: 'Amnesia', label: 'Amnesia 1', status: 'active', createdAt: STARTED_AT },
    { id: 'plant-2', growId: GROW, strain: 'Amnesia', label: 'Amnesia 2', status: 'active', createdAt: STARTED_AT },
    { id: 'plant-3', growId: GROW, strain: 'Gelato', label: 'Gelato 1', status: 'active', createdAt: new Date(STARTED_AT.getTime() + 1) },
    { id: 'plant-4', growId: BALCONY_GROW, strain: 'Roma', label: 'Roma 1', status: 'active', createdAt: STARTED_AT },
  ]);

  await db.entries.create([
    entry({
      id: 'entry-old',
      growId: GROW,
      occurredAt: new Date('2026-06-08T12:00:00.000Z'),
      values: { kind: 'water', litres: null, readings: [] },
      kind: 'water',
    }),
    entry({ id: 'entry-new', growId: GROW, authorId: MEMBER, occurredAt: new Date('2026-06-09T12:00:00.000Z'), text: 'Defoliated' }),
    entry({ id: 'entry-fridge', spaceId: FRIDGE, source: 'device', authorId: null, deviceId: 'device-fridge', occurredAt: NOW }),
  ]);

  await db.alarmRules.create({
    id: 'rule',
    deviceId: CONTROLLER,
    name: 'Humidity into mould',
    watch: { kind: 'reading', metric: 'humidity', upper: 65, lower: null },
    forSeconds: 60,
    severity: 'warning',
    origin: 'human',
    enabled: true,
  });
  await db.alerts.create([
    {
      id: 'alert-open',
      ruleId: 'rule',
      deviceId: CONTROLLER,
      spaceId: TENT,
      kind: 'threshold',
      severity: 'warning',
      startedAt: NOW,
      resolvedAt: null,
      value: 68,
    },
    {
      id: 'alert-over',
      ruleId: 'rule',
      deviceId: CONTROLLER,
      spaceId: TENT,
      kind: 'threshold',
      severity: 'critical',
      startedAt: NOW,
      resolvedAt: NOW,
      value: 72,
    },
  ]);

  await db.follows.create({ id: 'follow-1', userId: OWNER, growId: PUBLIC_GROW });
};

beforeAll(async () => {
  db = await startV1TestDatabase();
});

afterAll(async () => {
  await db.stop();
});

beforeEach(async () => {
  await db.reset();
  home = build();
  await world();
});

describe('the cards', () => {
  it('is one card per place, oldest first, and the room that only groups them is not one', async () => {
    const answer = await home.read(session(OWNER), NOW);

    expect(answer.spaces.map(card => card.spaceId)).toEqual([TENT, FRIDGE, BALCONY]);
  });

  it('shows a member the spaces they are in, and nothing else', async () => {
    const answer = await home.read(session(MEMBER), NOW);

    expect(answer.spaces.map(card => card.spaceId)).toEqual([TENT]);
    expect(answer.followedGrows).toEqual([]);
  });

  it('shows an administrator their own places and not everybody´s', async () => {
    const admin: AccessContext = { userId: STRANGER, isAdmin: true, isDemo: false, shareToken: null };
    const answer = await home.read(admin, NOW);

    // The stranger owns no place, so the one card is their own placeless grow
    // and none of the owner's three.
    expect(answer.spaces.map(card => card.spaceId)).toEqual([null]);
    expect(answer.spaces.map(card => card.grow?.growId)).toEqual([PUBLIC_GROW]);
  });

  // A grow is first-class without a place, so "no fixed place" is a card and
  // not a hole: without this the grower who picks that chip starts a grow and
  // finds the home exactly as they left it.
  it('draws an open grow that stands in no place at all as a card of its own', async () => {
    await db.grows.create({
      id: 'grow-nowhere',
      ownerId: OWNER,
      name: 'Windowsill basil',
      type: 'photoperiod',
      phases: [],
      placements: [{ id: 'placement-nowhere', spaceId: null, startedAt: STARTED_AT, endedAt: null, plantIds: null }],
      slug: 'windowsill-basil',
      startedAt: STARTED_AT,
      endedAt: null,
    });
    await db.reminders.create({
      id: 'reminder-basil',
      subject: { type: 'grow', id: 'grow-nowhere' },
      kind: 'water',
      label: 'Water',
      everyDays: 2,
      onceAt: null,
      assigneeId: null,
      createdBy: OWNER,
      createdAt: STARTED_AT,
    });

    const answer = await home.read(session(OWNER), NOW);
    const nowhere = answer.spaces.find(card => card.spaceId === null)!;

    expect(answer.spaces.map(card => card.spaceId)).toEqual([TENT, FRIDGE, BALCONY, null]);
    expect(nowhere.name).toBe('Windowsill basil');
    expect(nowhere.kind).toBeNull();
    expect(nowhere.roomId).toBeNull();
    expect(nowhere.grow?.growId).toBe('grow-nowhere');
    expect(nowhere.deviceIds).toEqual([]);
    expect(nowhere.values).toEqual([]);
    expect(nowhere.trend).toBeNull();
    expect(nowhere.latestStill).toBeNull();
    expect(nowhere.openAlerts).toEqual([]);
    // The widened grow ids are what carry its reminders into the task list.
    expect(nowhere.dueTasks.map(task => task.label)).toEqual(['Water']);
  });

  it('is empty for somebody with nothing, rather than a refusal', async () => {
    await expect(home.read(session('user-nobody'), NOW)).resolves.toEqual({ spaces: [], followedGrows: [], people: [] });
  });
});

describe('the climate half', () => {
  it('takes the newest reading of a metric across the devices in the space, in the card´s order', async () => {
    const [tent] = (await home.read(session(OWNER), NOW)).spaces;

    expect(tent.deviceIds).toEqual([CONTROLLER, PLUG]);
    expect(tent.values.map(value => [value.metric, value.value, value.state])).toEqual([
      ['temperature', 25.4, 'live'],
      ['humidity', 55, 'live'],
      ['co2', 1010, 'live'],
    ]);
  });

  it('takes the target from the device that holds one, for the half of the cycle it is in', async () => {
    const [tent] = (await home.read(session(OWNER), NOW)).spaces;

    expect(tent.setpoints).toEqual([
      { metric: 'temperature', value: 25, band: 1 },
      { metric: 'humidity', value: 55, band: 5 },
    ]);
  });

  it('has no values and no targets where there is no device', async () => {
    const balcony = (await home.read(session(OWNER), NOW)).spaces.find(card => card.spaceId === BALCONY);

    expect(balcony).toMatchObject({ deviceIds: [], values: [], setpoints: [], trend: null });
  });

  it('carries a day of temperature on the card, so the sparkline costs no read of its own', async () => {
    const [tent] = (await home.read(session(OWNER), NOW)).spaces;

    expect(tent.trend).toEqual({ metric: 'temperature', stepSeconds: 1800, endsAt: NOW.toISOString(), points: [24.8, 25.2, null] });
  });
});

describe('the grow half', () => {
  it('carries the grow that stands in the space, with its counter, its auto tag and its strains once each', async () => {
    const [tent] = (await home.read(session(OWNER), NOW)).spaces;

    expect(tent.grow).toMatchObject({
      growId: GROW,
      name: 'Spring run',
      dayNumber: 34,
      phaseDay: 34,
      stage: 'flowering',
      preset: 'flower',
      isAuto: true,
      plantCount: 3,
      strains: ['Amnesia', 'Gelato'],
      stageGroups: [],
    });
  });

  it('has no grow where nothing is growing', async () => {
    const fridge = (await home.read(session(OWNER), NOW)).spaces.find(card => card.spaceId === FRIDGE);

    expect(fridge?.grow).toBeNull();
  });

  it('lists the grow´s newest entries first, and names who wrote them', async () => {
    const answer = await home.read(session(OWNER), NOW);
    const [tent] = answer.spaces;

    expect(tent.entries.map(line => line.id)).toEqual(['entry-new', 'entry-old']);
    expect(tent.entries[0].authorId).toBe(MEMBER);
    expect(answer.people).toEqual(
      expect.arrayContaining([
        { id: MEMBER, handle: 'mia' },
        { id: OWNER, handle: 'owner' },
      ]),
    );
  });

  it('shows a space without a grow its own lines - what a device or an alarm wrote there', async () => {
    const fridge = (await home.read(session(OWNER), NOW)).spaces.find(card => card.spaceId === FRIDGE);

    expect(fridge?.entries.map(line => line.id)).toEqual(['entry-fridge']);
  });
});

describe('what needs a human', () => {
  it('lists the alerts that are still open, and not the ones that are over', async () => {
    const [tent] = (await home.read(session(OWNER), NOW)).spaces;

    expect(tent.openAlerts).toEqual([
      {
        alertId: 'alert-open',
        kind: 'threshold',
        severity: 'warning',
        startedAt: NOW.toISOString(),
        value: 68,
        metric: 'humidity',
        name: 'Humidity into mould',
      },
    ]);
  });

  it('names an alert by the rule that raised it, and by the name it kept once that rule is gone', async () => {
    await db.alarmRules.deleteOne({ id: 'rule' });
    await db.alerts.updateOne(
      { id: 'alert-open' },
      { $set: { watched: { name: 'Mould watch', watch: { kind: 'reading', metric: 'humidity', upper: 60, lower: null } } } },
    );

    const [tent] = (await home.read(session(OWNER), NOW)).spaces;

    expect(tent.openAlerts).toEqual([expect.objectContaining({ alertId: 'alert-open', metric: 'humidity', name: 'Mould watch' })]);
  });

  it('lists what is due from the reminders of the space and of its grow', async () => {
    await db.reminders.create([
      {
        id: 'reminder-water',
        subject: { type: 'grow', id: GROW },
        kind: 'water',
        label: 'Water',
        everyDays: 2,
        onceAt: null,
        assigneeId: MEMBER,
        createdBy: OWNER,
        createdAt: STARTED_AT,
      },
      {
        id: 'reminder-clean',
        subject: { type: 'space', id: FRIDGE },
        kind: 'chore',
        label: 'Clean the fridge',
        everyDays: null,
        onceAt: new Date('2026-07-01T00:00:00.000Z'),
        assigneeId: null,
        createdBy: OWNER,
        createdAt: STARTED_AT,
      },
    ]);
    // Watered on the 9th, so the next watering falls on the 11th: due, and the assignee is named.
    await db.entries.create(
      entry({ id: 'entry-watered', growId: GROW, taskId: 'reminder-water:2026-06-09', occurredAt: new Date('2026-06-09T12:00:00.000Z') }),
    );

    const answer = await home.read(session(OWNER), NOW);
    const [tent, fridge] = answer.spaces;

    expect(tent.dueTasks).toEqual([
      {
        id: `reminder-water:${Date.parse('2026-06-11T12:00:00.000Z')}`,
        kind: 'water',
        label: 'Water',
        dueAt: '2026-06-11T12:00:00.000Z',
        subject: { type: 'grow', id: GROW },
        assigneeId: MEMBER,
      },
    ]);
    expect(fridge.dueTasks).toEqual([]);
    expect(answer.people).toEqual(expect.arrayContaining([{ id: MEMBER, handle: 'mia' }]));
  });
});

describe('following', () => {
  it('lists the public grows the person follows, under the owner´s handle', async () => {
    const answer = await home.read(session(OWNER), NOW);

    expect(answer.followedGrows).toEqual([
      expect.objectContaining({
        growId: PUBLIC_GROW,
        slug: 'autoflower-run',
        name: 'Autoflower run',
        handle: 'greenthumb',
        dayNumber: 34,
        stage: 'vegetative',
      }),
    ]);
  });

  it('dates the card by the newest line in the diary and not by the moment the grow´s row was written', async () => {
    const written = new Date('2026-06-05T09:30:00.000Z');
    await db.entries.create([
      entry({ id: 'entry-public-note', growId: PUBLIC_GROW, authorId: STRANGER, occurredAt: written, text: 'Topped' }),
      // A machine's own line is not somebody writing in the diary, and an alarm
      // every ten minutes would make every silent grow look freshly written.
      entry({ id: 'entry-public-alarm', growId: PUBLIC_GROW, kind: 'alarm', source: 'device', authorId: null, occurredAt: NOW }),
    ]);
    // What the row's own write time says, which is what the card used to draw.
    await db.grows.updateOne({ id: PUBLIC_GROW }, { $set: { name: 'Autoflower run' } });

    const [card] = (await home.read(session(OWNER), NOW)).followedGrows;

    expect(card.updatedAt).toBe(written.toISOString());
  });

  it('dates a diary nobody has written in yet from the day the grow started', async () => {
    const [card] = (await home.read(session(OWNER), NOW)).followedGrows;

    expect(card.updatedAt).toBe(STARTED_AT.toISOString());
  });

  it('drops a grow that has been made private since', async () => {
    await db.grows.updateOne({ id: PUBLIC_GROW }, { $set: { visibility: 'private' } });

    expect((await home.read(session(OWNER), NOW)).followedGrows).toEqual([]);
  });
});

describe('a reminder as tasks', () => {
  const reminder = (over: Partial<ReminderDocument>): ReminderDocument =>
    ({
      id: 'reminder',
      subject: { type: 'grow', id: GROW },
      kind: 'water',
      label: 'Water',
      everyDays: null,
      onceAt: null,
      assigneeId: null,
      createdBy: OWNER,
      createdAt: STARTED_AT,
      ...over,
    }) as ReminderDocument;

  it('makes a one-off due once its day is near, and done once an entry carries its id', () => {
    const soon = reminder({ onceAt: new Date(NOW.getTime() + 24 * 3600 * 1000) });
    const far = reminder({ id: 'far', onceAt: new Date(NOW.getTime() + 7 * 24 * 3600 * 1000) });

    expect(dueTasksOf([soon, far], [], NOW).map(task => task.id)).toEqual(['reminder']);
    expect(dueTasksOf([soon], [entry({ taskId: 'reminder' })], NOW)).toEqual([]);
  });

  it('counts a rhythm from its newest completion, and from the day it was set up before there is one', () => {
    const rhythm = reminder({ everyDays: 3 });

    expect(dueTasksOf([rhythm], [], NOW)[0]).toMatchObject({
      id: `reminder:${Date.parse('2026-05-11T08:00:00.000Z')}`,
      dueAt: '2026-05-11T08:00:00.000Z',
    });

    const watered = entry({ taskId: 'reminder:2026-06-08', occurredAt: new Date('2026-06-09T18:00:00.000Z') });
    expect(dueTasksOf([rhythm], [watered], NOW)).toEqual([]);
    expect(dueTasksOf([rhythm], [watered], new Date('2026-06-11T12:00:00.000Z'))[0].id).toBe(`reminder:${Date.parse('2026-06-12T18:00:00.000Z')}`);
  });

  /**
   * A daily rhythm ticked the evening before its occurrence: counted from the
   * tick, the next one fell on the same UTC day, came back under the id just
   * closed, and every tick on it was refused - the rhythm was jammed for good.
   */
  it('moves on to a new occurrence after a tick taken a day early, and never offers the one it closed', () => {
    const daily = reminder({ everyDays: 1, createdAt: new Date('2026-09-24T20:41:39.000Z') });
    const now = new Date('2026-09-24T20:41:47.000Z');
    const [first] = dueTasksOf([daily], [], now);

    const ticked = entry({ taskId: first.id, occurredAt: now });
    const [next] = dueTasksOf([daily], [ticked], now);

    expect(next.id).not.toBe(first.id);
    expect(next.dueAt).toBe('2026-09-25T20:41:47.000Z');
  });

  it('still counts a tick written under an occurrence named by its day', () => {
    const rhythm = reminder({ everyDays: 3 });
    const legacy = entry({ taskId: 'reminder:2026-06-08', occurredAt: new Date('2026-06-09T18:00:00.000Z') });

    expect(dueTasksOf([rhythm], [legacy], new Date('2026-06-12T19:00:00.000Z'))[0].dueAt).toBe('2026-06-12T18:00:00.000Z');
  });
});
