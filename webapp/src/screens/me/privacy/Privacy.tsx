import { useTranslation } from 'react-i18next';
import { useUpdateMe } from '@/api/account';
import { Help } from '@/ui/Help';
import { Refused } from '@/ui/PageState';
import { Switch } from '@/ui/Switch';
import ui from '@/ui/ui.module.css';
import { useNow } from '@/ui/useNow';
import { AccountPage, ExportRow, Row } from '../parts';
import { ClimateRow } from './ClimateRow';
import { DeleteRow } from './DeleteRow';

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
  const update = useUpdateMe();

  return (
    <AccountPage title={t('me.privacy.title')} demo={t('me.privacy.demo')}>
      {(account, held) => {
        const privacy = account.privacy;

        return (
          <>
            <span className="label">
              {t('me.privacy.sharing')}
              <Help topic="privacyRedaction" />
            </span>

            <Row title={t('me.privacy.weights.title')} line={t('me.privacy.weights.line')}>
              <Switch
                label={t('me.privacy.weights.title')}
                on={privacy.hideWeights}
                disabled={held}
                onChange={hideWeights => update.mutate({ privacy: { ...privacy, hideWeights } })}
              />
            </Row>

            <Row title={t('me.privacy.counts.title')} line={t('me.privacy.counts.line')}>
              <Switch
                label={t('me.privacy.counts.title')}
                on={privacy.hideCounts}
                disabled={held}
                onChange={hideCounts => update.mutate({ privacy: { ...privacy, hideCounts } })}
              />
            </Row>

            <Row title={t('me.privacy.profile.title')} line={t('me.privacy.profile.line', { handle: account.handle })} help="publicProfile">
              <Switch
                label={t('me.privacy.profile.title')}
                on={account.publicProfile}
                disabled={held}
                onChange={publicProfile => update.mutate({ publicProfile })}
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
              {/*
                The chip is a price tag, and an install that gates nothing is not
                selling this - the Premium screen says so in as many words, and a
                badge here saying otherwise is the same claim twice removed.
              */}
              {account.premium.enforced ? <span className={ui.chip}>{t('me.privacy.premium')}</span> : null}
            </Row>

            <ExportRow title={t('me.privacy.export.title')} line={t('me.privacy.export.line')} ask={t('me.privacy.export.ask')} />

            <DeleteRow handle={account.handle} disabled={held} />

            <Refused error={update.error} />
            <p className={ui.note}>
              {t('me.privacy.footnote.location')}
              {account.premium.enforced ? ` ${t('me.privacy.footnote.servers')}` : ''}
            </p>
          </>
        );
      }}
    </AccountPage>
  );
}
