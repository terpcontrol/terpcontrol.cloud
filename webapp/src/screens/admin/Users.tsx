import { DateTime } from 'luxon';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { AdminUserUpdate, User } from '@fg2/shared-types/v1';
import { useAdminUsers, useCreateUser, useDeleteUser, useUpdateUser } from '@/api/admin';
import { useSession } from '@/api/session';
import { Sheet } from '@/log/Sheet';
import { LoadFailed, Refused, Waiting } from '@/ui/PageState';
import ui from '@/ui/ui.module.css';
import { NoMatch } from './NoMatch';
import { useFollowCursor } from './pages';
import styles from './Admin.module.css';

/**
 * The accounts on this install, as the one person who may see them sees them.
 *
 * An address is the thing here that is nobody else's business. It is on the
 * table because an operator answering "which account is this" has nothing else
 * to answer it with - a handle is chosen and changeable, an address is what the
 * sign-in uses - and it goes nowhere else: the search filters what has already
 * been loaded, so no address is ever put in a query string, and nothing on this
 * screen copies one into a link, a title or a log line.
 *
 * Every sheet that changes an account says whose account it is, by handle and
 * by address, before it offers a field. These are not this operator's own
 * settings: the same form on Me is somebody deciding about themselves, and this
 * one is somebody deciding about a stranger, which is worth one sentence
 * wherever it happens.
 *
 * The one account an operator can lock themselves out with is their own. The
 * server keeps no invariant here - it writes whatever it is sent - so the
 * screen keeps two: it never offers the change that would leave the install
 * with no administrator at all, as far as the loaded list can tell, and it
 * asks before a change that takes the Admin section or the sign-in away from
 * the person making it, naming what is lost.
 */
export function Users() {
  const { t } = useTranslation();
  const { user } = useSession();
  const people = useAdminUsers();
  const [search, setSearch] = useState('');
  const [making, setMaking] = useState(false);

  useFollowCursor(people);

  const header = (
    <header className={styles.head}>
      <h1 className={styles.title}>{t('admin.users.title')}</h1>
      <span className={`mono ${styles.crumb}`}>
        <Link to="/admin/fleet">{t('admin.fleet.title')}</Link> › {t('admin.users.title')}
      </span>
    </header>
  );

  if (people.isPending) {
    return (
      <section className={styles.page}>
        {header}
        <Waiting lines={4} />
      </section>
    );
  }

  if (!people.data) {
    return (
      <section className={styles.page}>
        {header}
        <LoadFailed retry={() => void people.refetch()} />
      </section>
    );
  }

  const all = people.data.pages.flatMap(page => page.items);
  const needle = search.trim().toLowerCase().replace(/^@/, '');
  const shown = needle ? all.filter(one => one.handle.toLowerCase().includes(needle) || one.email.toLowerCase().includes(needle)) : all;

  // Who could still run the install if one of them were taken out of it. The
  // count is only known to be whole once every page is here; until then no
  // account is called the last one, because the next page may hold another.
  const activeAdmins = all.filter(one => one.isAdmin && one.isActive && !one.deletionStartedAt).length;
  const wholeListLoaded = !people.hasNextPage;

  return (
    <section className={styles.page}>
      <header className={styles.head}>
        <h1 className={styles.title}>{t('admin.users.title')}</h1>
        <span className={`mono ${styles.counts}`}>
          {[
            t('admin.count.accounts', { count: all.length }),
            t('admin.count.admins', { count: all.filter(one => one.isAdmin).length }),
            t('admin.count.notActivated', { count: all.filter(one => !one.isActive).length }),
          ].join(' · ')}
        </span>
        <span className={styles.chips}>
          <input
            className={`mono ${ui.input} ${styles.search}`}
            type="search"
            autoComplete="off"
            aria-label={t('admin.users.search')}
            placeholder={t('admin.users.search')}
            value={search}
            onChange={event => setSearch(event.target.value)}
          />
          <button type="button" className={ui.chip} onClick={() => setMaking(true)}>
            {t('admin.users.create')}
          </button>
        </span>
      </header>

      <p className={`${ui.note} ${styles.consequence}`}>{t('admin.users.privacy')}</p>

      <div className={styles.tableCard}>
        <table className={styles.table} data-empty={shown.length === 0 ? '' : undefined}>
          <thead>
            <tr>
              <th>{t('admin.users.column.handle')}</th>
              <th>{t('admin.users.column.address')}</th>
              <th>{t('admin.users.column.state')}</th>
              <th>{t('admin.users.column.created')}</th>
              <th>{t('admin.users.column.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {shown.length > 0 ? (
              shown.map(account => (
                <AccountRow
                  key={account.id}
                  account={account}
                  isMe={account.id === user?.id}
                  lastAdmin={wholeListLoaded && activeAdmins <= 1 && account.isAdmin && account.isActive && !account.deletionStartedAt}
                />
              ))
            ) : (
              <NoMatch
                columns={5}
                line={t('admin.users.noMatch', { search: search.trim() })}
                clear={t('admin.fleet.clearFilters')}
                onClear={() => setSearch('')}
              />
            )}
          </tbody>
        </table>
      </div>

      <div className={styles.row}>
        <span className={`mono ${styles.consequence}`}>{t('admin.users.showing', { shown: shown.length, loaded: all.length })}</span>
        {people.hasNextPage ? (
          <button type="button" className={ui.chip} onClick={() => void people.fetchNextPage()} disabled={people.isFetchingNextPage}>
            {t('admin.fleet.loadMore')}
          </button>
        ) : null}
      </div>

      {making ? <CreateSheet onClose={() => setMaking(false)} /> : null}
    </section>
  );
}

