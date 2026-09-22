import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import i18next from 'i18next';
import { DateTime } from 'luxon';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { ReactNode } from 'react';
import { initReactI18next } from 'react-i18next';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Invite, InvitePreview, Membership, MembershipPage, Problem, Space } from '@fg2/shared-types/v1';
import { JoinRoute } from '@/screens/join/JoinRoute';
import { Members } from '@/screens/space/members/Members';
import { decidesHere, guestsOf, peopleCount, viaRoomCount } from '@/screens/space/members/people';
import { ThemeProvider } from '@/theme/ThemeProvider';

/**
 * Sharing a tent, from both ends: the member list its owner keeps, and the
 * invitation a stranger opens.
 *
 * Two things are worth more than the rest here and are checked hardest. The
 * first is that a row held on the room is drawn in the tent and changed only in
 * the room - a menu or a remove button on such a row would take somebody out of
 * every tent grouped under it while naming one. The second is that handing out
 * the way in belongs to the owner alone: a member sees the same list, because
 * they have to be able to tell whose entry they are reading, and no control on
 * it but the one that lets them out. The third is that the list is a list of
 * people: somebody who holds a row on the room and a row on the tent is one
 * person with the stronger of the two roles, not two cards that contradict
 * each other and the count above them.
 *
 * The fetch is stubbed by route rather than the hooks being mocked, so what is
 * asserted about a write is the body that went on the wire.
 */

const session = vi.hoisted(() => ({ who: 'owner' as 'owner' | 'member' | 'demo' | 'signedOut' }));

vi.mock('@/api/session', async importOriginal => {
  const { SIGNED_IN, SIGNED_OUT, ON_THE_DEMO } = await import('./session');
  const original = await importOriginal<object>();
  /** The member is the same session as the owner with somebody else's id, which is what a second account in a tent is. */
  const LET_IN = { ...SIGNED_IN, user: { ...SIGNED_IN.user!, id: 'user-2', handle: 'lea' } };
  const seats = { owner: SIGNED_IN, member: LET_IN, demo: ON_THE_DEMO, signedOut: SIGNED_OUT };

  return { ...original, useSession: () => seats[session.who] };
});

const NOW = DateTime.now();

const space = (over: Partial<Space>): Space => ({
  id: 'space-1',
  ownerId: 'user-1',
  youMay: 'own',
  kind: 'tent',
  name: 'Blue Dream tent',
  roomId: null,
  presetPrompt: 'ask',
  retention: { climateDays: null },
  isDemo: false,
  archivedAt: null,
  createdAt: NOW.minus({ years: 1 }).toISO()!,
  ...over,
});

const membership = (over: Partial<Membership>): Membership => ({
  id: 'membership-1',
  spaceId: 'space-1',
  userId: 'user-2',
  role: 'can_log',
  invitedBy: 'user-1',
  inviteId: 'invite-1',
  createdAt: NOW.minus({ days: 1 }).toISO()!,
  ...over,
});

const invite = (over: Partial<Invite> = {}): Invite => ({
  id: 'invite-1',
  code: 'K7QZ4M2P',
  spaceId: 'space-1',
  role: 'can_log',
  createdBy: 'user-1',
  expiresAt: NOW.plus({ days: 7 }).toISO()!,
  revokedAt: null,
  state: { useCount: 0, lastUsedAt: null },
  createdAt: NOW.minus({ hours: 1 }).toISO()!,
  ...over,
});

const MEMBERS: MembershipPage = {
  items: [membership({}), membership({ id: 'membership-2', spaceId: 'room-1', userId: 'user-3', role: 'can_manage', inviteId: null })],
  nextCursor: null,
  people: [
    { id: 'user-2', handle: 'lea' },
    { id: 'user-3', handle: 'jonas' },
  ],
  room: { id: 'room-1', name: 'Grow room' },
  // Lea wrote yesterday; Jonas never has.
  activity: [{ userId: 'user-2', lastEntryAt: NOW.minus({ days: 1 }).toISO()! }],
};

/** Lea twice: on the room and on the tent, with either the stronger role. */
const BOTH_WAYS = (roomRole: 'can_log' | 'can_manage', tentRole: 'can_log' | 'can_manage'): MembershipPage => ({
  ...MEMBERS,
  items: [membership({ role: tentRole }), membership({ id: 'membership-2', spaceId: 'room-1', role: roomRole, inviteId: null })],
  people: [{ id: 'user-2', handle: 'lea' }],
});

