import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import i18next from 'i18next';
import { DateTime } from 'luxon';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { initReactI18next } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Entry, GrowListItem, Reminder, Space, Task } from '@fg2/shared-types/v1';
import { api } from '@/api/client';
import { ApiError } from '@/api/problem';
import { LogProvider } from '@/log/LogProvider';
import { Tasks } from '@/screens/Tasks';

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
  label: 'Confirm: late flower on day 36',
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

const reminders = [
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

const grows = [{ id: 'grow-1', name: 'Spring run', endedAt: null } as GrowListItem];
const spaces = [{ id: 'space-1', name: 'Tent 1', kind: 'tent' } as Space];

const state = { waiting: [] as Task[], done: [] as Task[] };

const answers = (path: string, query?: Record<string, unknown>) => {
  if (path === '/tasks') return { items: query?.done ? state.done : state.waiting, nextCursor: null };
  if (path === '/reminders') return { items: reminders, nextCursor: null };
  if (path === '/grows') return { items: grows, nextCursor: null };
  if (path === '/spaces') return { items: spaces, nextCursor: null };
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
  state.waiting = [water, chore, planStep, mias, overdue];
  state.done = [ticked];
  vi.mocked(api.get).mockImplementation((path: string, query?: Record<string, unknown>) => Promise.resolve(answers(path, query)) as never);
  vi.mocked(api.post).mockResolvedValue(written as never);
  vi.mocked(api.patch).mockResolvedValue(reminders[0] as never);
  vi.mocked(api.delete).mockResolvedValue(undefined as never);
});

describe('the groups', () => {
  it('sorts what is waiting into today, tomorrow and this week, and what was ticked off under done', async () => {
    await drawLoaded();

    expect(section('Today').getByText('Water · Spring run')).toBeInTheDocument();
    expect(section('Today').getByText('Water the seedlings · Spring run')).toBeInTheDocument();
    expect(section('Tomorrow').getByText('Clean the carbon filter · Tent 1')).toBeInTheDocument();
    // A plan step's title is the step's own message; where it stands is on the line under it.
    expect(section('This week').getByText('Confirm: late flower on day 36')).toBeInTheDocument();
    expect(section('Done').getByText('Defoliate lower leaves · Spring run')).toBeInTheDocument();

    // Today's date beside the label, in the reader's locale; the done group is dated by its newest tick.
    expect(screen.getByRole('region', { name: 'Today' })).toHaveTextContent(/16/);
    expect(screen.getByRole('region', { name: 'Today' })).toHaveTextContent(/Sep/);
    expect(screen.getByRole('region', { name: 'Done' })).toHaveTextContent('yesterday');
  });

  it('says where each task came from and when it is due', async () => {
    await drawLoaded();

    expect(screen.getByText('every 3 d · 2 L · today')).toBeInTheDocument();
    expect(screen.getByText('every 30 d · Chore · tomorrow')).toBeInTheDocument();
    expect(screen.getByText('grow plan · Tent 1 · in 2 d')).toBeInTheDocument();
    expect(screen.getByText('every 3 d · 2 L · overdue 2 d')).toBeInTheDocument();
    expect(screen.getByText('you · yesterday 19:40')).toBeInTheDocument();
  });

  it('marks whose a task is: my initials, a plain mark for somebody else, nothing for everyone', async () => {
    await drawLoaded();
    fireEvent.click(screen.getByRole('radio', { name: 'All' }));

    expect(within(screen.getByText('Water · Spring run').closest('li')!).getByRole('img', { name: 'assigned to you' })).toHaveTextContent('YO');
    expect(within(screen.getByText('Feed · Spring run').closest('li')!).getByRole('img', { name: 'assigned to somebody else' })).toBeInTheDocument();
    expect(within(screen.getByText('Clean the carbon filter · Tent 1').closest('li')!).queryByRole('img')).not.toBeInTheDocument();
  });

  it('says so when nothing is due', async () => {
    state.waiting = [];
    state.done = [];
    await drawLoaded();

    expect(screen.getByText('Nothing is due.')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Today' })).not.toBeInTheDocument();
  });
});

describe('mine and all', () => {
  it("hides a task with somebody else's name on it under Mine and shows it under All, and remembers the choice", async () => {
    await drawLoaded();

    expect(screen.getByRole('radio', { name: 'Mine' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.queryByText('Feed · Spring run')).not.toBeInTheDocument();
    expect(screen.getByText('Clean the carbon filter · Tent 1')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('radio', { name: 'All' }));

    expect(screen.getByText('Feed · Spring run')).toBeInTheDocument();
    expect(localStorage.getItem('terp.tasks.scope')).toBe('all');
  });
});

describe('ticking one off', () => {
  it('writes the completion of exactly that task, and says what line it wrote', async () => {
    await drawLoaded();

    fireEvent.click(screen.getByRole('button', { name: 'Done: Water · Spring run' }));

    expect(api.post).toHaveBeenCalledWith('/tasks/rem-1%3A2026-09-16/completions', {});
    expect(await screen.findByText('Watered · Spring run')).toBeInTheDocument();
  });

  it('is not a control on a card that is already done', async () => {
    await drawLoaded();

    expect(section('Done').queryByRole('button')).not.toBeInTheDocument();
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
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }));

    expect(await within(sheet).findByRole('alert')).toHaveTextContent('Only whoever manages this tent can set a reminder for it.');
    expect(screen.getByRole('dialog', { name: 'New reminder' })).toBeInTheDocument();
  });

  it('opens filled in from the card it made, and deletes only after asking', async () => {
    await drawLoaded();
    const card = screen.getByText('Water · Spring run').closest('li')!;
    fireEvent.click(within(card).getByRole('button', { name: 'edit' }));
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
    const card = screen.getByText('Confirm: late flower on day 36').closest('li')!;

    expect(within(card).queryByRole('button', { name: 'edit' })).not.toBeInTheDocument();
  });
});

describe('the demo', () => {
  it('sees every task and is offered nothing to tap', async () => {
    who.demo = true;
    await drawLoaded();

    expect(screen.getByText('Clean the carbon filter · Tent 1')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Done:/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^\+ Reminder/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'edit' })).not.toBeInTheDocument();
  });
});
