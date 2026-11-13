import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { DateTime } from 'luxon';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Invite, InviteCreate, MembershipPage, Space } from '@fg2/shared-types/v1';
import type { Told } from '@/log/log-context';
import { Members } from '@/screens/space/members/Members';
import { expiresAtFor, liveInvites } from '@/screens/space/members/invites';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { drawAt, json, NOT_FOUND } from './harness';
import { Toast } from './toast';
import { translate } from './translations';

/**
 * The invitation an owner makes.
 *
 * What is checked hardest: that every code still out is listed and each can be
 * stopped on its own - asked first, since a revoked code stays revoked, and
 * answered by a toast -, because a card that showed the newest and stopped only
 * that one would tell a host a key was dead while another stayed live; and
 * that the sheet sends exactly the role and the life chosen and then describes
 * the link from the server's answer rather than from what it asked for.
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

const fetchStub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const path = String(input).replace(/^.*\/v1/, '');
  const method = init?.method ?? 'GET';
  const body = init?.body ? (JSON.parse(String(init.body)) as unknown) : undefined;

  if (method !== 'GET') server.wrote.push({ method, path, body });

  if (method === 'GET' && path.startsWith('/spaces?')) return json({ items: server.spaces, nextCursor: null });
  if (method === 'GET' && path === '/spaces') return json({ items: server.spaces, nextCursor: null });
  if (method === 'GET' && /^\/spaces\/[^/]+\/members/.test(path)) return json(NOBODY_ELSE);
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
  if (method === 'PUT' && revocation && server.invites.some(row => row.code === revocation[1])) {
    server.invites = server.invites.map(row => (row.code === revocation[1] ? { ...row, revokedAt: NOW.toISO()! } : row));
    return json(server.invites.find(row => row.code === revocation[1]));
  }

  return json(NOT_FOUND, 404);
}) as unknown as typeof fetch;

const told: Told[] = [];

const wrapped = (node: React.ReactNode) =>
  drawAt(
    <ThemeProvider>
      <Toast told={told}>{node}</Toast>
    </ThemeProvider>,
  );

const drawTab = () => wrapped(<Members spaceId="space-1" name="Blue Dream tent" roomId={null} />);

/** The ways to invite stand behind the row that invites: opened, as the owner opens them. */
const inviting = async () => {
  drawTab();
  fireEvent.click(await screen.findByRole('button', { name: '+ Invite somebody' }));
};

/** The rows of live links, each known by its code. */
const linkRows = () => screen.getAllByRole('listitem').filter(row => /^[A-Z0-9]{8}$/.test(row.getAttribute('aria-label') ?? ''));

beforeAll(() => translate());