const refusal = (code: string, detail: string, status = 409): Problem => ({ status, code, title: 'Refused', detail, errors: [] });

/** What the server holds, and what it says to a write. Every body that arrives is kept so a test can read it. */
const server = {
  spaces: [] as Space[],
  members: MEMBERS,
  invites: [] as Invite[],
  preview: {} as InvitePreview,
  refuse: null as Problem | null,
  wrote: [] as { method: string; path: string; body: unknown }[],
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const NOT_FOUND = { status: 404, code: 'not_found', title: 'Not found', detail: '', errors: [] };

const fetchStub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const path = String(input).replace(/^.*\/v1/, '');
  const method = init?.method ?? 'GET';
  const body = init?.body ? (JSON.parse(String(init.body)) as unknown) : undefined;

  if (method !== 'GET') {
    server.wrote.push({ method, path, body });
    if (server.refuse) return json(server.refuse, server.refuse.status);
  }

  if (method === 'GET' && path.startsWith('/spaces?')) return json({ items: server.spaces, nextCursor: null });
  if (method === 'GET' && path === '/spaces') return json({ items: server.spaces, nextCursor: null });
  if (method === 'GET' && path.startsWith('/spaces/space-1/members')) return json(server.members);
  if (method === 'GET' && path.startsWith('/spaces/space-1/invites')) return json({ items: server.invites, nextCursor: null });
  if (method === 'POST' && path === '/spaces/space-1/invites') {
    server.invites = [invite()];
    return json(server.invites[0], 201);
  }
  if (method === 'POST' && path === '/spaces/space-1/members') return json(membership({ id: 'membership-3', userId: 'user-9' }), 201);
  if (method === 'PATCH' && path.startsWith('/spaces/space-1/members/')) return json(membership({ role: 'can_manage' }));
  if (method === 'DELETE' && path.startsWith('/spaces/space-1/members/')) return new Response(null, { status: 204 });
  if (method === 'PUT' && path.endsWith('/revocation')) return json(invite({ revokedAt: NOW.toISO()! }));
  if (method === 'GET' && path.startsWith('/invites/')) return json(server.preview);
  if (method === 'POST' && path.endsWith('/acceptances')) return json({ membership: membership({}), space: space({ id: 'space-9' }) }, 201);

  return json(NOT_FOUND, 404);
}) as unknown as typeof fetch;

const wrapped = (node: ReactNode, at = '/') =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
      <MemoryRouter initialEntries={[at]}>
        <ThemeProvider>{node}</ThemeProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );

const drawTab = (roomId: string | null = 'room-1') => wrapped(<Members spaceId="space-1" name="Blue Dream tent" kind="tent" roomId={roomId} />);

const drawnPeople = async () => {
  drawTab();
  await screen.findByText('@jonas');
  return screen.getAllByRole('listitem');
};

beforeAll(async () => {
  const translation = JSON.parse(await readFile(resolve(process.cwd(), 'public/assets/i18n/en.json'), 'utf8')) as Record<string, unknown>;
  await i18next
    .use(initReactI18next)
    .init({ lng: 'en', resources: { en: { translation } }, nsSeparator: false, interpolation: { escapeValue: false } });
});

beforeEach(() => {
  vi.stubGlobal('fetch', fetchStub);
  session.who = 'owner';
  server.spaces = [
    space({ roomId: 'room-1' }),
    space({ id: 'room-1', kind: 'room', name: 'Grow room' }),
    space({ id: 'space-2', roomId: 'room-1', name: 'Mother tent' }),
  ];
  server.members = MEMBERS;
  server.invites = [];
  server.refuse = null;
  server.wrote = [];
  server.preview = {
    isValid: true,
    spaceName: 'Blue Dream tent',
    spaceKind: 'tent',
    role: 'can_log',
    invitedByHandle: 'chris',
    expiresAt: NOW.plus({ days: 5 }).toISO()!,
  };
});

afterEach(() => vi.unstubAllGlobals());

