import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import i18next from 'i18next';
import { DateTime } from 'luxon';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { initReactI18next } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Invite, InviteCreate, MembershipPage, Space, SpaceCreate, SpaceKind, SpaceUpdate } from '@fg2/shared-types/v1';
import { Members } from '@/screens/space/members/Members';
import { expiresAtFor, liveInvites } from '@/screens/space/members/invites';
import { ThemeProvider } from '@/theme/ThemeProvider';

/**
 * The invitation an owner makes, and the room half of the sharing model.
 *
 * What is checked hardest: that every code still out is listed and each can be
 * stopped on its own, because a card that showed the newest and stopped only
 * that one would tell a host a key was dead while another stayed live; that
 * the sheet sends exactly the role and the life chosen and then describes the
 * link from the server's answer rather than from what it asked for; and that
 * a tent can be put into a room at all, which nothing in the app could do.
 *
 * The fetch is stubbed by route rather than the hooks being mocked, so what is
 * asserted about a write is the body that went on the wire.
 */

vi.mock('@/api/session', async importOriginal => {
  const { SIGNED_IN } = await import('./session');

  return { ...(await importOriginal<object>()), useSession: () => SIGNED_IN };
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

const invite = (over: Partial<Invite>): Invite => ({
  id: 'invite-1',
  code: 'K7QZ4M2P',
  spaceId: 'space-1',
  role: 'can_log',
  createdBy: 'user-1',
  expiresAt: NOW.plus({ days: 5 }).toISO()!,
  revokedAt: null,
  state: { useCount: 0, lastUsedAt: null },
  createdAt: NOW.minus({ hours: 1 }).toISO()!,
  ...over,
});

const NOBODY_ELSE: MembershipPage = { items: [], nextCursor: null, people: [], room: null, activity: [] };

/** What the server holds, and what it says to a write. Every body that arrives is kept so a test can read it. */
const server = {
  spaces: [] as Space[],
  invites: [] as Invite[],
  made: 0,
  wrote: [] as { method: string; path: string; body: unknown }[],
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const NOT_FOUND = { status: 404, code: 'not_found', title: 'Not found', detail: '', errors: [] };

const fetchStub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const path = String(input).replace(/^.*\/v1/, '');
  const method = init?.method ?? 'GET';
  const body = init?.body ? (JSON.parse(String(init.body)) as unknown) : undefined;

  if (method !== 'GET') server.wrote.push({ method, path, body });

  if (method === 'GET' && path.startsWith('/spaces?')) return json({ items: server.spaces, nextCursor: null });
  if (method === 'GET' && path === '/spaces') return json({ items: server.spaces, nextCursor: null });
  if (method === 'GET' && /^\/spaces\/[^/]+\/members/.test(path)) return json(NOBODY_ELSE);
  if (method === 'GET' && path.startsWith('/spaces/space-1/overview')) return json({ grows: [{ growId: 'grow-1', name: 'Spring run' }] });
  if (method === 'GET' && path.startsWith('/spaces/space-1/invites')) return json({ items: server.invites, nextCursor: null });

  if (method === 'POST' && path === '/spaces/space-1/invites') {
    const asked = body as InviteCreate;
    server.made += 1;
    // The server's answer is what the sheet then describes, so it is deliberately
    // not what was asked: a code of its own, and the role and end it wrote.
    const made = invite({ id: `invite-made-${server.made}`, code: 'NEWCADE2', role: asked.role, expiresAt: asked.expiresAt ?? null });
    server.invites = [made, ...server.invites];
    return json(made, 201);
  }
  const revocation = path.match(/^\/invites\/([^/]+)\/revocation$/);
  if (method === 'PUT' && revocation) {
    server.invites = server.invites.map(row => (row.code === revocation[1] ? { ...row, revokedAt: NOW.toISO()! } : row));
    return json(server.invites.find(row => row.code === revocation[1]));
  }

  if (method === 'POST' && path === '/spaces') {
    const asked = body as SpaceCreate;
    const room = space({ id: 'room-9', kind: asked.kind, name: asked.name, createdAt: NOW.toISO()! });
    server.spaces = [...server.spaces, room];
    return json(room, 201);
  }
  if (method === 'PATCH' && path === '/spaces/space-1') {
    const asked = body as SpaceUpdate;
    server.spaces = server.spaces.map(row => (row.id === 'space-1' ? { ...row, ...asked } : row));
    return json(server.spaces.find(row => row.id === 'space-1'));
  }

  return json(NOT_FOUND, 404);
}) as unknown as typeof fetch;

const wrapped = (node: React.ReactNode) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
      <MemoryRouter>
        <ThemeProvider>{node}</ThemeProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );

const drawTab = (roomId: string | null = null, kind: SpaceKind = 'tent', spaceId = 'space-1', name = 'Blue Dream tent') =>
  wrapped(<Members spaceId={spaceId} name={name} kind={kind} roomId={roomId} />);