beforeEach(() => {
  vi.stubGlobal('fetch', fetchStub);
  told.length = 0;
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
    // A place in no room has nothing to tell its links apart from, so none says what it is for.
    expect(rows[0]).toHaveTextContent(/Copy\s*joins as “can log” · until .* · used 2× · revoke any time/);
    expect(rows[1]).toHaveTextContent(/joins as “can manage” · never expires · used 0× · revoke any time/);
    expect(screen.queryByText(/CCCCCCCC/)).not.toBeInTheDocument();
    expect(screen.queryByText(/DDDDDDDD/)).not.toBeInTheDocument();
  });

  it('asks in the link´s card before revoking it, since that has no way back, then says what it was for and leaves the other out', async () => {
    drawTab();
    fireEvent.click(await screen.findByRole('button', { name: 'Revoke the link BBBBBBBB' }));

    const row = linkRows()[1];
    expect(within(row).getByText('Nobody joins Blue Dream tent with this link any more; it cannot be taken back.')).toHaveFocus();
    expect(server.wrote).toHaveLength(0);
    // Put away, nothing is written; asked again and answered, the one link stops.
    fireEvent.click(within(row).getByRole('button', { name: 'Cancel' }));
    expect(within(row).queryByText(/cannot be taken back/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Revoke the link BBBBBBBB' }));
    fireEvent.click(within(row).getByRole('button', { name: 'Revoke' }));

    await waitFor(() => expect(told).toEqual([{ label: 'The link BBBBBBBB no longer works · Blue Dream tent · can manage', undo: null }]));
    expect(server.wrote).toEqual([expect.objectContaining({ method: 'PUT', path: '/invites/BBBBBBBB/revocation' })]);
    await waitFor(() => expect(screen.queryByText(/BBBBBBBB/)).not.toBeInTheDocument());
    expect(screen.getByText(/\/join\/AAAAAAAA$/)).toBeInTheDocument();
  });

  it('says in the card what the server said when it refused, and tells nothing', async () => {
    drawTab();
    await screen.findByRole('button', { name: 'Revoke the link AAAAAAAA' });
    // Gone on the server since the list was read.
    server.invites = server.invites.filter(row => row.code !== 'AAAAAAAA');
    fireEvent.click(screen.getByRole('button', { name: 'Revoke the link AAAAAAAA' }));
    fireEvent.click(within(linkRows()[0]).getByRole('button', { name: 'Revoke' }));

    expect(await within(linkRows()[0]).findByRole('alert')).toBeInTheDocument();
    expect(told).toHaveLength(0);
  });

  it('opens a link that is already out as a code and a QR without cutting another', async () => {
    drawTab();
    fireEvent.click(await screen.findByRole('button', { name: 'Show AAAAAAAA as a code and a QR' }));

    const sheet = screen.getByRole('dialog', { name: 'Invite' });
    // "Code · QR" opens on the code, not on the link.
    expect(within(sheet).getByRole('tab', { name: 'Code' })).toHaveAttribute('aria-selected', 'true');
    expect(within(sheet).getByText('AAAAAAAA')).toBeInTheDocument();
    expect(within(sheet).getByText(/They type it at .*\/join$/)).toBeInTheDocument();

    fireEvent.click(within(sheet).getByRole('tab', { name: 'QR' }));
    expect(await within(sheet).findByRole('img', { name: /QR code for .*\/join\/AAAAAAAA/ })).toBeInTheDocument();
    expect(server.wrote).toHaveLength(0);
  });
});

describe('the invitation sheet', () => {
  it('sends exactly the role and the validity chosen, then describes the link from the answer', async () => {
    await inviting();
    fireEvent.click(await screen.findByRole('button', { name: 'Make a link' }));

    // The place's name stands by itself, as the second line of the heading.
    const sheet = screen.getByRole('dialog', { name: 'Invite' });
    expect(within(sheet).getByRole('heading', { level: 2 })).toHaveTextContent(/^InviteBlue Dream tent$/);
    expect(within(sheet).getByRole('heading', { level: 2 }).lastElementChild).toHaveTextContent(/^Blue Dream tent$/);
    // What a guest needs and sees is behind the help button of the validity: no paragraph stands over the button.
    expect(within(sheet).getByRole('button', { name: 'About Inviting' })).toHaveAccessibleDescription(
      /needs an account of their own .* sees the place .* not your other places/,
    );
    expect(within(sheet).queryByText(/They see|their own account/)).not.toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole('radio', { name: /can manage/ }));
    fireEvent.click(within(sheet).getByRole('button', { name: '24 h' }));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Make the link' }));

    await waitFor(() => expect(server.wrote).toHaveLength(1));
    expect(server.wrote[0]).toMatchObject({ method: 'POST', path: '/spaces/space-1/invites', body: { role: 'can_manage' } });
    const body = server.wrote[0].body as InviteCreate;
    expect(DateTime.fromISO(body.expiresAt!).diff(NOW, 'hours').hours).toBeCloseTo(24, 1);

    expect(await within(sheet).findByText(/\/join\/NEWCADE2$/)).toBeInTheDocument();
    expect(sheet).toHaveTextContent(/joins as “can manage” · until .* · used 0× · revoke any time/);
  });

  it('makes a link that never expires when told to, and says so in those words', async () => {
    await inviting();
    fireEvent.click(await screen.findByRole('button', { name: 'Make a link' }));

    const sheet = screen.getByRole('dialog', { name: 'Invite' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'until revoked' }));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Make the link' }));

    await waitFor(() => expect(server.wrote).toHaveLength(1));
    expect(server.wrote[0].body).toEqual({ role: 'can_log', expiresAt: null });
    await within(sheet).findByText(/\/join\/NEWCADE2$/);
    expect(sheet).toHaveTextContent(/joins as “can log” · never expires · used 0×/);

    // The list under the sheet reads the same row and says the same thing.
    fireEvent.click(within(sheet).getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(linkRows()).toHaveLength(1));
    expect(linkRows()[0]).toHaveTextContent(/never expires/);
  });
});