describe('the arithmetic of a member list', () => {
  it('counts the owner, who is never a row', () => {
    expect(peopleCount(MEMBERS)).toBe(3);
  });

  it('tells one sort of row from the other by the space each one names', () => {
    expect(viaRoomCount(MEMBERS, 'space-1')).toBe(1);
    expect(guestsOf(MEMBERS, 'space-1').map(guest => guest.userId)).toEqual(['user-2', 'user-3']);
  });

  it('folds two rows of one person into one guest with the stronger role, and counts them once', () => {
    const page = BOTH_WAYS('can_log', 'can_manage');
    const guests = guestsOf(page, 'space-1');

    expect(guests).toHaveLength(1);
    expect(guests[0].role).toBe('can_manage');
    expect(guests[0].here?.spaceId).toBe('space-1');
    expect(guests[0].viaRoom?.spaceId).toBe('room-1');
    expect(peopleCount(page)).toBe(2);
    expect(viaRoomCount(page, 'space-1')).toBe(1);
  });

  it("lets the tent's own row decide only where the room does not already grant more", () => {
    expect(decidesHere(guestsOf(BOTH_WAYS('can_log', 'can_manage'), 'space-1')[0])).toBe(true);
    expect(decidesHere(guestsOf(BOTH_WAYS('can_log', 'can_log'), 'space-1')[0])).toBe(true);
    expect(decidesHere(guestsOf(BOTH_WAYS('can_manage', 'can_log'), 'space-1')[0])).toBe(false);
    expect(decidesHere(guestsOf(MEMBERS, 'space-1')[1])).toBe(false);
  });
});