/** The rows of live links, each known by its code. */
const linkRows = () => screen.getAllByRole('listitem').filter(row => /^[A-Z0-9]{8}$/.test(row.getAttribute('aria-label') ?? ''));

beforeAll(async () => {
  const translation = JSON.parse(await readFile(resolve(process.cwd(), 'public/assets/i18n/en.json'), 'utf8')) as Record<string, unknown>;
  await i18next
    .use(initReactI18next)
    .init({ lng: 'en', resources: { en: { translation } }, nsSeparator: false, interpolation: { escapeValue: false } });
});

beforeEach(() => {
  vi.stubGlobal('fetch', fetchStub);
  server.spaces = [space({})];
  server.invites = [];
  server.made = 0;
  server.wrote = [];
});

afterEach(() => vi.unstubAllGlobals());

describe('the arithmetic of a link', () => {
  it('turns the three lives the board offers into the instant the contract carries, and null for never', () => {
    expect(expiresAtFor('never', NOW)).toBeNull();
    expect(DateTime.fromISO(expiresAtFor('day', NOW)!).diff(NOW, 'hours').hours).toBeCloseTo(24, 3);
    expect(DateTime.fromISO(expiresAtFor('week', NOW)!).diff(NOW, 'days').days).toBeCloseTo(7, 3);
  });

  it('counts a link as live until the instant the server gave it, and never once it is revoked', () => {
    const rows = [
      invite({ id: 'a', code: 'AAAAAAAA' }),
      invite({ id: 'b', code: 'BBBBBBBB', expiresAt: null }),
      invite({ id: 'c', code: 'CCCCCCCC', revokedAt: NOW.minus({ hours: 1 }).toISO()! }),
      invite({ id: 'd', code: 'DDDDDDDD', expiresAt: NOW.minus({ minutes: 1 }).toISO()! }),
    ];

    expect(liveInvites(rows, NOW).map(row => row.code)).toEqual(['AAAAAAAA', 'BBBBBBBB']);
  });
});

describe('the links a tent has out', () => {
  beforeEach(() => {
    server.invites = [
      invite({ id: 'a', code: 'AAAAAAAA', state: { useCount: 2, lastUsedAt: NOW.minus({ hours: 2 }).toISO()! } }),
      invite({ id: 'b', code: 'BBBBBBBB', role: 'can_manage', expiresAt: null }),
      invite({ id: 'c', code: 'CCCCCCCC', revokedAt: NOW.minus({ hours: 1 }).toISO()! }),
      invite({ id: 'd', code: 'DDDDDDDD', expiresAt: NOW.minus({ minutes: 1 }).toISO()! }),
    ];
  });

  it('lists every link still live with what it grants, read off the row, and none of the ones that have stopped', async () => {
    drawTab();
    await screen.findByRole('button', { name: 'Revoke the link AAAAAAAA' });

    const rows = linkRows();
    expect(rows.map(row => row.getAttribute('aria-label'))).toEqual(['AAAAAAAA', 'BBBBBBBB']);
    expect(within(rows[0]).getByText(/\/join\/AAAAAAAA$/)).toBeInTheDocument();
    expect(within(rows[0]).getByText(/joins as “can log” · until .* · used 2× · revoke any time/)).toBeInTheDocument();
    expect(within(rows[1]).getByText(/joins as “can manage” · never expires · used 0× · revoke any time/)).toBeInTheDocument();
    expect(screen.queryByText(/CCCCCCCC/)).not.toBeInTheDocument();
    expect(screen.queryByText(/DDDDDDDD/)).not.toBeInTheDocument();
  });

  it('revokes one link on its own and leaves the other out', async () => {
    drawTab();
    fireEvent.click(await screen.findByRole('button', { name: 'Revoke the link BBBBBBBB' }));

    await waitFor(() => expect(server.wrote).toHaveLength(1));
    expect(server.wrote[0]).toMatchObject({ method: 'PUT', path: '/invites/BBBBBBBB/revocation' });
    await waitFor(() => expect(screen.queryByText(/BBBBBBBB/)).not.toBeInTheDocument());
    expect(screen.getByText(/\/join\/AAAAAAAA$/)).toBeInTheDocument();
  });

  it('opens a link that is already out as a code and a QR without cutting another', async () => {
    drawTab();
    fireEvent.click(await screen.findByRole('button', { name: 'Show AAAAAAAA as a code and a QR' }));

    const sheet = screen.getByRole('dialog', { name: 'Invite to Blue Dream tent' });
    fireEvent.click(within(sheet).getByRole('tab', { name: 'Code' }));
    expect(within(sheet).getByText('AAAAAAAA')).toBeInTheDocument();
    expect(within(sheet).getByText(/They type it at .*\/join$/)).toBeInTheDocument();

    fireEvent.click(within(sheet).getByRole('tab', { name: 'QR' }));
    expect(await within(sheet).findByRole('img', { name: /QR code for .*\/join\/AAAAAAAA/ })).toBeInTheDocument();
    expect(server.wrote).toHaveLength(0);
  });
});

