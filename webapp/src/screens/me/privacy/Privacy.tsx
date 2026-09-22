import { useTranslation } from 'react-i18next';
import type { Me } from '@fg2/shared-types/v1';
import { useMe, useUpdateMe, useUpdatingMe } from '@/api/account';
import { useSession } from '@/api/session';
import { LoadFailed, Refused, RefreshFailed, Waiting } from '@/ui/PageState';
import { useMayManage } from '@/ui/session-access';
import ui from '@/ui/ui.module.css';
import { useNow } from '@/ui/useNow';
import { ExportRow, MePage, Row } from '../parts';
import { ClimateRow } from './ClimateRow';
import { DeleteRow } from './DeleteRow';
import { Switch } from './parts';

/**
 * Me › Privacy: what other people are shown, how long anything is kept, and
 * the way out.
 *
 * The two halves are different promises and are labelled as two. The first is
 * about what leaves this account - a link, a public page, an export - and every
 * switch on it hides something from everybody but the owner, who goes on seeing
 * their own figures. The second is about the server itself: how long it keeps
 * what it was given, that all of it can be taken away as a file, and that
 * leaving really is leaving.
 *
 * `PATCH /me` replaces each object it is given rather than merging into it, so
 * every control here sends the whole object it belongs to with one field
 * changed, and the screen holds still while a write is on its way - two changes
 * crossing would each carry the other's old state back.
 *
 * Every promise on the screen is one the install behind it keeps. The two
 * that cannot be read off the account - that no location is stored, and where
 * the servers stand - are said only as far as they are known: the app stores
 * no location anywhere, and the servers are in the EU on the hosted install,
 * which is the one that enforces Premium; a self-hosted one stands wherever
 * its owner put it, and is promised nothing about that here.
 */

export function Privacy() {
  const { t } = useTranslation();
  const now = useNow();
  const { user } = useSession();
  const isDemo = user?.isDemo === true;
  const me = useMe(false, !isDemo);
  const mayManage = useMayManage();
  const update = useUpdateMe();
  const updating = useUpdatingMe();
  const title = t('me.privacy.title');

  if (isDemo) {
    return (
      <MePage title={title}>
        <p className={`${ui.cardDashed} ${ui.note}`}>{t('me.privacy.demo')}</p>
      </MePage>
    );
  }

  if (me.isPending) {
    return (
      <MePage title={title}>
        <Waiting lines={4} />
      </MePage>
    );
  }

  if (!me.data) {
    return (
      <MePage title={title}>
        <LoadFailed retry={() => void me.refetch()} />
      </MePage>
    );
  }

  const account: Me = me.data;
  const held = !mayManage || updating;
  const privacy = account.privacy;

  return (
    <MePage title={title}>
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

      <ClimateRow
        retention={account.climateRetention}
        climateDays={account.retention.climateDays}
        disabled={held}
        now={now}
        onChange={climateDays => update.mutate({ retention: { climateDays } })}
      />

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

      <ExportRow title={t('me.privacy.export.title')} line={t('me.privacy.export.line')} ask={t('me.privacy.export.ask')} />

      <DeleteRow handle={account.handle} disabled={held} />

      <Refused error={update.error} />
      <p className={ui.note}>
        {t('me.privacy.footnote.location')}
        {account.premium.enforced ? ` ${t('me.privacy.footnote.servers')}` : ''}
      </p>
    </MePage>
  );
}