function AccountRow({ account, isMe, lastAdmin }: { account: User; isMe: boolean; lastAdmin: boolean }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState<'change' | 'delete' | null>(null);

  const state = [
    account.isActive ? t('admin.users.active') : t('admin.users.notActivated'),
    account.isAdmin ? t('admin.users.admin') : null,
    account.deletionStartedAt ? t('admin.users.deleting') : null,
    isMe ? t('admin.users.you') : null,
  ].filter(Boolean);

  return (
    <tr>
      <td className="mono">@{account.handle}</td>
      <td className={`mono ${styles.address}`}>{account.email}</td>
      <td>{state.join(' · ')}</td>
      <td className="mono">{DateTime.fromISO(account.createdAt).toFormat('yyyy-LL-dd')}</td>
      <td>
        <span className={styles.actions}>
          <button type="button" className={ui.chip} onClick={() => setOpen('change')}>
            {t('admin.users.change')}
          </button>
          <button type="button" className={`${ui.chip} ${styles.danger}`} onClick={() => setOpen('delete')}>
            {t('admin.users.delete')}
          </button>
        </span>
        {open === 'change' ? <ChangeSheet account={account} isMe={isMe} lastAdmin={lastAdmin} onClose={() => setOpen(null)} /> : null}
        {open === 'delete' ? <DeleteSheet account={account} isMe={isMe} onClose={() => setOpen(null)} /> : null}
      </td>
    </tr>
  );
}

/** A new account is active at once and has no activation code, because whoever made it can hand the password over. */
function CreateSheet({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const create = useCreateUser();
  const [email, setEmail] = useState('');
  const [handle, setHandle] = useState('');
  const [password, setPassword] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);

  const ready = email.trim() !== '' && handle.trim() !== '' && password !== '';

  return (
    <Sheet
      title={t('admin.users.createTitle')}
      onClose={onClose}
      actions={
        <button
          type="button"
          className={`${ui.button} ${ui.primary}`}
          disabled={!ready || create.isPending}
          onClick={() => create.mutate({ email: email.trim(), handle: handle.trim(), password, isAdmin, isActive: true }, { onSuccess: onClose })}
        >
          {t('admin.users.createIt')}
        </button>
      }
    >
      <p className={styles.sheetBody}>{t('admin.users.createBody')}</p>
      <label className={styles.field}>
        <span className="label">{t('admin.users.column.address')}</span>
        <input className={`mono ${ui.input}`} type="email" autoComplete="off" value={email} onChange={event => setEmail(event.target.value)} />
      </label>
      <label className={styles.field}>
        <span className="label">{t('admin.users.column.handle')}</span>
        <input className={`mono ${ui.input}`} autoComplete="off" value={handle} onChange={event => setHandle(event.target.value)} />
      </label>
      <label className={styles.field}>
        <span className="label">{t('admin.users.password')}</span>
        <input
          className={`mono ${ui.input}`}
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={event => setPassword(event.target.value)}
        />
      </label>
      <label className={styles.row}>
        <input type="checkbox" checked={isAdmin} onChange={event => setIsAdmin(event.target.checked)} />
        <span>{t('admin.users.makeAdmin')}</span>
      </label>
      <Refused error={create.error} />
    </Sheet>
  );
}

