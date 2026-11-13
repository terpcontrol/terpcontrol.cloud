import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { DateTime, Settings } from 'luxon';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccessNeed, Entry, GrowListItem, HomeSpaceCard, Reminder, Task } from '@fg2/shared-types/v1';
import { api } from '@/api/client';
import { ApiError } from '@/api/problem';
import { Rail } from '@/app/shell/Rail';
import { LogProvider } from '@/log/LogProvider';
import { Alerts } from '@/screens/Alerts';
import { Tasks } from '@/screens/Tasks';
import { dateLabel, groupOf } from '@/screens/tasks/tasks';
import { drawAt, reading } from './harness';
import { cardOf } from './place-wire';
import { spaceWhere, THE_HOST, YOU } from './session';
import { translate } from './translations';

/**
 * The Tasks tab: what the server said is waiting, sorted into the reader's
 * days; whose it is; what one tap sends; and what a session that may only look
 * is offered.
 *
 * Every request is the app's own client, mocked at that one seam, so what is
 * asserted is what would go on the wire: a tick is a completion of exactly that
 * task id, and a reminder carries exactly one of its two rhythms.
 */
vi.mock('@/api/client', () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

const who = vi.hoisted(() => ({ demo: false }));

vi.mock('@/api/session', async importOriginal => {
  const { SIGNED_IN, ON_THE_DEMO } = await import('./session');

  return { ...(await importOriginal<object>()), useSession: () => (who.demo ? ON_THE_DEMO : SIGNED_IN) };
});

/** A Tuesday morning, in the browser's own zone: the groups are counted in calendar days from it. */
const NOW = DateTime.fromISO('2026-09-16T10:00:00');
const daysFromNow = (days: number) => NOW.plus({ days }).toUTC().toISO()!;

const task = (over: Partial<Task>): Task => ({
  id: 'rem-1:2026-09-16',
  source: 'reminder',
  sourceId: 'rem-1',
  subject: { type: 'grow', id: 'grow-1' },
  kind: 'water',
  label: 'Water',
  dueAt: daysFromNow(0),
  assigneeId: 'user-1',
  defaults: { kind: 'water', litres: 2 },
  done: false,
  completion: null,
  ...over,
});

const water = task({});
const chore = task({
  id: 'rem-2:2026-09-17',
  sourceId: 'rem-2',
  subject: { type: 'space', id: 'space-1' },
  kind: 'chore',
  label: 'Clean the carbon filter',
  dueAt: daysFromNow(1),
  assigneeId: null,
  defaults: null,
});
const planStep = task({
  id: 'plan:device-1:2',
  source: 'plan_step',
  sourceId: 'step-3',
  subject: { type: 'space', id: 'space-1' },
  kind: 'chore',
  label: 'Late flower on day 36?',
  dueAt: daysFromNow(2),
  assigneeId: null,
  defaults: null,
});
const mias = task({ id: 'rem-3:2026-09-16', sourceId: 'rem-3', label: 'Feed', kind: 'feed', assigneeId: 'user-mia', defaults: null });
const overdue = task({ id: 'rem-1:2026-09-14', label: 'Water the seedlings', dueAt: daysFromNow(-2), assigneeId: null });
const ticked = task({
  id: 'rem-4:2026-09-15',
  sourceId: 'rem-4',
  kind: 'custom',
  label: 'Defoliate lower leaves',
  dueAt: daysFromNow(-1),
  assigneeId: null,
  defaults: null,
  done: true,
  completion: { entryId: 'entry-9', occurredAt: NOW.minus({ days: 1 }).set({ hour: 19, minute: 40 }).toUTC().toISO()!, authorId: 'user-1' },
});

const reminder = (over: Partial<Reminder>): Reminder => ({
  id: 'rem-1',
  subject: { type: 'grow', id: 'grow-1' },
  kind: 'water',
  label: 'Water',
  everyDays: 3,
  onceAt: null,
  assigneeId: 'user-1',
  defaults: { kind: 'water', litres: 2 },
  createdBy: 'user-1',
  createdAt: daysFromNow(-30),
  ...over,
});

const REMINDERS = [
  reminder({}),
  reminder({
    id: 'rem-2',
    subject: { type: 'space', id: 'space-1' },
    kind: 'chore',
    label: 'Clean the carbon filter',
    everyDays: 30,
    assigneeId: null,
    defaults: null,
  }),
  reminder({ id: 'rem-3', kind: 'feed', label: 'Feed', everyDays: 7, assigneeId: 'user-mia', defaults: null }),
];

/**
 * What the reader may do in Tent 1, which is what decides every control on this
 * screen - the rhythms behind its tasks, and the zone the account is kept in,
 * which is the calendar its days are counted on. No zone is an account still on
 * its way, and leaves the screen on the browser's, which is what every
 * expectation but the zone's own assumes.
 */
const state = {
  waiting: [] as Task[],
  done: [] as Task[],
  rhythms: [] as Reminder[],
  youMay: 'own' as AccessNeed,
  zone: null as string | null,
  /** Everybody the tent's member list names. */
  people: [] as { id: string; handle: string }[],
};

const spaces = () => [spaceWhere(state.youMay)];

// The grow stands in Tent 1 and belongs to whoever the tent does, so that the
// two halves of one account's standing cannot contradict each other.
const grows = () =>
  [
    {
      id: 'grow-1',
      ownerId: state.youMay === 'own' ? YOU : THE_HOST,
      name: 'Spring run',
      endedAt: null,
      placements: [{ id: 'pl-1', spaceId: 'space-1', startedAt: daysFromNow(-30), endedAt: null, plantIds: null }],
    } as GrowListItem,
  ] as GrowListItem[];

/** The controller in Tent 1, and the plan it is being run by: what a step's confirmation says it will start. */
const devices = [{ id: 'device-1', spaceId: 'space-1' }];
const plan = {
  id: 'plan-1',
  name: 'Spring run',
  loop: false,
  steps: [
    { id: 'step-3', name: 'Late flower' },
    { id: 'step-4', name: 'Flush' },
  ],
  state: { status: 'running', activeStepIndex: 0 },
};

const answers = (path: string, query?: Record<string, unknown>) => {
  if (path === '/tasks') return { items: query?.done ? state.done : state.waiting, nextCursor: null };
  if (path === '/reminders') return { items: state.rhythms, nextCursor: null };
  if (path === '/grows') return { items: grows(), nextCursor: null };
  if (path === '/spaces') return { items: spaces(), nextCursor: null };
  if (path === '/devices') return { items: devices, nextCursor: null };
  if (path === '/devices/device-1/plan') return plan;
  if (path === '/spaces/space-1/members') return { items: [], nextCursor: null, people: state.people, room: null, activity: [] };
  if (path === '/me') return { preferences: { timezone: state.zone } };
  throw new Error(`nothing mocked for ${path}`);
};

const written = { id: 'entry-new', kind: 'water', undoUntil: null } as unknown as Entry;

const draw = () =>
  drawAt(
    <LogProvider>
      <Tasks />
    </LogProvider>,
  );

/**
 * The screen, once the waiting list, the names of the places and the rhythms
 * have all arrived. The rhythms are their own read and land in their own render,
 * so a spec that looks for one has to wait for it rather than for whichever read
 * happened to be batched with it.
 */
const drawLoaded = async () => {
  draw();
  await screen.findByRole('heading', { name: 'Tasks', level: 1 });
  if (state.waiting.length > 0) await screen.findAllByText(/Spring run|Tent 1/);
  if (state.rhythms.length > 0) await screen.findByRole('region', { name: 'Rhythms' });
};

const section = (name: string) => within(screen.getByRole('region', { name }));

beforeAll(async () => {
  await translate();

  // Which day a task belongs to is a question about today, so the clock is a
  // fixture. Only `Date`: waiting for a render still needs real timers.
  vi.useFakeTimers({ toFake: ['Date'] });
});

afterAll(() => vi.useRealTimers());

beforeEach(() => {
  vi.setSystemTime(NOW.toJSDate());
  who.demo = false;
  localStorage.clear();
  state.youMay = 'own';
  state.zone = null;
  state.people = [];
  state.waiting = [water, chore, planStep, mias, overdue];
  state.done = [ticked];
  state.rhythms = [...REMINDERS];
  vi.mocked(api.get).mockImplementation((path: string, query?: Record<string, unknown>) => Promise.resolve(answers(path, query)) as never);
  vi.mocked(api.post).mockResolvedValue(written as never);
  vi.mocked(api.patch).mockResolvedValue(REMINDERS[0] as never);
  vi.mocked(api.delete).mockResolvedValue(undefined as never);
});

describe('the groups', () => {
  it('sorts what is waiting into today, tomorrow and this week, and what was ticked off under done', async () => {
    await drawLoaded();

    // The title is the label alone: the name of the place is on the line under
    // it, where a phone has the width for it.
    expect(section('Today').getByText('Water')).toBeInTheDocument();
    expect(section('Today').getByText('Water the seedlings')).toBeInTheDocument();
    expect(section('Tomorrow').getByText('Clean the carbon filter')).toBeInTheDocument();
    // A plan step is what the plan is waiting to be told, and says so.
    expect(section('This week').getByText('Confirm: Late flower on day 36?')).toBeInTheDocument();
    expect(section('Done').getByText('Defoliate lower leaves')).toBeInTheDocument();

    // Today's date beside the label, in the reader's locale; the done group is dated by its newest tick.
    expect(screen.getByRole('region', { name: 'Today' })).toHaveTextContent(/16/);
    expect(screen.getByRole('region', { name: 'Today' })).toHaveTextContent(/Sep/);
    expect(screen.getByRole('region', { name: 'Done' })).toHaveTextContent('yesterday');
  });

  it('says where each task came from, which place it is about and when it is due', async () => {
    await drawLoaded();

    // "Water the seedlings" says what it is already, so the kind is not said a second time.
    expect(screen.getByText(reading('every 3 days · Spring run · 2 L · today'))).toBeInTheDocument();
    // The kind reads as the lowercase word the rest of the line is written in,
    // and a custom reminder, whose label already says everything, names none.
    expect(screen.getByText(reading('every 30 days · Tent 1 · chore · tomorrow'))).toBeInTheDocument();
    expect(screen.getByText(reading('grow plan · Tent 1 · in 2 d'))).toBeInTheDocument();
    expect(screen.getByText(reading('every 3 days · Spring run · 2 L · 2 days overdue'))).toBeInTheDocument();
    expect(screen.getByText(reading('you · Spring run · yesterday 19:40'))).toBeInTheDocument();
  });

  it('names who ticked a task somebody else did, by the people of its place, and says somebody until they are known', async () => {
    state.done = [{ ...ticked, completion: { ...ticked.completion!, authorId: 'user-mia' } }];
    state.people = [{ id: 'user-mia', handle: 'mia' }];
    await drawLoaded();

    expect(await screen.findByText(reading('@mia · Spring run · yesterday 19:40'))).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith('/spaces/space-1/members', { limit: 100 }, expect.anything());
  });

  it('asks for nobody´s name while every tick is the reader´s own', async () => {
    await drawLoaded();

    expect(vi.mocked(api.get).mock.calls.filter(([path]) => path.endsWith('/members'))).toHaveLength(0);
  });

  it('keeps what the list holds behind the help button beside the title', async () => {
    await drawLoaded();

    expect(screen.getByRole('button', { name: 'About Tasks' })).toHaveAccessibleDescription(
      /^Your reminders and the grow-plan steps waiting for you\./,
    );
    expect(screen.getAllByText(/^Your reminders and the grow-plan steps/)).toHaveLength(1);
  });

  it('dates a tick by the account´s clock, which is the one the alerts beside it are dated by', async () => {
    // The same tick read 10:39 on the alerts screen and 12:39 here, because
    // only this one asked the browser what the hour was.
    state.zone = 'Pacific/Kiritimati';
    await drawLoaded();

    const there = DateTime.fromISO(ticked.completion!.occurredAt).setZone('Pacific/Kiritimati');
    expect(await screen.findByText(reading(new RegExp(`you · Spring run · .+ ${there.toFormat('HH:mm')}$`)))).toBeInTheDocument();
    expect(screen.queryByText(reading('you · Spring run · yesterday 19:40'))).not.toBeInTheDocument();
  });

  it('counts the days to a task in the account´s zone, so the same task is not waiting on two different days', () => {
    // Noon UTC is two in the morning of the next day where this account is
    // kept, while its own "now" is still the evening before: one instant, one
    // task, and the answer is not the same in the two zones.
    const soon = task({ dueAt: '2026-09-16T12:00:00.000Z' });
    const at = DateTime.fromISO('2026-09-16T09:00:00.000Z');

    expect(groupOf(soon, at, 'UTC')).toBe('today');
    expect(groupOf(soon, at, 'Pacific/Kiritimati')).toBe('tomorrow');
  });

  it('writes a task´s date the way the rest of the app writes one: the day, then the month', () => {
    // The words follow the language the app is being read in; the order does
    // not. Asked for the shape as well, this label came out "Wed, Sep 16" in
    // English - the American order - beside an archive two taps away reading
    // "24 Aug 2026", and a reader had no way of telling which of them to trust.
    const at = DateTime.fromISO('2026-09-16T10:00:00.000Z', { zone: 'UTC' });

    expect(dateLabel(at, 'en')).toBe('Wed 16 Sep');
    expect(dateLabel(at, 'de')).toBe('Mi 16 Sep');
  });

  it('marks whose a task is: my initials, a plain mark for somebody else, nothing for everyone', async () => {
    await drawLoaded();
    fireEvent.click(screen.getByRole('radio', { name: 'All' }));

    // Scoped to the group the card is in: the rhythm behind each of these is
    // listed under Rhythms as well, where it is an arrangement and not a mark.
    expect(within(section('Today').getByText('Water').closest('li')!).getByRole('img', { name: 'assigned to you' })).toHaveTextContent('YO');
    expect(within(section('Today').getByText('Feed').closest('li')!).getByRole('img', { name: 'assigned to somebody else' })).toBeInTheDocument();
    expect(within(section('Tomorrow').getByText('Clean the carbon filter').closest('li')!).queryByRole('img')).not.toBeInTheDocument();
  });

  it('says so when nothing is due', async () => {
    state.waiting = [];
    state.done = [];
    await drawLoaded();

    expect(screen.getByText('Nothing is due.')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Today' })).not.toBeInTheDocument();
  });
});

/**
 * A rhythm only produces a task within the week the list looks over, so one
 * set to every thirty days was on no screen at all for twenty-three of them -
 * it could not be read, corrected or stopped, and the sheet that exists to
 * correct one was reachable only through a card it was not producing.
 */
describe('the rhythms', () => {
  const rare = reminder({
    id: 'rem-9',
    subject: { type: 'space', id: 'space-1' },
    kind: 'chore',
    label: 'Check the inline filter',
    everyDays: 90,
    assigneeId: null,
    defaults: null,
  });

  it('lists a rhythm that is due long after this week, with the way into it', async () => {
    state.rhythms = [...REMINDERS, rare];
    await drawLoaded();

    const row = section('Rhythms').getByText('Check the inline filter').closest('li')!;
    expect(within(row).getByText(reading('every 90 days · Tent 1 · chore'))).toBeInTheDocument();
    // Nothing is due of it, so it is on the screen once and only here.
    expect(screen.getAllByText('Check the inline filter')).toHaveLength(1);

    fireEvent.click(within(row).getByRole('button', { name: 'Edit' }));
    expect(within(screen.getByRole('dialog', { name: 'Reminder' })).getByLabelText('Every … days')).toHaveValue(90);
  });

  it('lists a one-off falling after the horizon by the day it falls on', async () => {
    state.rhythms = [reminder({ id: 'rem-8', label: 'Repot', everyDays: null, onceAt: daysFromNow(40), defaults: null })];
    await drawLoaded();

    expect(section('Rhythms').getByText(reading(/^once on 26 Oct 2026 · Spring run · water$/))).toBeInTheDocument();
  });

  it('is still there on a week with nothing due at all, which is the week a rhythm disappeared in', async () => {
    state.waiting = [];
    state.done = [];
    state.rhythms = [rare];
    await drawLoaded();

    expect(screen.getByText('Nothing is due.')).toBeInTheDocument();
    expect(section('Rhythms').getByText('Check the inline filter')).toBeInTheDocument();
  });

  it('offers a member who may only log the rhythms of the tent without the way to rewrite them', async () => {
    state.youMay = 'log';
    state.rhythms = [rare];
    await drawLoaded();

    expect(section('Rhythms').getByText('Check the inline filter')).toBeInTheDocument();
    expect(section('Rhythms').queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
  });
});

/**
 * A one-off rhythm read from a browser that is not in the account's zone.
 *
 * Every other expectation on this screen is written from a browser that happens
 * to agree with the account, which is why a reminder could be dated twice on
 * one screen and walk a day backwards on every Save without a single test
 * noticing. The reader is moved west of the account here - Luxon's default zone
 * is what a browser's own calendar is, in this app and in these tests - because
 * a reader behind their account is where both of those show.
 *
 * The reminder falls due at the start of a day in the account's zone, which is
 * how the sheet writes one, and that is the instant every assertion below is
 * about: the card counts the days to it in the account's zone, the rhythm line
 * names the day it falls on, and opening the sheet and saving it untouched has
 * to leave it exactly where it was.
 */
describe('a one-off rhythm read from behind the account', () => {
  /** Midnight on the last day of September where the account is kept, which is still the 29th in the afternoon for the reader. */
  const DUE = '2026-09-30T00:00:00.000Z';
  const repot = reminder({ id: 'rem-8', kind: 'chore', label: 'Repot', everyDays: null, onceAt: DUE, defaults: null });

  beforeEach(() => {
    Settings.defaultZone = 'America/Los_Angeles';
    state.zone = 'UTC';
    state.waiting = [task({ id: 'rem-8:2026-09-30', sourceId: 'rem-8', kind: 'chore', label: 'Repot', dueAt: DUE, defaults: null })];
    state.done = [];
    state.rhythms = [repot];
    vi.setSystemTime(DateTime.fromISO('2026-09-23T03:00:00.000Z').toJSDate());
  });

  afterEach(() => {
    Settings.defaultZone = 'system';
  });

  it('names one day for it, and it is the day the card above counts to', async () => {
    await drawLoaded();

    // A week from the account's own today, and the day a week from it. Read on
    // the reader's calendar the line said "29 Sep 2026" beside the same card's
    // "in 7 d", which is one reminder on two days in one glance.
    expect(section('This week').getByText(reading(/^once · Spring run · chore · in 7 d$/))).toBeInTheDocument();
    expect(section('Rhythms').getByText(reading(/^once on 30 Sep 2026 · Spring run · chore$/))).toBeInTheDocument();
  });

  it('is asked before it is deleted without a rhythm being named, since it has none', async () => {
    await drawLoaded();

    fireEvent.click(within(section('Rhythms').getByText('Repot').closest('li')!).getByRole('button', { name: 'Edit' }));
    const sheet = screen.getByRole('dialog', { name: 'Reminder' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Delete this reminder' }));

    expect(within(sheet).getByText(/^The reminder and its open task go\./)).toBeInTheDocument();
    expect(within(sheet).queryByText(/rhythm stops/)).not.toBeInTheDocument();
  });

  it('opens the sheet on the day it falls on, above a floor the account has reached', async () => {
    await drawLoaded();

    fireEvent.click(within(section('Rhythms').getByText('Repot').closest('li')!).getByRole('button', { name: 'Edit' }));
    const day = within(screen.getByRole('dialog', { name: 'Reminder' })).getByLabelText('Day') as HTMLInputElement;

    expect(day.value).toBe('2026-09-30');
    // The account's today, not the reader's: on the reader's the field opened
    // on a day below its own floor, which is a field in a state it refuses.
    expect(day.min).toBe('2026-09-23');
  });

  it('leaves the day exactly where it was when Save is pressed with nothing touched', async () => {
    await drawLoaded();

    fireEvent.click(within(section('Rhythms').getByText('Repot').closest('li')!).getByRole('button', { name: 'Edit' }));
    const sheet = screen.getByRole('dialog', { name: 'Reminder' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(api.patch).toHaveBeenCalled());
    expect(vi.mocked(api.patch).mock.calls[0][1]).toMatchObject({ onceAt: DUE });
  });
});

describe('mine and all', () => {
  it("hides a task with somebody else's name on it under Mine and shows it under All, and remembers the choice", async () => {
    await drawLoaded();

    expect(screen.getByRole('radio', { name: 'Mine' })).toHaveAttribute('aria-checked', 'true');
    expect(section('Today').queryByText('Feed')).not.toBeInTheDocument();
    expect(section('Tomorrow').getByText('Clean the carbon filter')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('radio', { name: 'All' }));

    expect(section('Today').getByText('Feed')).toBeInTheDocument();
    expect(localStorage.getItem('terp.tasks.scope')).toBe('all');
  });

  it('asks nobody to choose while no task carries anybody else´s name, and shows every task', async () => {
    state.waiting = [water, overdue];
    state.done = [];
    await drawLoaded();

    expect(screen.queryByRole('radiogroup', { name: 'Whose tasks' })).not.toBeInTheDocument();
    expect(section('Today').getByText('Water the seedlings')).toBeInTheDocument();
  });

  it('says how much Mine is hiding rather than that nothing is due, and the line switches to All', async () => {
    state.waiting = [mias, task({ id: 'rem-3:2026-09-17', sourceId: 'rem-3', label: 'Feed again', assigneeId: 'user-mia' })];
    state.done = [];
    draw();

    fireEvent.click(await screen.findByRole('button', { name: 'Nothing for you · 2 waiting for others' }));
    expect(screen.queryByText('Nothing is due.')).not.toBeInTheDocument();

    expect(screen.getByRole('radio', { name: 'All' })).toHaveAttribute('aria-checked', 'true');
    expect(section('Today').getByText('Feed')).toBeInTheDocument();
  });
});

describe('ticking one off', () => {
  it('writes the completion of exactly that task, and names in the toast what was ticked', async () => {
    await drawLoaded();

    fireEvent.click(screen.getByRole('button', { name: 'Done: Water' }));

    expect(api.post).toHaveBeenCalledWith('/tasks/rem-1%3A2026-09-16/completions', {});
    expect(await screen.findByText(reading('Done · Water · Spring run'))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument();
  });

  it('is not a control on a card that is already done', async () => {
    await drawLoaded();

    expect(section('Done').queryByRole('button')).not.toBeInTheDocument();
  });

  // Confirming a step moves the plan on and sends the next step's targets to
  // the controller. Deleting the diary line would leave all of that standing,
  // so the tick asks first, names what it will start, and offers no way back.
  it('asks before it confirms a plan step, naming the step the plan will move to', async () => {
    await drawLoaded();

    fireEvent.click(screen.getByRole('button', { name: 'Done: Confirm: Late flower on day 36?' }));
    expect(api.post).not.toHaveBeenCalled();
    expect(await screen.findByText('This confirms the step and starts Flush; it cannot be taken back.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Confirm the step' }));

    expect(api.post).toHaveBeenCalledWith('/tasks/plan%3Adevice-1%3A2/completions', {});
    expect(await screen.findByText(reading('Step confirmed · Late flower on day 36? · Tent 1'))).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument();
  });

  it('leaves the plan where it stands when the question is cancelled', async () => {
    await drawLoaded();

    fireEvent.click(screen.getByRole('button', { name: 'Done: Confirm: Late flower on day 36?' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));

    expect(api.post).not.toHaveBeenCalled();
    expect(screen.queryByText(/This confirms the step/)).not.toBeInTheDocument();
  });

  it('says why the server refused the tick, in the server´s own words, and offers it again', async () => {
    vi.mocked(api.post).mockRejectedValue(
      new ApiError({
        status: 409,
        code: 'already-done',
        title: 'Conflict',
        detail: 'Somebody has already ticked this one off.',
        errors: [],
      }),
    );
    await drawLoaded();

    fireEvent.click(screen.getByRole('button', { name: 'Done: Water' }));

    expect(await screen.findByText('Somebody has already ticked this one off.')).toBeInTheDocument();
    expect(screen.queryByText('Could not save that entry')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});

describe('a reminder', () => {
  it('is posted with a rhythm and nothing else set', async () => {
    await drawLoaded();
    fireEvent.click(screen.getByRole('button', { name: '+ Reminder' }));
    const sheet = screen.getByRole('dialog', { name: 'New reminder' });

    fireEvent.change(within(sheet).getByRole('textbox', { name: 'What to do' }), { target: { value: 'Flush' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Chore' }));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Tent 1' }));
    fireEvent.click(within(sheet).getByRole('button', { name: 'me' }));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/reminders', {
        subject: { type: 'space', id: 'space-1' },
        kind: 'chore',
        label: 'Flush',
        everyDays: 3,
        onceAt: null,
        assigneeId: 'user-1',
        defaults: null,
      }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'New reminder' })).not.toBeInTheDocument());
  });

  it('answers a new one with a toast that names it, and Undo deletes it again', async () => {
    vi.mocked(api.post).mockResolvedValueOnce(reminder({ id: 'rem-new', label: 'Flush' }) as never);
    await drawLoaded();
    fireEvent.click(screen.getByRole('button', { name: '+ Reminder' }));
    const sheet = screen.getByRole('dialog', { name: 'New reminder' });
    fireEvent.change(within(sheet).getByRole('textbox', { name: 'What to do' }), { target: { value: 'Flush' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Tent 1' }));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }));

    expect(await screen.findByText(reading('Reminder added · Flush'))).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/reminders/rem-new'));
  });

  it('answers a change with a toast that names it, and Undo writes back what stood before', async () => {
    await drawLoaded();
    fireEvent.click(within(section('Today').getByText('Water').closest('li')!).getByRole('button', { name: 'Edit' }));
    const sheet = screen.getByRole('dialog', { name: 'Reminder' });
    fireEvent.change(within(sheet).getByRole('textbox', { name: 'What to do' }), { target: { value: 'Water deeply' } });
    fireEvent.change(within(sheet).getByLabelText('Every … days'), { target: { value: '5' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/reminders/rem-1', expect.objectContaining({ label: 'Water deeply', everyDays: 5 })));
    expect(await screen.findByText(reading('Reminder changed · Water deeply'))).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Reminder' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() =>
      expect(api.patch).toHaveBeenLastCalledWith('/reminders/rem-1', {
        kind: 'water',
        label: 'Water',
        everyDays: 3,
        onceAt: null,
        assigneeId: 'user-1',
        defaults: { kind: 'water', litres: 2 },
      }),
    );
  });

  it('is posted as a one-off, due from the start of the chosen day, with the can it opens on', async () => {
    await drawLoaded();
    fireEvent.click(screen.getByRole('button', { name: '+ Reminder' }));
    const sheet = screen.getByRole('dialog', { name: 'New reminder' });

    fireEvent.change(within(sheet).getByRole('textbox', { name: 'What to do' }), { target: { value: 'Water before the trip' } });
    fireEvent.change(within(sheet).getByLabelText('Litres per can · optional'), { target: { value: '4' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Spring run' }));
    fireEvent.click(within(sheet).getByRole('button', { name: 'once on' }));
    fireEvent.change(within(sheet).getByLabelText('Day'), { target: { value: '2026-09-20' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/reminders', {
        subject: { type: 'grow', id: 'grow-1' },
        kind: 'water',
        label: 'Water before the trip',
        everyDays: null,
        onceAt: DateTime.fromISO('2026-09-20').startOf('day').toUTC().toISO(),
        assigneeId: null,
        defaults: { kind: 'water', litres: 4 },
      }),
    );
  });

  it('stays open and shows the refusal when the server says no', async () => {
    vi.mocked(api.post).mockRejectedValue(
      new ApiError({
        status: 403,
        code: 'forbidden',
        title: 'Forbidden',
        detail: 'Only whoever manages this tent can set a reminder for it.',
        errors: [],
      }),
    );
    await drawLoaded();
    fireEvent.click(screen.getByRole('button', { name: '+ Reminder' }));
    const sheet = screen.getByRole('dialog', { name: 'New reminder' });

    fireEvent.change(within(sheet).getByRole('textbox', { name: 'What to do' }), { target: { value: 'Flush' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Spring run' }));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }));

    expect(await within(sheet).findByRole('alert')).toHaveTextContent('Only whoever manages this tent can set a reminder for it.');
    expect(screen.getByRole('dialog', { name: 'New reminder' })).toBeInTheDocument();
  });

  // Where a reminder is about is the one thing that cannot be changed once it
  // exists, so the screen never picks it: a label alone is not enough to save.
  it('is about nothing until a place is chosen, and says that the choice is final', async () => {
    await drawLoaded();
    fireEvent.click(screen.getByRole('button', { name: '+ Reminder' }));
    const sheet = screen.getByRole('dialog', { name: 'New reminder' });

    expect(within(sheet).getByRole('button', { name: 'Spring run' })).toHaveAttribute('aria-pressed', 'false');
    expect(within(sheet).getByRole('button', { name: 'Tent 1' })).toHaveAttribute('aria-pressed', 'false');
    expect(within(sheet).getByText('cannot be changed later')).toBeInTheDocument();

    fireEvent.change(within(sheet).getByRole('textbox', { name: 'What to do' }), { target: { value: 'Flush' } });
    expect(within(sheet).getByRole('button', { name: 'Save' })).toBeDisabled();

    fireEvent.click(within(sheet).getByRole('button', { name: 'Tent 1' }));
    expect(within(sheet).getByRole('button', { name: 'Save' })).toBeEnabled();
  });

  // A grow and the tent it stands in are different arrangements, and one row of
  // chips mixing them gives a reader no way to tell which is which.
  it('asks for a grow and for a place under headings of their own', async () => {
    await drawLoaded();
    fireEvent.click(screen.getByRole('button', { name: '+ Reminder' }));
    const sheet = screen.getByRole('dialog', { name: 'New reminder' });

    expect(within(within(sheet).getByRole('group', { name: 'Grows' })).getByRole('button', { name: 'Spring run' })).toBeInTheDocument();
    expect(within(within(sheet).getByRole('group', { name: 'Places' })).getByRole('button', { name: 'Tent 1' })).toBeInTheDocument();
  });

  // A write that never reached the server is not a page that would not load,
  // and the app has no gesture to offer for one either.
  it('says the server could not be reached when the request never got there', async () => {
    vi.mocked(api.post).mockRejectedValue(new TypeError('Failed to fetch'));
    await drawLoaded();
    fireEvent.click(screen.getByRole('button', { name: '+ Reminder' }));
    const sheet = screen.getByRole('dialog', { name: 'New reminder' });

    fireEvent.change(within(sheet).getByRole('textbox', { name: 'What to do' }), { target: { value: 'Flush' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Tent 1' }));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }));

    expect(await within(sheet).findByRole('alert')).toHaveTextContent('Could not reach the server. Try again.');
  });

  it('opens filled in from the card it made, and deletes only after asking', async () => {
    await drawLoaded();
    const card = section('Today').getByText('Water').closest('li')!;
    fireEvent.click(within(card).getByRole('button', { name: 'Edit' }));
    const sheet = screen.getByRole('dialog', { name: 'Reminder' });

    expect(within(sheet).getByRole('textbox', { name: 'What to do' })).toHaveValue('Water');
    expect(within(sheet).getByLabelText('Every … days')).toHaveValue(3);
    // Where a reminder is about is fixed once it is made.
    expect(within(sheet).getByRole('button', { name: 'Spring run' })).toBeDisabled();

    fireEvent.click(within(sheet).getByRole('button', { name: 'Delete this reminder' }));
    expect(api.delete).not.toHaveBeenCalled();
    expect(within(sheet).getByText(/^The rhythm stops/)).toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Yes, delete it' }));

    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/reminders/rem-1'));
    // A rhythm made again would count from today, so the toast names it and offers no way back.
    expect(await screen.findByText(reading('Reminder deleted · Water'))).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument();
  });

  it('is not offered on a plan step, which has no rhythm to change', async () => {
    await drawLoaded();
    const card = screen.getByText('Confirm: Late flower on day 36?').closest('li')!;

    expect(within(card).queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
  });

  // Whose a reminder is cannot be handed to a third person here, but a rhythm
  // edited by somebody who came to change the days must not quietly land on
  // them instead of the person it was written for.
  it('keeps somebody else´s name on it when the rhythm is changed', async () => {
    await drawLoaded();
    fireEvent.click(screen.getByRole('radio', { name: 'All' }));
    fireEvent.click(within(section('Today').getByText('Feed').closest('li')!).getByRole('button', { name: 'Edit' }));
    const sheet = screen.getByRole('dialog', { name: 'Reminder' });

    const kept = within(sheet).getByRole('button', { name: 'somebody else · kept' });
    expect(kept).toHaveAttribute('aria-pressed', 'true');
    expect(kept).toBeDisabled();
    expect(within(sheet).getByRole('button', { name: 'everyone' })).toHaveAttribute('aria-pressed', 'false');

    fireEvent.change(within(sheet).getByLabelText('Every … days'), { target: { value: '9' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith('/reminders/rem-3', expect.objectContaining({ everyDays: 9, assigneeId: 'user-mia' })),
    );
  });

  it('is offered no third choice when it is everyone´s', async () => {
    await drawLoaded();
    fireEvent.click(within(section('Tomorrow').getByText('Clean the carbon filter').closest('li')!).getByRole('button', { name: 'Edit' }));

    expect(within(screen.getByRole('dialog', { name: 'Reminder' })).queryByRole('button', { name: 'somebody else · kept' })).not.toBeInTheDocument();
  });
});

describe('the demo', () => {
  // The demo reads somebody else’s account, and the server answers it no task
  // list at all - so the page says that rather than that nothing is due.
  it('is told it has no task list, and is offered nothing to tap', async () => {
    who.demo = true;
    state.waiting = [];
    state.done = [];
    await drawLoaded();

    expect(screen.getByText('The demo has no task list; open a place to see what is due there.')).toBeInTheDocument();
    expect(screen.queryByText('Nothing is due.')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Done:/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^\+ Reminder/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    // Nor is it told what a list it does not have holds.
    expect(screen.queryByRole('button', { name: 'About Tasks' })).not.toBeInTheDocument();
  });
});

/**
 * The same account, the same tasks, and a tent it was let into rather than one
 * it owns. What changes is every control: a member may tick off the lines they
 * were let in to write, and may not confirm a plan step - which moves the
 * owner's plan on and sends the next step's targets to the controller, and is
 * exactly what the Control tab already refuses them.
 */
describe('a member who may only log', () => {
  beforeEach(() => {
    state.youMay = 'log';
  });

  it('still ticks off the tasks that are diary lines', async () => {
    await drawLoaded();

    fireEvent.click(screen.getByRole('button', { name: 'Done: Water' }));

    expect(api.post).toHaveBeenCalledWith('/tasks/rem-1%3A2026-09-16/completions', {});
    expect(await screen.findByText(reading('Done · Water · Spring run'))).toBeInTheDocument();
  });

  it('is offered no circle on a plan step, and is told whose the plan is', async () => {
    await drawLoaded();

    expect(section('This week').getByText('Confirm: Late flower on day 36?')).toBeInTheDocument();
    expect(section('This week').queryByRole('button', { name: /^Done:/ })).not.toBeInTheDocument();
    expect(section('This week').getByText(/Only whoever manages the place can do that\./)).toBeInTheDocument();
  });

  it('is offered neither the Edit on somebody else’s rhythm nor a new one', async () => {
    await drawLoaded();

    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^\+ Reminder/ })).not.toBeInTheDocument();
  });

  it('is what the owner is not: the owner keeps all three', async () => {
    state.youMay = 'own';
    await drawLoaded();

    expect(section('This week').getByRole('button', { name: /^Done:/ })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Edit' }).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /^\+ Reminder/ })).toBeInTheDocument();
  });
});

describe('the sheet', () => {
  /**
   * The clock above the screen re-renders it every ten seconds. A sheet that is
   * handed a new closer on each of those re-runs its opening effect and pulls
   * the focus back onto itself, which on a phone means the keyboard closing
   * halfway through a label.
   */
  it('keeps the focus in the field being typed in while the clock ticks', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(NOW.toJSDate());

    try {
      draw();
      await screen.findByRole('heading', { name: 'Tasks', level: 1 });
      fireEvent.click(await screen.findByRole('button', { name: '+ Reminder' }));

      const field = within(screen.getByRole('dialog', { name: 'New reminder' })).getByRole('textbox', { name: 'What to do' });
      field.focus();
      fireEvent.change(field, { target: { value: 'Flu' } });

      act(() => void vi.advanceTimersByTime(10_000));

      expect(document.activeElement).toBe(field);
      expect(field).toHaveValue('Flu');
    } finally {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(NOW.toJSDate());
    }
  });
});

/**
 * Behind the bell: the bell's count and the inbox's "Tasks" are one read, the
 * task list as this page files it under "Today" and "Mine", less what the
 * reader may not settle. It is read on the alerts' beat, by an account that
 * keeps a diary or steers a place, and by nobody else.
 */
describe('what is due for the reader, behind the bell', () => {
  const wire = { diary: true, home: [] as HomeSpaceCard[] };
  const tent = (over: Partial<HomeSpaceCard> = {}) =>
    cardOf({ spaceId: 'space-1', name: 'Tent 1', deviceIds: [], grow: { growId: 'grow-1', name: 'Spring run' } as HomeSpaceCard['grow'], ...over });
  const stepDue = { ...planStep, dueAt: NOW.minus({ minutes: 30 }).toUTC().toISO()! };
  const reads = (path: string) => vi.mocked(api.get).mock.calls.filter(([asked]) => asked === path);
  const inbox = () => within(screen.getByRole('region', { name: 'Tasks' }));
  const drawInbox = () =>
    drawAt(
      <LogProvider>
        <Rail />
        <Alerts />
      </LogProvider>,
    );

  beforeEach(() => {
    wire.diary = true;
    wire.home = [tent()];
    state.waiting = [overdue, water, mias, chore, stepDue];
    vi.mocked(api.get).mockImplementation((path: string, query?: Record<string, unknown>) => {
      if (path === '/home') return Promise.resolve({ spaces: wire.home, followedGrows: [], people: [], layers: { diary: wire.diary } }) as never;
      if (path === '/me') return Promise.resolve({ preferences: { timezone: null }, layers: { diary: wire.diary } }) as never;
      if (path === '/tasks' || path === '/spaces' || path === '/grows') return Promise.resolve(answers(path, query)) as never;
      return Promise.resolve({ items: [], nextCursor: null }) as never;
    });
  });

  it('counts and lists the tasks that are everyone´s and the reader´s own, due today or before, and none of somebody else´s', async () => {
    drawInbox();

    expect(await screen.findByRole('link', { name: 'Alerts · 3 tasks due' })).toBeInTheDocument();
    expect(
      inbox()
        .getAllByRole('button')
        .map(button => button.getAttribute('aria-label')),
    ).toEqual(['Log: Water the seedlings', 'Log: Water', 'Confirm: Late flower on day 36?']);
    // Start's row: since when it is due, and nowhere named while there is one place.
    expect(inbox().getByText(reading('2 days overdue'))).toBeInTheDocument();
    expect(inbox().getByText(reading(/^grow plan · due since \d\d:\d\d$/))).toBeInTheDocument();
    expect(inbox().queryByText('Feed')).not.toBeInTheDocument();
    expect(inbox().queryByText('Clean the carbon filter')).not.toBeInTheDocument();
  });

  it('says where a task is due before since when, once the account has several places', async () => {
    wire.home = [tent(), tent({ spaceId: 'space-2', name: 'Tent 2', grow: null })];
    drawInbox();

    expect(await screen.findByText(reading('Spring run · Tent 1 · 2 days overdue'))).toBeInTheDocument();
    expect(inbox().getByText(reading(/^grow plan · Tent 1 · due since \d\d:\d\d$/))).toBeInTheDocument();
  });

  it('follows a tick made elsewhere on the next beat, on a page that is not the inbox', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      drawAt(
        <LogProvider>
          <Rail />
        </LogProvider>,
      );
      await screen.findByRole('link', { name: 'Alerts · 3 tasks due' });

      state.waiting = [water, mias];
      await act(() => vi.advanceTimersByTimeAsync(31_000));

      expect(await screen.findByRole('link', { name: 'Alerts · 1 task due' })).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
      vi.useFakeTimers({ toFake: ['Date'] });
    }
  });

  it('counts and offers a member who may only log the diary´s tasks, and no step of the plan', async () => {
    state.youMay = 'log';
    drawInbox();

    expect(await screen.findByRole('link', { name: 'Alerts · 2 tasks due' })).toBeInTheDocument();
    expect(inbox().queryByRole('button', { name: /^Confirm/ })).not.toBeInTheDocument();
  });

  it('counts and lists nothing for somebody who may only look', async () => {
    state.youMay = 'view';
    drawInbox();

    expect(await screen.findByRole('link', { name: 'All tasks and reminders ›' })).toBeInTheDocument();
    await waitFor(() => expect(reads('/grows')).not.toHaveLength(0));
    expect(screen.getByRole('link', { name: 'Alerts' })).toBeInTheDocument();
    expect(inbox().queryByRole('button')).not.toBeInTheDocument();
  });

  it('counts and offers a step of the grow plan to whoever steers a place without keeping a diary, and none of the diary´s', async () => {
    wire.diary = false;
    drawInbox();

    expect(await screen.findByRole('link', { name: 'Alerts · 1 task due' })).toBeInTheDocument();
    expect(inbox().getByRole('button')).toHaveAccessibleName('Confirm: Late flower on day 36?');
    expect(inbox().queryByRole('link')).not.toBeInTheDocument();
  });

  it('asks an account that keeps no diary and steers no place for no list, and offers it none', async () => {
    wire.diary = false;
    state.youMay = 'log';
    drawInbox();

    expect(await screen.findByRole('heading', { name: 'Alerts', level: 1 })).toBeInTheDocument();
    await waitFor(() => expect(reads('/home')).not.toHaveLength(0));
    expect(await screen.findByRole('link', { name: 'Alerts' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Tasks' })).not.toBeInTheDocument();
    expect(reads('/tasks')).toHaveLength(0);
  });

  it('asks the demo, which may settle nothing, for no list either', async () => {
    who.demo = true;
    drawInbox();

    expect(await screen.findByText('The demo has no alerts of its own; open a place to see its alarms.')).toBeInTheDocument();
    await waitFor(() => expect(reads('/home')).not.toHaveLength(0));
    expect(screen.queryByRole('region', { name: 'Tasks' })).not.toBeInTheDocument();
    expect(reads('/tasks')).toHaveLength(0);
  });
});