describe('the Members tab as its owner', () => {
  it('names everybody in the tent, says how they got here, and counts the room in', async () => {
    const rows = await drawnPeople();

    expect(screen.getByText('People in Blue Dream tent')).toBeInTheDocument();
    expect(screen.getByText('3 · 1 via the room')).toBeInTheDocument();
    expect(within(rows[0]).getByText('You')).toBeInTheDocument();
    expect(within(rows[1]).getByText(/joined via link/)).toBeInTheDocument();
    expect(within(rows[2]).getByText(/via Grow room/)).toBeInTheDocument();
  });

  it('says when each person last wrote here, and says so in words when they never have', async () => {
    const rows = await drawnPeople();

    expect(within(rows[1]).getByText(/last logged 1 d/)).toBeInTheDocument();
    expect(within(rows[2]).getByText(/nothing logged yet/)).toBeInTheDocument();
  });

  it('says somebody has written nothing rather than leaving the line at how they got here', async () => {
    server.members = { ...MEMBERS, activity: [] };
    const rows = await drawnPeople();

    expect(within(rows[1]).getByText(/nothing logged yet/)).toBeInTheDocument();
    expect(within(rows[1]).getByText(/joined via link/)).toBeInTheDocument();
  });

  it('draws somebody who is in the room and in the tent once, with the stronger role and both ways in', async () => {
    server.members = BOTH_WAYS('can_log', 'can_manage');
    drawTab();
    await screen.findByText('@lea');
    const rows = screen.getAllByRole('listitem');

    expect(screen.getAllByText('@lea')).toHaveLength(1);
    expect(screen.getByText('2 · 1 via the room')).toBeInTheDocument();
    expect(within(rows[1]).getByText('joined via link · also via Grow room')).toBeInTheDocument();
    expect(within(rows[1]).getByRole('combobox', { name: 'What lea may do here' })).toHaveValue('can_manage');
  });

  it('draws a chip rather than a menu where the room already grants more than the tent could', async () => {
    server.members = BOTH_WAYS('can_manage', 'can_log');
    drawTab();
    await screen.findByText('@lea');
    const rows = screen.getAllByRole('listitem');

    expect(within(rows[1]).queryByRole('combobox')).not.toBeInTheDocument();
    expect(within(rows[1]).getByText('can manage')).toBeInTheDocument();
    expect(within(rows[1]).queryByText('can log')).not.toBeInTheDocument();
  });

  it('says that ending the row of somebody who is also in the room leaves them the tent through it', async () => {
    server.members = BOTH_WAYS('can_log', 'can_manage');
    drawTab();
    await screen.findByText('@lea');

    fireEvent.click(screen.getByRole('button', { name: 'Take lea out of this tent' }));
    expect(screen.getByText(/keep this tent through Grow room/)).toBeInTheDocument();
  });

  it('draws a handle with nowhere to break whole, in its own row', async () => {
    server.members = {
      ...MEMBERS,
      people: [
        { id: 'user-2', handle: 'karlsruherkellergaertner' },
        { id: 'user-3', handle: 'jonas' },
      ],
    };
    const rows = await drawnPeople();

    expect(within(rows[1]).getByText('@karlsruherkellergaertner')).toBeInTheDocument();
    expect(within(rows[1]).getByRole('combobox', { name: 'What karlsruherkellergaertner may do here' })).toBeInTheDocument();
  });

  it('says of the owner that they own the place, on a row of their own at the top', async () => {
    const rows = await drawnPeople();

    expect(within(rows[0]).getByText('You')).toBeInTheDocument();
    expect(within(rows[0]).getByText('owner of Blue Dream tent')).toBeInTheDocument();
    expect(within(rows[0]).getByText('owner')).toBeInTheDocument();
  });

  it('offers the room beside the tent, as an address of its own', async () => {
    await drawnPeople();

    expect(screen.getByRole('link', { name: 'Grow room · 2 tents' })).toHaveAttribute('href', '/spaces/room-1/members');
  });

  it('leaves a row held on the room alone, because ending it there would empty every tent in it', async () => {
    const rows = await drawnPeople();

    expect(within(rows[1]).getByRole('combobox', { name: 'What lea may do here' })).toBeInTheDocument();
    expect(within(rows[2]).queryByRole('combobox')).not.toBeInTheDocument();
    expect(within(rows[2]).queryByRole('button', { name: /Take jonas/ })).not.toBeInTheDocument();
    expect(within(rows[2]).getByText('can manage')).toBeInTheDocument();
  });

  it('makes a link that lives seven days and lets somebody in to log unless told otherwise, and shows the address afterwards', async () => {
    drawTab();
    fireEvent.click(await screen.findByRole('button', { name: 'Make a link' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Make the link' }));

    await waitFor(() => expect(server.wrote).toHaveLength(1));
    const body = server.wrote[0].body as { role: string; expiresAt: string };
    expect(body.role).toBe('can_log');
    expect(DateTime.fromISO(body.expiresAt).diff(NOW, 'days').days).toBeCloseTo(7, 1);

    await waitFor(() => expect(screen.getAllByText(/\/join\/K7QZ4M2P$/).length).toBeGreaterThan(0));
    expect(screen.getAllByRole('button', { name: 'Copy the invite link' }).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/joins as “can log” · until/).length).toBeGreaterThan(0);
  });

  it('adds by handle without the sigil people type out of habit, and empties the field', async () => {
    drawTab();
    const field = await screen.findByLabelText('A username you already grow with');

    fireEvent.change(field, { target: { value: ' @mara ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    await waitFor(() => expect(server.wrote).toHaveLength(1));
    expect(server.wrote[0]).toMatchObject({ method: 'POST', path: '/spaces/space-1/members', body: { handle: 'mara', role: 'can_log' } });
    await waitFor(() => expect(field).toHaveValue(''));
  });

  it('says what the server said when a handle is nobody it grows with', async () => {
    server.refuse = refusal('handle_not_found', 'Nobody you grow with goes by that name.', 404);
    drawTab();

    fireEvent.change(await screen.findByLabelText('A username you already grow with'), { target: { value: 'stranger' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    expect(await screen.findByText('Nobody you grow with goes by that name.')).toBeInTheDocument();
  });

  it('changes one role and names only the person it belongs to', async () => {
    const rows = await drawnPeople();

    fireEvent.change(within(rows[1]).getByRole('combobox', { name: 'What lea may do here' }), { target: { value: 'can_manage' } });

    await waitFor(() => expect(server.wrote).toHaveLength(1));
    expect(server.wrote[0]).toMatchObject({ method: 'PATCH', path: '/spaces/space-1/members/user-2', body: { role: 'can_manage' } });
  });

  it('asks before taking somebody out, and says that what they wrote stays', async () => {
    const rows = await drawnPeople();

    fireEvent.click(within(rows[1]).getByRole('button', { name: 'Take lea out of this tent' }));
    expect(screen.getByText(/goes on carrying their name/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Take them out' }));

    await waitFor(() => expect(server.wrote).toHaveLength(1));
    expect(server.wrote[0]).toMatchObject({ method: 'DELETE', path: '/spaces/space-1/members/user-2' });
  });

  it('closes with the note that says why there is no fourth role', async () => {
    await drawnPeople();

    expect(screen.getByText(/Read-only viewing is what share links do; there is no viewer role/)).toBeInTheDocument();
  });
});

describe('the Members tab as somebody who was let in', () => {
  beforeEach(() => {
    session.who = 'member';
    // What they may do here is the server's answer, and everything this screen
    // writes takes `own`: a guest sees the list and not one control on it.
    server.spaces = server.spaces.map(one => ({ ...one, youMay: 'log' as const }));
  });

  it('shows the same list and hands out no keys', async () => {
    const rows = await drawnPeople();

    expect(screen.getByText('@jonas')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Make a link' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('A username you already grow with')).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(within(rows[0]).getByText('The owner')).toBeInTheDocument();
  });

  it('names the owner, who is otherwise the one person on the list without a name', async () => {
    server.members = { ...MEMBERS, people: [...MEMBERS.people, { id: 'user-1', handle: 'chris' }] };
    const rows = await drawnPeople();

    expect(within(rows[0]).getByText('@chris')).toBeInTheDocument();
    expect(within(rows[0]).getByText('owner of Blue Dream tent')).toBeInTheDocument();
  });

  it('leaves the one control that lets them out, on their own row alone, named as leaving', async () => {
    const rows = await drawnPeople();

    expect(within(rows[1]).getByRole('button', { name: 'Leave this tent' })).toBeInTheDocument();
    expect(within(rows[2]).queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Take lea out/ })).not.toBeInTheDocument();

    fireEvent.click(within(rows[1]).getByRole('button', { name: 'Leave this tent' }));
    expect(screen.getByRole('button', { name: 'Leave the tent' })).toBeInTheDocument();
  });

  it('tells them, when they are also in the room, that leaving here keeps the tent', async () => {
    server.members = BOTH_WAYS('can_log', 'can_manage');
    drawTab();
    await screen.findByText('You');

    fireEvent.click(screen.getByRole('button', { name: 'Leave this tent' }));
    expect(screen.getByText(/You keep this tent through Grow room/)).toBeInTheDocument();
  });
});

describe('the Members tab on the demo', () => {
  it('says there is nobody to let in, and asks the server nothing', async () => {
    session.who = 'demo';
    drawTab();

    expect(await screen.findByText(/owns nothing, so there is nobody to let in/)).toBeInTheDocument();
    expect(vi.mocked(fetchStub).mock.calls.some(([url]) => String(url).includes('/members'))).toBe(false);
  });
});

describe('an invitation somebody was sent', () => {
  // Through the router rather than on its own: the code is the whole of the
  // request and it comes off the address.
  const drawJoin = () =>
    wrapped(
      <Routes>
        <Route path="/join/:code" element={<JoinRoute />} />
      </Routes>,
      '/join/K7QZ4M2P',
    );

  it('says only that the address leads nowhere, whichever of the four it was', async () => {
    server.preview = { isValid: false, spaceName: null, spaceKind: null, role: null, invitedByHandle: null, expiresAt: null };
    drawJoin();

    expect(await screen.findByText('This invitation leads nowhere')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Join/ })).not.toBeInTheDocument();
  });

  it('tells a stranger what they would and would not see, and carries the address to the sign-in', async () => {
    session.who = 'signedOut';
    drawJoin();

    expect(await screen.findByText('You are invited to Blue Dream tent')).toBeInTheDocument();
    expect(screen.getByText('from @chris')).toBeInTheDocument();
    expect(screen.getByText(/You do not see: their other tents/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sign in to join' })).toHaveAttribute('href', '/sign-in');
  });

  it('takes somebody who is signed in straight in', async () => {
    drawJoin();
    fireEvent.click(await screen.findByRole('button', { name: 'Join Blue Dream tent' }));

    await waitFor(() => expect(server.wrote).toHaveLength(1));
    expect(server.wrote[0]).toMatchObject({ method: 'POST', path: '/invites/K7QZ4M2P/acceptances' });
  });

  it('says what the server said when there is nothing to accept', async () => {
    server.refuse = refusal('owner_here', 'You own this space, which is more than any invite gives.');
    drawJoin();
    fireEvent.click(await screen.findByRole('button', { name: 'Join Blue Dream tent' }));

    expect(await screen.findByText('You own this space, which is more than any invite gives.')).toBeInTheDocument();
  });

  it('tells the demo it has no account to join with', async () => {
    session.who = 'demo';
    drawJoin();

    expect(await screen.findByText(/The demo has no account of its own/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Join/ })).not.toBeInTheDocument();
  });
});