describe('the invitation sheet', () => {
  it('sends exactly the role and the validity chosen, then describes the link from the answer', async () => {
    drawTab();
    fireEvent.click(await screen.findByRole('button', { name: 'Make a link' }));

    const sheet = screen.getByRole('dialog', { name: 'Invite to Blue Dream tent' });
    // The grows standing here come from the tent's overview, which the sheet reads when it is there.
    expect(await within(sheet).findByText(/They see: Blue Dream tent, Spring run, the cams\./)).toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole('radio', { name: /can manage/ }));
    fireEvent.click(within(sheet).getByRole('button', { name: '24 h' }));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Make the link' }));

    await waitFor(() => expect(server.wrote).toHaveLength(1));
    expect(server.wrote[0]).toMatchObject({ method: 'POST', path: '/spaces/space-1/invites', body: { role: 'can_manage' } });
    const body = server.wrote[0].body as InviteCreate;
    expect(DateTime.fromISO(body.expiresAt!).diff(NOW, 'hours').hours).toBeCloseTo(24, 1);

    expect(await within(sheet).findByText(/\/join\/NEWCADE2$/)).toBeInTheDocument();
    expect(within(sheet).getByText(/joins as “can manage” · until .* · used 0× · revoke any time/)).toBeInTheDocument();
  });

  it('makes a link that never expires when told to, and says so in those words', async () => {
    drawTab();
    fireEvent.click(await screen.findByRole('button', { name: 'Make a link' }));

    const sheet = screen.getByRole('dialog', { name: 'Invite to Blue Dream tent' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'until revoked' }));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Make the link' }));

    await waitFor(() => expect(server.wrote).toHaveLength(1));
    expect(server.wrote[0].body).toEqual({ role: 'can_log', expiresAt: null });
    expect(await within(sheet).findByText(/joins as “can log” · never expires · used 0×/)).toBeInTheDocument();

    // The list under the sheet reads the same row and says the same thing.
    fireEvent.click(within(sheet).getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(linkRows()).toHaveLength(1));
    expect(within(linkRows()[0]).getByText(/never expires/)).toBeInTheDocument();
  });
});

describe('the room a tent stands in', () => {
  it('makes a room and puts the tent in it', async () => {
    drawTab();
    fireEvent.click(await screen.findByRole('button', { name: 'Put it in a room' }));

    const sheet = screen.getByRole('dialog', { name: 'A room for Blue Dream tent' });
    expect(within(sheet).getByText('You have no room yet.')).toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole('button', { name: '+ New room' }));
    fireEvent.change(within(sheet).getByLabelText('Name of the room'), { target: { value: ' Grow room ' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Make the room' }));

    await waitFor(() => expect(server.wrote).toHaveLength(1));
    expect(server.wrote[0]).toMatchObject({ method: 'POST', path: '/spaces', body: { kind: 'room', name: 'Grow room' } });

    const put = await within(sheet).findByRole('button', { name: 'Put Blue Dream tent in Grow room' });
    await waitFor(() => expect(put).toBeEnabled());
    fireEvent.click(put);

    await waitFor(() => expect(server.wrote).toHaveLength(2));
    expect(server.wrote[1]).toMatchObject({ method: 'PATCH', path: '/spaces/space-1', body: { roomId: 'room-9' } });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('offers the rooms the account already has, and takes the tent out of the one it is in', async () => {
    server.spaces = [
      space({ roomId: 'room-1' }),
      space({ id: 'room-1', kind: 'room', name: 'Grow room' }),
      space({ id: 'room-2', kind: 'room', name: 'Drying room' }),
      space({ id: 'room-3', kind: 'room', name: "Mia's room", ownerId: 'user-mia', youMay: 'manage' }),
    ];
    drawTab('room-1');

    expect(await screen.findByText('In Grow room')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Change' }));

    const sheet = screen.getByRole('dialog', { name: 'A room for Blue Dream tent' });
    expect(within(sheet).getByRole('button', { name: 'Drying room' })).toBeInTheDocument();
    expect(within(sheet).queryByRole('button', { name: "Mia's room" })).not.toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Take it out of Grow room' }));

    await waitFor(() => expect(server.wrote).toHaveLength(1));
    expect(server.wrote[0]).toMatchObject({ method: 'PATCH', path: '/spaces/space-1', body: { roomId: null } });
  });

  it('describes itself as a room on the room’s own page and names the tents grouped under it', async () => {
    server.spaces = [
      space({ roomId: 'room-1' }),
      space({ id: 'room-1', kind: 'room', name: 'Grow room' }),
      space({ id: 'space-2', roomId: 'room-1', name: 'Mother tent' }),
    ];
    drawTab(null, 'room', 'room-1', 'Grow room');

    expect(await screen.findByText(/Share the whole room/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Blue Dream tent' })).toHaveAttribute('href', '/spaces/space-1/members');
    expect(screen.getByRole('link', { name: 'Mother tent' })).toBeInTheDocument();
    expect(screen.getByText('See every space in the room, its grows and cams')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Put it in a room' })).not.toBeInTheDocument();
  });
});
