import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { Me } from '@fg2/shared-types/v1';
import { useMe, useUpdateMe, useUpdatingMe } from '@/api/account';
import { useSession } from '@/api/session';
import { LoadFailed, Refused, RefreshFailed, Waiting } from '@/ui/PageState';
import { useMayManage } from '@/ui/session-access';
import ui from '@/ui/ui.module.css';
import { useNow } from '@/ui/useNow';
import { DeleteRow } from './DeleteRow';
import { Row, Switch } from './parts';
import styles from './Privacy.module.css';

/**
 * Me › Privacy: what other people are shown, how long anything is kept, and
 * the way out.
 *
 * The two halves are different promises and are labelled as two. The first is
 * about what leaves this account - a link, a public page, an export - and every
 * switch on it hides something from everybody but the owner, who goes on seeing
 * their own figures. The second is about the server itself: how long it keeps
 * what it was given, and that leaving really is leaving.
 *
 * `PATCH /me` replaces each object it is given rather than merging into it, so
 * every control here sends the whole object it belongs to with one field
 * changed, and the screen holds still while a write is on its way - two changes
 * crossing would each carry the other's old state back.
 */

/** How long raw climate points are kept. `null` is the one that keeps them for as long as the install does. */
const KEEP: { key: string; days: number | null }[] = [
  { key: 'd90', days: 90 },
  { key: 'd180', days: 180 },
  { key: 'd365', days: 365 },
  { key: 'd730', days: 730 },
  { key: 'forever', days: null },
];

export function Privacy() {
  const { t } = useTranslation();
  const now = useNow();
  const { user } = useSession();
  const isDemo = user?.isDemo === true;
  const me = useMe(false, !isDemo);
  const mayManage = useMayManage();
  const update = useUpdateMe();
  const updating = useUpdatingMe();

  const header = (
    <header className={styles.head}>
      <h1 className={styles.title}>{t('me.privacy.title')}</h1>
      <span className={`mono ${styles.crumb}`}>
        <Link to="/me">{t('me.title')}</Link> › {t('me.privacy.title')}
      </span>
    </header>
  );

  if (isDemo) {
    return (
      <section className={styles.page}>
        {header}
        <p className={`${ui.cardDashed} ${ui.note}`}>{t('me.privacy.demo')}</p>
      </section>
    );
  }

  if (me.isPending) {
    return (
      <section className={styles.page}>
        {header}
        <Waiting lines={4} />
      </section>
    );
  }

  if (!me.data) {
    return (
      <section className={styles.page}>
        {header}
        <LoadFailed retry={() => void me.refetch()} />
      </section>
    );
  }

  const account: Me = me.data;
  const held = !mayManage || updating;
  const privacy = account.privacy;

  return (
    <section className={styles.page}>
      {header}
      <RefreshFailed failedAt={me.isError ? me.dataUpdatedAt : null} now={now} />

      <span className="label">{t('me.privacy.sharing')}</span>

      <Row title={t('me.privacy.weights.title')} line={t('me.privacy.weights.line')}>
        <Switch
          name={t('me.privacy.weights.title')}
          on={privacy.hideWeights}
          disabled={held}
          onToggle={() => update.mutate({ privacy: { ...privacy, hideWeights: !privacy.hideWeights } })}
        />
      </Row>

      <Row title={t('me.privacy.counts.title')} line={t('me.privacy.counts.line')}>
        <Switch
          name={t('me.privacy.counts.title')}
          on={privacy.hideCounts}
          disabled={held}
          onToggle={() => update.mutate({ privacy: { ...privacy, hideCounts: !privacy.hideCounts } })}
        />
      </Row>

      <Row title={t('me.privacy.profile.title')} line={t('me.privacy.profile.line', { handle: account.handle })}>
        <Switch
          name={t('me.privacy.profile.title')}
          on={account.publicProfile}
          disabled={held}
          onToggle={() => update.mutate({ publicProfile: !account.publicProfile })}
        />
      </Row>

      <span className="label">{t('me.privacy.data')}</span>

      <Row title={t('me.privacy.climate.title')} line={t('me.privacy.climate.line')}>
        <select
          className={`mono ${ui.chip} ${styles.menu}`}
          value={String(account.retention.climateDays ?? '')}
          aria-label={t('me.privacy.climate.title')}
          disabled={held}
          onChange={event => update.mutate({ retention: { climateDays: event.target.value === '' ? null : Number(event.target.value) } })}
        >
          {KEEP.map(option => (
            <option key={option.key} value={option.days === null ? '' : String(option.days)}>
              {t(`me.privacy.keep.${option.key}`)}
            </option>
          ))}
        </select>
      </Row>

      {/*
        What a free camera's pictures are actually kept for is the install's own
        configuration, so the line states the days this install names and says
        plainly that nothing is deleted where it names none - which is the
        default, and was the promise made when the sweep was left off.
      */}
      <Row
        title={t('me.privacy.stills.title')}
        line={
          account.premium.free.stillDays === null
            ? t('me.privacy.stills.kept')
            : t('me.privacy.stills.keptDays', { count: account.premium.free.stillDays })
        }
      >
        <span className={ui.chip}>{t('me.privacy.premium')}</span>
      </Row>

      <Row title={t('me.privacy.export.title')} line={t('me.privacy.export.line')}>
        <span className={ui.chip}>{t('me.privacy.premium')}</span>
      </Row>

      <DeleteRow handle={account.handle} disabled={held} />

      <Refused error={update.error} />
      <p className={ui.note}>{t('me.privacy.footnote')}</p>
    </section>
  );
}
