import { QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { DateTime } from 'luxon';
import type { ReactNode } from 'react';
import { createBrowserRouter, Link, Route, RouterProvider, Routes, useLocation } from 'react-router';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Invite, InvitePreview, MemberRole, Membership, MembershipPage, Problem, Space } from '@fg2/shared-types/v1';
import type { Told } from '@/log/log-context';
import { JoinRoute } from '@/screens/join/JoinRoute';
import { PlaceMembers } from '@/screens/place/PlaceMembers';
import { Members } from '@/screens/space/members/Members';
import { guestsOf, inSentence, mentionsOn, rowsFor } from '@/screens/space/members/people';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { drawAt, json, NOT_FOUND, testClient } from './harness';
import { translate } from './translations';

/**
 * Sharing a place, from both ends: the list of who sees it, and the
 * invitation a stranger opens.
 *
 * What is checked hardest: that the list is one list of people - the owner,
 * the place's guests and the room's members, somebody who holds a row on both
 * drawn once with the stronger role; that a row is written at the space it
 * stands on, since the server refuses a room's row changed through a place;
 * that every write is answered by a toast, a changed role with its way back;
 * and that handing out the way in belongs to the owner alone - a member sees
 * the same list and no control on it but the one that lets them out.
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

const told: Told[] = [];
vi.mock('@/log/log-context', async importOriginal => ({
  ...(await importOriginal<object>()),
  useLog: () => ({ tell: (one: Told) => told.push(one) }),
}));

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
  /** Whether the account keeps a diary, as `/me` answers it; null leaves `/me` unanswered, which is the app as it always was. */
  diary: null as boolean | null,
};

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
  if (method === 'GET' && path === '/me' && server.diary !== null) return json({ id: 'user-1', handle: 'chris', layers: { diary: server.diary } });
  if (method === 'GET' && path.startsWith('/spaces/space-1/members')) return json(server.members);
  const listed = /^\/spaces\/([^/]+)\/invites/.exec(path);
  if (method === 'GET' && listed) return json({ items: server.invites.filter(one => one.spaceId === listed[1]), nextCursor: null });
  if (method === 'POST' && listed) {
    server.invites = [invite({ id: `invite-into-${listed[1]}`, spaceId: listed[1] }), ...server.invites];
    return json(server.invites[0], 201);
  }
  // As the server does it: a row is written at the space it stands on, and the code somebody came in on is revoked with their row.
  const row = /^\/spaces\/([^/]+)\/members(?:\/([^/]+))?$/.exec(path);
  const held = row ? server.members.items.find(one => one.spaceId === row[1] && one.userId === row[2]) : undefined;
  if (method === 'POST' && row) return json(membership({ id: 'membership-3', spaceId: row[1], userId: 'user-9' }), 201);
  if (method === 'PATCH' && held) {
    const next = { ...held, role: (body as { role: MemberRole }).role };
    server.members = { ...server.members, items: server.members.items.map(one => (one === held ? next : one)) };
    return json(next);
  }
  if (method === 'DELETE' && held) {
    server.members = { ...server.members, items: server.members.items.filter(one => one !== held) };
    server.invites = server.invites.map(one => (one.id === held.inviteId ? { ...one, revokedAt: NOW.toISO()! } : one));
    return new Response(null, { status: 204 });
  }
  if (method === 'PUT' && path.endsWith('/revocation')) return json(invite({ revokedAt: NOW.toISO()! }));
  if (method === 'GET' && path.startsWith('/invites/')) return json(server.preview);
  if (method === 'POST' && path.endsWith('/acceptances')) return json({ membership: membership({}), space: space({ id: 'space-9' }) }, 201);

  return json(NOT_FOUND, 404);
}) as unknown as typeof fetch;

function Watch() {
  return <span data-testid="address">{useLocation().pathname}</span>;
}

const wrapped = (node: ReactNode, at = '/') => drawAt(<ThemeProvider>{node}</ThemeProvider>, { at });