/**
 * Changing somebody else's account, password included - which is what an
 * administrator does for a person who cannot receive the mail a reset would
 * arrive in. The password field is blank and stays out of the write unless
 * something was typed into it, so saving a changed handle never quietly issues
 * a new password as well.
 *
 * On the operator's own row the two boxes are the two ways to lock oneself
 * out: without "may run this install" the Admin section is gone the moment
 * the save lands, and without "active" the account cannot sign in again.
 * Neither is undone from inside the app by the person it happened to, so
 * unticking one turns Save into a question that names the loss. Where the
 * account is the last administrator the install has, the boxes are not
 * offered at all - a control somebody may not use is absent, not refused
 * after the tap.
 */
function ChangeSheet({ account, isMe, lastAdmin, onClose }: { account: User; isMe: boolean; lastAdmin: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const change = useUpdateUser();
  const [email, setEmail] = useState(account.email);
  const [handle, setHandle] = useState(account.handle);
  const [password, setPassword] = useState('');
  const [isAdmin, setIsAdmin] = useState(account.isAdmin);
  const [isActive, setIsActive] = useState(account.isActive);
  const [asking, setAsking] = useState(false);

  const body: AdminUserUpdate = {};
  if (email.trim() !== account.email) body.email = email.trim();
  if (handle.trim() !== account.handle) body.handle = handle.trim();
  if (password !== '') body.password = password;
  if (isAdmin !== account.isAdmin) body.isAdmin = isAdmin;
  if (isActive !== account.isActive) body.isActive = isActive;
  const dirty = Object.keys(body).length > 0;

  // What the save would take from the person saving it, said under the boxes
  // and asked about again in the save's place.
  const losing = isMe
    ? [
        account.isAdmin && !isAdmin ? t('admin.users.demoteMine') : null,
        account.isActive && !isActive ? t('admin.users.deactivateMine') : null,
      ].filter((line): line is string => line !== null)
    : [];
  const save = () => change.mutate({ userId: account.id, body }, { onSuccess: onClose });

  if (asking) {
    return (
      <Sheet
        title={t('admin.users.confirmMineTitle')}
        aside={account.email}
        onClose={onClose}
        actions={
          <>
            <button type="button" className={ui.button} disabled={change.isPending} onClick={() => setAsking(false)}>
              {t('admin.users.confirmNo')}
            </button>
            <button type="button" className={`${ui.button} ${styles.danger}`} disabled={change.isPending} onClick={save}>
              {t('admin.users.confirmMine')}
            </button>
          </>
        }
      >
        {losing.map(line => (
          <p key={line} className={styles.sheetBody}>
            {line}
          </p>
        ))}
        <Refused error={change.error} />
      </Sheet>
    );
  }

  return (
    <Sheet
      title={t('admin.users.changeTitle', { handle: account.handle })}
      aside={account.email}
      onClose={onClose}
      actions={
        <button
          type="button"
          className={`${ui.button} ${ui.primary}`}
          disabled={!dirty || change.isPending}
          onClick={() => (losing.length > 0 ? setAsking(true) : save())}
        >
          {t('admin.users.save')}
        </button>
      }
    >
      <p className={styles.sheetBody}>{isMe ? t('admin.users.changeMine') : t('admin.users.changeSomebody', { handle: account.handle })}</p>

      <label className={styles.field}>
        <span className="label">{t('admin.users.column.address')}</span>
        <input className={`mono ${ui.input}`} type="email" autoComplete="off" value={email} onChange={event => setEmail(event.target.value)} />
      </label>
      <label className={styles.field}>
        <span className="label">{t('admin.users.column.handle')}</span>
        <input className={`mono ${ui.input}`} autoComplete="off" value={handle} onChange={event => setHandle(event.target.value)} />
      </label>
      <label className={styles.field}>
        <span className="label">{t('admin.users.newPassword')}</span>
        <input
          className={`mono ${ui.input}`}
          type="password"
          autoComplete="new-password"
          placeholder={t('admin.users.unchanged')}
          value={password}
          onChange={event => setPassword(event.target.value)}
        />
      </label>
      <label className={styles.row}>
        <input type="checkbox" checked={isActive} disabled={lastAdmin} onChange={event => setIsActive(event.target.checked)} />
        <span>{t('admin.users.isActive')}</span>
      </label>
      <label className={styles.row}>
        <input type="checkbox" checked={isAdmin} disabled={lastAdmin} onChange={event => setIsAdmin(event.target.checked)} />
        <span>{t('admin.users.makeAdmin')}</span>
      </label>
      {lastAdmin ? <p className={`${ui.note} ${styles.consequence}`}>{t('admin.users.lastAdmin')}</p> : null}
      {losing.map(line => (
        <p key={line} className={`${ui.note} ${styles.consequence}`}>
          {line}
        </p>
      ))}

      {/* The code is serialised to an administrator alone, and handing it over is how such an account is activated. */}
      {account.activationCode ? (
        <p className={`mono ${styles.consequence}`}>{t('admin.users.activationCode', { code: account.activationCode })}</p>
      ) : null}

      <Refused error={change.error} />
    </Sheet>
  );
}

/**
 * The end of somebody else's account. It asks for the handle to be typed, as
 * the account's own deletion does: this is the one control on the screen where
 * being wrong costs another person everything they own, and a confirmation
 * that is one more tap is answered by the same reflex that opened it. The
 * handle is compared without regard to case, because the prompt above the
 * field is set in small caps and a phone capitalises the first letter typed.
 *
 * What the sheet says is what the server does: what the account owns goes,
 * and what the person wrote in other people's tents stays there without their
 * name - a member's waterings are part of the host's diary, not theirs to take
 * away. The account the install is configured with is the one the server
 * always keeps; nothing on the wire says which account that is, so the sheet
 * says so on every administrator's row before the field, rather than after.
 */
function DeleteSheet({ account, isMe, onClose }: { account: User; isMe: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const remove = useDeleteUser();
  const [typed, setTyped] = useState('');
  const sure = typed.trim().replace(/^@/, '').toLowerCase() === account.handle.toLowerCase();

  return (
    <Sheet
      title={t('admin.users.deleteTitle', { handle: account.handle })}
      aside={account.email}
      onClose={onClose}
      actions={
        <button
          type="button"
          className={`${ui.button} ${styles.danger}`}
          disabled={!sure || remove.isPending}
          onClick={() => remove.mutate(account.id, { onSuccess: onClose })}
        >
          {t('admin.users.deleteIt')}
        </button>
      }
    >
      <p className={styles.sheetBody}>{t('admin.users.deleteBody', { handle: account.handle })}</p>
      <p className={styles.sheetBody}>{t('admin.users.deleteDevices')}</p>
      {isMe ? <p className={styles.sheetBody}>{t('admin.users.deleteMine')}</p> : null}
      {account.isAdmin ? <p className={styles.sheetBody}>{t('admin.users.deleteAdmin')}</p> : null}
      <label className={styles.field}>
        <span className="label">{t('admin.users.typeHandle', { handle: account.handle })}</span>
        <input
          className={`mono ${ui.input}`}
          value={typed}
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          onChange={event => setTyped(event.target.value)}
        />
      </label>
      <Refused error={remove.error} />
    </Sheet>
  );
}
