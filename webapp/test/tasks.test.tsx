import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import i18next from 'i18next';
import { DateTime, Settings } from 'luxon';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { initReactI18next } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccessNeed, Entry, GrowListItem, Reminder, Task } from '@fg2/shared-types/v1';
import { api } from '@/api/client';
import { ApiError } from '@/api/problem';
import { LogProvider } from '@/log/LogProvider';
import { Tasks } from '@/screens/Tasks';
import { dateLabel, groupOf } from '@/screens/tasks/tasks';
import { spaceWhere, THE_HOST, YOU } from './session';

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
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn(), upload: vi.fn() },
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
  if (path === '/me') return { preferences: { timezone: state.zone } };
  throw new Error(`nothing mocked for ${path}`);
};

const written = { id: 'entry-new', kind: 'water', undoUntil: null } as unknown as Entry;

const draw = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <LogProvider>
          <Tasks />
        </LogProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );

/** The screen, once the waiting list and the names of the places have both arrived. */
const drawLoaded = async () => {
  draw();
  await screen.findByRole('radiogroup', { name: 'Whose tasks' });
  if (state.waiting.length > 0) await screen.findAllByText(/Spring run|Tent 1/);
};

const section = (name: string) => within(screen.getByRole('region', { name }));

beforeAll(async () => {
  const translation = JSON.parse(await readFile(resolve(process.cwd(), 'public/assets/i18n/en.json'), 'utf8'));
  await i18next
    .use(initReactI18next)
    .init({ lng: 'en', resources: { en: { translation } }, nsSeparator: false, interpolation: { escapeValue: false } });

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

    expect(screen.getByText('every 3 d · Spring run · water · 2 L · today')).toBeInTheDocument();
    // The kind reads as the lowercase word the rest of the line is written in,
    // and a custom reminder, whose label already says everything, names none.
    expect(screen.getByText('every 30 d · Tent 1 · chore · tomorrow')).toBeInTheDocument();
    expect(screen.getByText('grow plan · Tent 1 · in 2 d')).toBeInTheDocument();
    expect(screen.getByText('every 3 d · Spring run · water · 2 L · overdue 2 d')).toBeInTheDocument();
    expect(screen.getByText('you · Spring run · yesterday 19:40')).toBeInTheDocument();
  });

  it('dates a tick by the account´s clock, which is the one the alerts beside it are dated by', async () => {
    // The same tick read 10:39 on the alerts screen and 12:39 here, because
    // only this one asked the browser what the hour was.
    state.zone = 'Pacific/Kiritimati';
    await drawLoaded();

    const there = DateTime.fromISO(ticked.completion!.occurredAt).setZone('Pacific/Kiritimati');
    expect(await screen.findByText(new RegExp(`you · Spring run · .+ ${there.toFormat('HH:mm')}$`))).toBeInTheDocument();
    expect(screen.queryByText('you · Spring run · yesterday 19:40')).not.toBeInTheDocument();
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
    expect(within(row).getByText('every 90 d · Tent 1 · chore')).toBeInTheDocument();
    // Nothing is due of it, so it is on the screen once and only here.
    expect(screen.getAllByText('Check the inline filter')).toHaveLength(1);

    fireEvent.click(within(row).getByRole('button', { name: 'Edit' }));
    expect(within(screen.getByRole('dialog', { name: 'Reminder' })).getByLabelText('Every … days')).toHaveValue(90);
  });

  it('lists a one-off falling after the horizon by the day it falls on', async () => {
    state.rhythms = [reminder({ id: 'rem-8', label: 'Repot', everyDays: null, onceAt: daysFromNow(40), defaults: null })];
    await drawLoaded();

    expect(section('Rhythms').getByText(/^once on 26 Oct 2026 · Spring run · water$/)).toBeInTheDocument();
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
    expect(section('This week').getByText(/^once · Spring run · chore · in 7 d$/)).toBeInTheDocument();
    expect(section('Rhythms').getByText(/^once on 30 Sep 2026 · Spring run · chore$/)).toBeInTheDocument();
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
  it('writes the completion of exactly that task, and says what line it wrote', async () => {
    await drawLoaded();

    fireEvent.click(screen.getByRole('button', { name: 'Done: Water' }));

    expect(api.post).toHaveBeenCalledWith('/tasks/rem-1%3A2026-09-16/completions', {});
    expect(await screen.findByText('Watered · Spring run')).toBeInTheDocument();
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
    expect(await screen.findByText('Step confirmed · Tent 1')).toBeInTheDocument();
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
    expect(screen.queryByText('Could not save that line')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});

describe('a reminder', () => {
  it('is posted with a rhythm and nothing else set', async () => {
    await drawLoaded();
    fireEvent.click(screen.getByRole('button', { name: '+ Reminder · every N days · once · chore' }));
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

  it('is posted as a one-off, due from the start of the chosen day, with the can it opens on', async () => {
    await drawLoaded();
    fireEvent.click(screen.getByRole('button', { name: '+ Reminder · every N days · once · chore' }));
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
    fireEvent.click(screen.getByRole('button', { name: '+ Reminder · every N days · once · chore' }));
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
    fireEvent.click(screen.getByRole('button', { name: '+ Reminder · every N days · once · chore' }));
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
    fireEvent.click(screen.getByRole('button', { name: '+ Reminder · every N days · once · chore' }));
    const sheet = screen.getByRole('dialog', { name: 'New reminder' });

    expect(within(within(sheet).getByRole('group', { name: 'Grows' })).getByRole('button', { name: 'Spring run' })).toBeInTheDocument();
    expect(within(within(sheet).getByRole('group', { name: 'Places' })).getByRole('button', { name: 'Tent 1' })).toBeInTheDocument();
  });

  // A write that never reached the server is not a page that would not load,
  // and the app has no gesture to offer for one either.
  it('says the server could not be reached when the request never got there', async () => {
    vi.mocked(api.post).mockRejectedValue(new TypeError('Failed to fetch'));
    await drawLoaded();
    fireEvent.click(screen.getByRole('button', { name: '+ Reminder · every N days · once · chore' }));
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
    fireEvent.click(within(sheet).getByRole('button', { name: 'Yes, delete it' }));

    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/reminders/rem-1'));
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
  // The demo reads somebody else's account, and the server answers it no task
  // list at all - so the page says that rather than that nothing is due.
  it('is told it has no task list, and is offered nothing to tap', async () => {
    who.demo = true;
    state.waiting = [];
    state.done = [];
    await drawLoaded();

    expect(screen.getByText('The demo has no task list; open a space to see what is due there.')).toBeInTheDocument();
    expect(screen.queryByText('Nothing is due.')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Done:/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^\+ Reminder/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
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
  });

  it('is offered no circle on a plan step, and is told whose the plan is', async () => {
    await drawLoaded();

    expect(section('This week').getByText('Confirm: Late flower on day 36?')).toBeInTheDocument();
    expect(section('This week').queryByRole('button', { name: /^Done:/ })).not.toBeInTheDocument();
    expect(section('This week').getByText(/Only whoever steers the space can do that\./)).toBeInTheDocument();
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
      await screen.findByRole('radiogroup', { name: 'Whose tasks' });
      fireEvent.click(await screen.findByRole('button', { name: '+ Reminder · every N days · once · chore' }));

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