/** The list as the place's pages draw it, at an address a leaver is taken away from. */
const drawTab = (roomId: string | null = 'room-1') =>
  wrapped(
    <>
      <Members spaceId="space-1" name="Blue Dream tent" roomId={roomId} />
      <Watch />
    </>,
    '/spaces/space-1/members',
  );

/** The rows of the one card: the owner, then everybody else who sees the place. */
const drawnPeople = async () => {
  drawTab();
  await screen.findByText('@jonas');
  return screen.getAllByRole('listitem');
};

/** The ways to invite stand behind the card's last row: opened, as the owner opens them. */
const inviting = async () => {
  drawTab();
  fireEvent.click(await screen.findByRole('button', { name: '+ Invite somebody' }));
};

const wrote = (index = 0) => server.wrote[index];

beforeAll(() => translate());

beforeEach(() => {
  vi.stubGlobal('fetch', fetchStub);
  session.who = 'owner';
  told.length = 0;
  server.spaces = [
    space({ roomId: 'room-1' }),
    space({ id: 'room-1', kind: 'room', name: 'Grow room' }),
    space({ id: 'space-2', roomId: 'room-1', name: 'Mother tent' }),
  ];
  server.members = MEMBERS;
  server.invites = [];
  server.refuse = null;
  server.wrote = [];
  server.diary = null;
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
  it('tells one sort of row from the other by the space each one names, the place´s own first', () => {
    expect(guestsOf(MEMBERS, 'space-1').map(guest => [guest.userId, guest.here?.spaceId, guest.viaRoom?.spaceId])).toEqual([
      ['user-2', 'space-1', undefined],
      ['user-3', undefined, 'room-1'],
    ]);
  });

  it('folds two rows of one person into one guest with the stronger role', () => {
    const guests = guestsOf(BOTH_WAYS('can_log', 'can_manage'), 'space-1');

    expect(guests).toHaveLength(1);
    expect(guests[0].role).toBe('can_manage');
    expect(guests[0].here?.spaceId).toBe('space-1');
    expect(guests[0].viaRoom?.spaceId).toBe('room-1');
  });

  it('writes a stronger role to the place´s own row, and a weaker one to every row that grants more', () => {
    const written = (page: MembershipPage, role: MemberRole, index = 0) => rowsFor(guestsOf(page, 'space-1')[index], role).map(row => row.spaceId);

    expect(written(BOTH_WAYS('can_log', 'can_log'), 'can_manage')).toEqual(['space-1']);
    expect(written(MEMBERS, 'can_manage', 0)).toEqual(['space-1']);
    expect(written(MEMBERS, 'can_log', 1)).toEqual(['room-1']);
    expect(written(BOTH_WAYS('can_log', 'can_manage'), 'can_log')).toEqual(['space-1']);
    expect(written(BOTH_WAYS('can_manage', 'can_log'), 'can_log')).toEqual(['room-1']);
    expect(written(BOTH_WAYS('can_manage', 'can_manage'), 'can_log')).toEqual(['space-1', 'room-1']);
  });

  it('names whoever holds a row on a space, and sets names in a sentence', () => {
    expect([...mentionsOn(MEMBERS, 'room-1')]).toEqual([['user-3', '@jonas']]);
    expect([...mentionsOn(undefined, 'room-1')]).toEqual([]);
    expect(inSentence(['@mara'], 'de')).toBe('@mara');
    expect(inSentence(['@mara', '@jonas'], 'de')).toBe('@mara und @jonas');
    expect(inSentence(['@mara', '@jonas', '@lea'], 'de')).toBe('@mara, @jonas und @lea');
  });
});

