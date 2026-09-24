import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useMe, useUpdateMe } from '@/api/account';
import { useMayManage } from '@/ui/session-access';
import ui from '@/ui/ui.module.css';
import { browserZone } from '@/ui/zone';

/**
 * An account that has never picked its zone takes the zone of the device it is
 * signed in on - once, and says so.
 *
 * Every clock the app draws, and every quiet hour the server keeps, is read in
 * the account's zone. Every account starts on UTC, and every account carried
 * over from the old cloud was given UTC too, because the old cloud never knew
 * a zone: a grower in Germany was shown every diary time, every alert and every
 * plan step two hours early, beside a camera still whose own burnt-in clock said
 * otherwise, and was woken inside the quiet hours they had set. Only Me ›
 * Appearance mentioned it, where nobody who did not already suspect it looks.
 *
 * The device a person signs in on is the best evidence there is of where they
 * are, so it is taken without asking. Asking would put a question about time
 * zones in front of somebody who came to check on a tent, and for nearly all of
 * them there is one right answer. It is taken only while the account says the
 * zone was never chosen: the server records a zone somebody picked - UTC kept
 * on purpose included - and this never overrides it, nor adopts again on the
 * next device. The line that says it happened names the zone that was left and
 * how to go back, so the change is never silent.
 */
export function ZoneAdoption() {
  const { t } = useTranslation();
  const me = useMe();
  const mayManage = useMayManage();
  const update = useUpdateMe();
  const asked = useRef(false);
  const [adopted, setAdopted] = useState<{ from: string; zone: string } | null>(null);

  const account = me.data ?? null;
  const here = browserZone();

  useEffect(() => {
    if (asked.current || !account?.preferences || !mayManage || !here) return;

    const kept = account.preferences;
    if (kept.timezoneChosen === true || kept.timezone === here) return;

    asked.current = true;
    update.mutate(
      { preferences: { ...kept, timezone: here, timezoneChosen: true } },
      { onSuccess: () => setAdopted({ from: kept.timezone, zone: here }) },
    );
  }, [account, mayManage, here, update]);

  if (!adopted) return null;

  return (
    <p className={ui.note} role="status">
      {t('shell.zoneAdopted', adopted)} <Link to="/me/appearance">{t('shell.zoneAdoptedChange')}</Link>{' '}
      <button type="button" className={`${ui.button} ${ui.quiet}`} onClick={() => setAdopted(null)}>
        {t('shell.zoneAdoptedDismiss')}
      </button>
    </p>
  );
}