describe('who sees a place, as its owner', () => {
  it('is one list of everybody: the owner, the place´s guests, and the room´s members tagged as that', async () => {
    const rows = await drawnPeople();

    // On one line, however narrow the phone: the owner and what they do are facts side by side.
    expect(rows[0]).toHaveTextContent(/^You · manage this place$/);
    expect(within(rows[1]).getByText('@lea')).toBeInTheDocument();
    expect(rows[1]).not.toHaveTextContent('via the room Grow room');
    expect(within(rows[2]).getByText('@jonas')).toBeInTheDocument();
    expect(rows[2]).toHaveTextContent('via the room Grow room');
    // The last row invites; what each role may do is behind the help button, not a table on the page.
    expect(rows).toHaveLength(4);
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('says when each person last wrote here, and says so in words when they never have', async () => {
    const rows = await drawnPeople();

    expect(rows[1]).toHaveTextContent('last logged 1 d');
    expect(rows[2]).toHaveTextContent('via the room Grow room · nothing logged yet');
  });

  it('dates nobody´s last entry for an account that keeps no diary', async () => {
    server.diary = false;
    const rows = await drawnPeople();

    await waitFor(() => expect(screen.queryByText(/nothing logged yet|last logged/)).not.toBeInTheDocument());
    expect(rows[2]).toHaveTextContent('via the room Grow room');
  });

  it('draws somebody who is in the room and in the place once, with the stronger role', async () => {
    server.members = BOTH_WAYS('can_log', 'can_manage');
    drawTab();
    await screen.findByText('@lea');
    const rows = screen.getAllByRole('listitem');

    expect(screen.getAllByText('@lea')).toHaveLength(1);
    expect(rows[1]).toHaveTextContent('via the room Grow room');
    expect(within(rows[1]).getByRole('combobox', { name: 'What lea may do here' })).toHaveValue('can_manage');
  });

  it('draws a handle with nowhere to break whole, in its own row with its controls', async () => {
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
    expect(within(rows[1]).getByRole('button', { name: 'Blue Dream tent: take karlsruherkellergaertner out' })).toBeInTheDocument();
  });

  it('changes a role, says who may do what now and where, and takes it back with a word about what is back', async () => {
    const rows = await drawnPeople();

    fireEvent.change(within(rows[1]).getByRole('combobox', { name: 'What lea may do here' }), { target: { value: 'can_manage' } });

    await waitFor(() => expect(told).toHaveLength(1));
    expect(wrote()).toMatchObject({ method: 'PATCH', path: '/spaces/space-1/members/user-2', body: { role: 'can_manage' } });
    expect(told[0].label).toBe('@lea can now manage · Blue Dream tent');
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'What lea may do here' })).toHaveValue('can_manage'));

    await told[0].undo!();
    expect(wrote(1)).toMatchObject({ method: 'PATCH', path: '/spaces/space-1/members/user-2', body: { role: 'can_log' } });
    expect(told).toMatchObject([{ undone: '@lea can now log · Blue Dream tent' }]);
  });

  it('changes a room´s member from this list, at the room', async () => {
    const rows = await drawnPeople();

    fireEvent.change(within(rows[2]).getByRole('combobox', { name: 'What jonas may do here' }), { target: { value: 'can_log' } });

    await waitFor(() => expect(told).toHaveLength(1));
    expect(wrote()).toMatchObject({ method: 'PATCH', path: '/spaces/room-1/members/user-3', body: { role: 'can_log' } });
    expect(told[0].label).toBe('@jonas can now log · Grow room');
  });

  it('takes a role down on every row that grants it, and puts each back as it was', async () => {
    server.members = BOTH_WAYS('can_manage', 'can_manage');
    drawTab();

    const menu = await screen.findByRole('combobox', { name: 'What lea may do here' });
    expect(menu).toHaveValue('can_manage');
    fireEvent.change(menu, { target: { value: 'can_log' } });

    await waitFor(() => expect(told).toHaveLength(1));
    expect(server.wrote.map(one => one.path)).toEqual(['/spaces/space-1/members/user-2', '/spaces/room-1/members/user-2']);
    expect(told[0].label).toBe('@lea can now log · Blue Dream tent · Grow room');
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'What lea may do here' })).toHaveValue('can_log'));

    await told[0].undo!();
    expect(server.wrote.slice(2).map(one => one.body)).toEqual([{ role: 'can_manage' }, { role: 'can_manage' }]);
    expect(told).toMatchObject([{ undone: '@lea can now manage · Blue Dream tent · Grow room' }]);
  });

  it('says under the row what the server said when it refused a role', async () => {
    const rows = await drawnPeople();
    server.refuse = refusal('member_of_the_room', 'This membership is held on the room.');

    fireEvent.change(within(rows[1]).getByRole('combobox'), { target: { value: 'can_manage' } });

    expect(await within(rows[1]).findByText('This membership is held on the room.')).toBeInTheDocument();
    expect(told).toHaveLength(0);
  });

  it('asks before taking somebody out in one sentence, in the danger style, and answers without a way back', async () => {
    const rows = await drawnPeople();

    fireEvent.click(within(rows[1]).getByRole('button', { name: 'Blue Dream tent: take lea out' }));
    const sheet = screen.getByRole('dialog', { name: 'Blue Dream tent: take @lea out?' });
    expect(within(sheet).getByText('They lose this place; what they wrote here stays.')).toBeInTheDocument();
    // What follows from it stands behind the help, not in a paragraph over the button.
    expect(within(sheet).getByRole('button', { name: /Taking somebody out/ })).toBeInTheDocument();
    const yes = within(sheet).getByRole('button', { name: 'Take them out' });
    expect(yes.className).toMatch(/dangerFilled/);
    expect(yes.className).not.toMatch(/primary/);
    // The yes stands beside the way back, as every question's does (`Answer`).
    expect(yes.nextElementSibling).toHaveAccessibleName('Cancel');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(told).toHaveLength(0);

    fireEvent.click(within(rows[1]).getByRole('button', { name: 'Blue Dream tent: take lea out' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Take them out' }));

    await waitFor(() => expect(told).toHaveLength(1));
    expect(wrote()).toMatchObject({ method: 'DELETE', path: '/spaces/space-1/members/user-2' });
    expect(told[0]).toMatchObject({ label: '@lea no longer sees Blue Dream tent', undo: null });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('@lea')).not.toBeInTheDocument());
    expect(screen.getByTestId('address')).toHaveTextContent('/spaces/space-1/members');
  });

  it('takes a room´s member out of the room from this list, and says that every place in it goes', async () => {
    const rows = await drawnPeople();

    fireEvent.click(within(rows[2]).getByRole('button', { name: 'Grow room: take jonas out' }));
    const sheet = screen.getByRole('dialog', { name: 'Grow room: take @jonas out?' });
    expect(within(sheet).getByText(/They lose every place of this room/)).toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Take them out' }));

    await waitFor(() => expect(told).toHaveLength(1));
    expect(wrote()).toMatchObject({ method: 'DELETE', path: '/spaces/room-1/members/user-3' });
    expect(told[0].label).toBe('@jonas no longer sees Grow room');
  });

  it('ends the place´s own row of somebody who is also in the room, and says they keep the place through it', async () => {
    server.members = BOTH_WAYS('can_log', 'can_manage');
    drawTab();

    fireEvent.click(await screen.findByRole('button', { name: 'Blue Dream tent: take lea out' }));
    expect(screen.getByText(/keep this place through the room Grow room/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Take them out' }));

    await waitFor(() => expect(told).toHaveLength(1));
    expect(wrote()).toMatchObject({ method: 'DELETE', path: '/spaces/space-1/members/user-2' });
    expect(told[0].label).toBe('@lea still sees Blue Dream tent through the room Grow room');
  });

  /**
   * The removal takes the key with it, which is right and is the part nobody
   * expects: one link may have been sent to a whole club, and the host who cut
   * it spends it on the first person they take out. So it is said before the
   * tap, named by the code so it can be told from the other keys out, and said
   * again in the answer.
   */
  it('says which link taking somebody out will stop, and reports it once it has', async () => {
    server.invites = [invite()];
    const rows = await drawnPeople();

    fireEvent.click(within(rows[1]).getByRole('button', { name: 'Blue Dream tent: take lea out' }));
    const sheet = screen.getByRole('dialog');
    expect(await within(sheet).findByText(/The link K7QZ4M2P they came in on stops working/)).toBeInTheDocument();

    fireEvent.click(within(sheet).getByRole('button', { name: 'Take them out' }));

    await waitFor(() => expect(told).toHaveLength(1));
    expect(told[0].label).toBe('@lea no longer sees Blue Dream tent · The link K7QZ4M2P no longer works');
    expect(server.wrote).toHaveLength(1);
  });

  it('promises nothing about a code that had already been revoked, because that removal stops nothing further', async () => {
    server.invites = [invite({ revokedAt: NOW.minus({ days: 1 }).toISO()! })];
    const rows = await drawnPeople();

    fireEvent.click(within(rows[1]).getByRole('button', { name: 'Blue Dream tent: take lea out' }));

    expect(screen.getByText(/what they wrote here stays/)).toBeInTheDocument();
    expect(within(screen.getByRole('dialog')).queryByText(/K7QZ4M2P/)).not.toBeInTheDocument();
  });

  it('says nothing about a link for somebody who was added by hand', async () => {
    server.invites = [invite()];
    server.members = { ...MEMBERS, items: [membership({ inviteId: null }), MEMBERS.items[1]] };
    const rows = await drawnPeople();

    fireEvent.click(within(rows[1]).getByRole('button', { name: 'Blue Dream tent: take lea out' }));

    // The page behind the sheet still lists that live link; the sheet says nothing of it.
    expect(within(screen.getByRole('dialog')).queryByText(/K7QZ4M2P/)).not.toBeInTheDocument();
  });

  it('ends the card with the row that invites, and shows the ways to invite only once it is opened', async () => {
    const rows = await drawnPeople();
    const row = within(rows[rows.length - 1]).getByRole('button', { name: '+ Invite somebody' });

    expect(row).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByLabelText('A username you already grow with')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Make a link' })).not.toBeInTheDocument();

    fireEvent.click(row);
    expect(row).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByLabelText('A username you already grow with')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Create a share link ›' })).toBeInTheDocument();
  });

  it('shows a link that is out without anything being opened, the place´s and the room´s each named', async () => {
    server.invites = [invite(), invite({ id: 'invite-2', code: 'R00MC0DE', spaceId: 'room-1', role: 'can_manage' })];
    drawTab();

    const ofPlace = await screen.findByRole('listitem', { name: 'K7QZ4M2P' });
    expect(ofPlace).toHaveTextContent(/\/join\/K7QZ4M2P/);
    expect(ofPlace).toHaveTextContent('Blue Dream tent · joins as “can log”');
    expect(await screen.findByRole('listitem', { name: 'R00MC0DE' })).toHaveTextContent('Grow room · joins as “can manage”');
    expect(screen.getByRole('button', { name: '+ Invite somebody' })).toHaveAttribute('aria-expanded', 'false');
  });

  it('lets the next invitation be for the room, and changes nothing else by that choice', async () => {
    server.invites = [invite()];
    await inviting();
    await screen.findByRole('listitem', { name: 'K7QZ4M2P' });
    fireEvent.change(screen.getByLabelText('A username you already grow with'), { target: { value: 'mara' } });
    const before = screen.getAllByRole('listitem').map(row => row.textContent);

    fireEvent.change(screen.getByRole('combobox', { name: 'An invitation is for' }), { target: { value: 'room' } });

    expect(screen.getAllByRole('listitem').map(row => row.textContent)).toEqual(before);
    expect(screen.getByRole('button', { name: '+ Invite somebody' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByLabelText('A username you already grow with')).toHaveValue('mara');

    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(server.wrote).toHaveLength(1));
    expect(wrote()).toMatchObject({ method: 'POST', path: '/spaces/room-1/members', body: { handle: 'mara', role: 'can_log' } });

    fireEvent.click(screen.getByRole('button', { name: 'Make a link' }));
    const sheet = screen.getByRole('dialog', { name: 'Invite' });
    expect(within(sheet).getByRole('heading', { level: 2 })).toHaveTextContent('Grow room');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Make the link' }));
    await waitFor(() => expect(server.wrote).toHaveLength(2));
    expect(wrote(1)).toMatchObject({ method: 'POST', path: '/spaces/room-1/invites' });
  });

  it('asks nothing about a room where the place stands in none', async () => {
    server.members = { ...MEMBERS, items: [MEMBERS.items[0]], room: null };
    drawTab(null);
    fireEvent.click(await screen.findByRole('button', { name: '+ Invite somebody' }));

    expect(screen.queryByRole('combobox', { name: 'An invitation is for' })).not.toBeInTheDocument();
  });

  it('makes a link that lives seven days and lets somebody in to log unless told otherwise, and shows the address afterwards', async () => {
    await inviting();
    fireEvent.click(await screen.findByRole('button', { name: 'Make a link' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Make the link' }));

    await waitFor(() => expect(server.wrote).toHaveLength(1));
    expect(wrote().path).toBe('/spaces/space-1/invites');
    const body = wrote().body as { role: string; expiresAt: string };
    expect(body.role).toBe('can_log');
    expect(DateTime.fromISO(body.expiresAt).diff(NOW, 'days').days).toBeCloseTo(7, 1);

    await waitFor(() => expect(screen.getAllByText(/\/join\/K7QZ4M2P$/).length).toBeGreaterThan(0));
    // It may break after a slash and nowhere else: "K7QZ4M / 2P" is a code nobody can read out.
    for (const address of screen.getAllByText(/\/join\/K7QZ4M2P$/)) {
      expect([...address.querySelectorAll('wbr')].map(one => one.previousSibling?.textContent)).toEqual(['/', '/']);
    }
    expect(screen.getAllByRole('button', { name: 'Copy the invite link' }).length).toBeGreaterThan(0);
    expect(screen.getByRole('dialog')).toHaveTextContent(/joins as “can log” · until/);
  });

  it('adds by handle without the sigil people type out of habit, and empties the field', async () => {
    await inviting();
    const field = await screen.findByLabelText('A username you already grow with');

    fireEvent.change(field, { target: { value: ' @mara ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    await waitFor(() => expect(server.wrote).toHaveLength(1));
    expect(wrote()).toMatchObject({ method: 'POST', path: '/spaces/space-1/members', body: { handle: 'mara', role: 'can_log' } });
    await waitFor(() => expect(field).toHaveValue(''));
  });

  it('says what the server said when a handle is nobody it grows with', async () => {
    server.refuse = refusal('handle_not_found', 'Nobody you grow with goes by that name.', 404);
    await inviting();

    fireEvent.change(await screen.findByLabelText('A username you already grow with'), { target: { value: 'stranger' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    expect(await screen.findByText('Nobody you grow with goes by that name.')).toBeInTheDocument();
  });
});

describe('who sees a place, as somebody who was let in', () => {
  beforeEach(() => {
    session.who = 'member';
    // What they may do here is the server's answer, and everything this screen
    // writes takes `own`: a guest sees the list and not one control on it.
    server.spaces = server.spaces.map(one => ({ ...one, youMay: 'log' as const }));
  });

  it('shows the same list and hands out no keys', async () => {
    server.invites = [invite()];
    const rows = await drawnPeople();

    expect(rows).toHaveLength(3);
    expect(screen.getByText('@jonas')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '+ Invite somebody' })).not.toBeInTheDocument();
    expect(screen.queryByText(/K7QZ4M2P/)).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(within(rows[1]).getByText('can log')).toBeInTheDocument();
    expect(rows[0]).toHaveTextContent(/^The owner · manages this place$/);
  });

  it('names the owner, who is otherwise the one person on the list without a name', async () => {
    server.members = { ...MEMBERS, people: [...MEMBERS.people, { id: 'user-1', handle: 'chris' }] };
    const rows = await drawnPeople();

    expect(rows[0]).toHaveTextContent(/^@chris · manages this place$/);
  });

  it('lets them out by the one control on their own row, takes them to Start and says what they left', async () => {
    const rows = await drawnPeople();

    expect(within(rows[2]).queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Take lea out/ })).not.toBeInTheDocument();
    fireEvent.click(within(rows[1]).getByRole('button', { name: 'Leave Blue Dream tent' }));

    const sheet = screen.getByRole('dialog', { name: 'Leave Blue Dream tent?' });
    expect(within(sheet).getByText(/Blue Dream tent disappears from Home/)).toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Leave' }));

    await waitFor(() => expect(screen.getByTestId('address')).toHaveTextContent(/^\/$/));
    expect(wrote()).toMatchObject({ method: 'DELETE', path: '/spaces/space-1/members/user-2' });
    expect(told).toEqual([expect.objectContaining({ label: 'You have left Blue Dream tent', undo: null })]);
  });

  /**
   * Walking out of your own accord takes no key with it - the key is the
   * host's, and a guest who could kill it by leaving would be revoking on
   * their behalf - so the sheet that says so must not claim otherwise.
   */
  it('promises nothing about the link to somebody leaving of their own accord', async () => {
    server.invites = [invite()];
    const rows = await drawnPeople();

    fireEvent.click(within(rows[1]).getByRole('button', { name: 'Leave Blue Dream tent' }));

    expect(screen.getByText(/goes on carrying your name/)).toBeInTheDocument();
    expect(screen.queryByText(/K7QZ4M2P/)).not.toBeInTheDocument();
  });

  it('tells them, when they are also in the room, that leaving here keeps the place - and leaves them on the page', async () => {
    server.members = BOTH_WAYS('can_log', 'can_manage');
    drawTab();
    await screen.findByText('You');

    fireEvent.click(screen.getByRole('button', { name: 'Leave Blue Dream tent' }));
    expect(screen.getByText(/You keep this place through the room Grow room/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Leave' }));

    await waitFor(() => expect(told).toHaveLength(1));
    expect(told[0].label).toBe('You still see Blue Dream tent through the room Grow room');
    expect(screen.getByTestId('address')).toHaveTextContent('/spaces/space-1/members');
  });

  it('lets somebody who is here through the room leave the room, and says that every place in it goes', async () => {
    server.members = { ...MEMBERS, items: [membership({ id: 'membership-2', spaceId: 'room-1', inviteId: null })] };
    drawTab();
    await screen.findByText('You');

    fireEvent.click(screen.getByRole('button', { name: 'Leave Grow room' }));
    expect(
      within(screen.getByRole('dialog', { name: 'Leave Grow room?' })).getByText(/Every place of this room disappears from Home/),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Leave' }));

    await waitFor(() => expect(screen.getByTestId('address')).toHaveTextContent(/^\/$/));
    expect(wrote()).toMatchObject({ method: 'DELETE', path: '/spaces/room-1/members/user-2' });
    expect(told[0].label).toBe('You have left Grow room');
  });
});

describe('the page of who sees a place', () => {
  const drawPage = (id: string) =>
    wrapped(
      <Routes>
        <Route path="/spaces/:spaceId/members" element={<PlaceMembers />} />
        <Route path="/spaces/:spaceId/edit" element={<p>the edit page</p>} />
      </Routes>,
      `/spaces/${id}/members`,
    );

  beforeEach(() => {
    session.who = 'member';
    server.spaces = [
      ...server.spaces.map(one => ({ ...one, youMay: 'log' as const })),
      space({ id: 'ended', youMay: 'log', archivedAt: NOW.toISO()! }),
    ];
  });

  it('shows a member the list under the place´s name, with what the roles mean behind the help button', async () => {
    drawPage('space-1');

    expect(await screen.findByRole('heading', { level: 1, name: 'Who sees Blue Dream tent' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'About Roles' })).toBeInTheDocument();
    expect(await screen.findByText('@jonas')).toBeInTheDocument();
  });

  /**
   * On the window's own history, where an open sheet stands on an entry over its page's (`ui/sheet-back.ts`) and a
   * memory router keeps none: a replace from the sheet took the sheet's entry and left the page's under Start.
   */
  it('leaves no entry of the page a guest left from: Back from Start leads to where they came from', async () => {
    window.history.replaceState(null, '', '/came-from');
    const router = createBrowserRouter([
      { path: '/came-from', element: <Link to="/spaces/space-1/members">Who sees it</Link> },
      { path: '/spaces/:spaceId/members', element: <PlaceMembers /> },
      { path: '/', element: <p>Start</p> },
    ]);
    render(
      <QueryClientProvider client={testClient()}>
        <ThemeProvider>
          <RouterProvider router={router} />
        </ThemeProvider>
      </QueryClientProvider>,
    );
    try {
      fireEvent.click(screen.getByRole('link', { name: 'Who sees it' }));
      fireEvent.click(await screen.findByRole('button', { name: 'Leave Blue Dream tent' }));
      fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Leave' }));

      expect(await screen.findByText('Start')).toBeInTheDocument();
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(told).toEqual([expect.objectContaining({ label: 'You have left Blue Dream tent' })]);

      await act(async () => {
        window.history.back();
        await new Promise(resolve => window.addEventListener('popstate', resolve, { once: true }));
      });
      expect(await screen.findByRole('link', { name: 'Who sees it' })).toBeInTheDocument();
      expect(window.location.pathname).toBe('/came-from');
    } finally {
      router.dispose();
    }
  });

  it('sends whoever manages the place to the page that edits it', async () => {
    server.spaces = server.spaces.map(one => ({ ...one, youMay: 'manage' as const }));
    drawPage('space-1');

    expect(await screen.findByText('the edit page')).toBeInTheDocument();
  });

  it.each(['nowhere', 'ended', 'room-1'])('is one page for what is not there - an unknown id, a place that has ended, a room (%s)', async id => {
    drawPage(id);

    expect(await screen.findByRole('heading', { level: 1, name: 'Place' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/');
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
  });

  it('offers to read again where the places could not be read', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    drawPage('space-1');

    expect(await screen.findByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1, name: 'Place' })).not.toBeInTheDocument();
  });
});

describe('who sees a place, on the demo', () => {
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
        {/* The place the server answered the acceptance with. */}
        <Route path="/spaces/space-9" element={<p>Inside the place joined</p>} />
      </Routes>,
      '/join/K7QZ4M2P',
    );

  it('says only that the address leads nowhere, whichever of the four it was', async () => {
    server.preview = { isValid: false, spaceName: null, spaceKind: null, role: null, invitedByHandle: null, expiresAt: null };
    drawJoin();

    expect(await screen.findByText('This invitation leads nowhere')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Join/ })).not.toBeInTheDocument();
    // The window says it too: outside the app's shell nothing else names it.
    expect(document.title).toBe('This invitation leads nowhere · Terp Control');
  });

  it('tells a stranger what they would and would not see, and carries the address to the sign-in', async () => {
    session.who = 'signedOut';
    drawJoin();

    expect(await screen.findByText('Blue Dream tent: you are invited')).toBeInTheDocument();
    expect(document.title).toBe('Blue Dream tent: you are invited · Terp Control');
    expect(screen.getByText('from @chris')).toBeInTheDocument();
    expect(screen.getByText(/You do not see: their other places/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sign in to join' })).toHaveAttribute('href', '/sign-in');
  });

  it('names the window of the page a code is typed on', async () => {
    wrapped(
      <Routes>
        <Route path="/join" element={<JoinRoute />} />
      </Routes>,
      '/join',
    );

    expect(await screen.findByRole('heading', { level: 1, name: 'Have an invitation code?' })).toBeInTheDocument();
    expect(document.title).toBe('Have an invitation code? · Terp Control');
  });

  it('takes somebody who is signed in straight in', async () => {
    drawJoin();
    fireEvent.click(await screen.findByRole('button', { name: 'Join Blue Dream tent' }));

    await waitFor(() => expect(server.wrote).toHaveLength(1));
    expect(server.wrote[0]).toMatchObject({ method: 'POST', path: '/invites/K7QZ4M2P/acceptances' });
    expect(await screen.findByText('Inside the place joined')).toBeInTheDocument();
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
