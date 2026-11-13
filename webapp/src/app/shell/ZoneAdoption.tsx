import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useAccountMe, useUpdateMe } from '@/api/account';
import { followAccount } from '@/i18n/i18n';
import { useMayManage } from '@/ui/session-access';
import ui from '@/ui/ui.module.css';
import { browserZone } from '@/ui/zone';

/**
 * An account that has never picked its zone takes the zone of the device it is
 * signed in on - once, and says so. Every account starts on UTC, and every clock
 * and quiet hour is read in the account's zone, so the signed-in device is the
 * best evidence of where its owner is. A zone somebody chose, UTC included, is
 * never overridden, and the line names the zone left behind and how to go back.
 */
export function ZoneAdoption() {
  const { t, i18n } = useTranslation();
  const me = useAccountMe();
  const mayManage = useMayManage();
  const update = useUpdateMe();
  const asked = useRef(false);
  const told = useRef<string | null>(null);
  const [adopted, setAdopted] = useState<{ from: string; zone: string } | null>(null);

  const account = me.data ?? null;
  const here = browserZone();

  useEffect(() => {
    if (asked.current || !account?.preferences || !mayManage || !here) return;

    const kept = account.preferences;
    if (kept.timezoneChosen === true || kept.timezone === here) return;

    asked.current = true;
    update.mutate({ preferences: { timezone: here, timezoneChosen: true } }, { onSuccess: () => setAdopted({ from: kept.timezone, zone: here }) });
  }, [account, mayManage, here, update]);

  // The account keeps the language chosen in a browser, without a word: what the server writes itself - the day
  // counter burnt into a film - is read in it, and a browser nobody chose one in follows it. An account no browser
  // was signed in to yet - its zone still unpicked - knows none and is told this browser's, as it takes its zone.
  const language = i18n.resolvedLanguage ?? null;
  const { mutate } = update;
  useEffect(() => {
    const kept = account?.preferences;
    if (!kept || !language || kept.locale === language || told.current === language) return;
    if ((kept.timezoneChosen === true && followAccount(kept.locale)) || !mayManage) return;
    told.current = language;
    mutate({ preferences: { locale: language } });
  }, [account, mayManage, language, mutate]);

  if (!adopted) return null;

  return (
    <p className={ui.note} role="status">
      {t('shell.zoneAdopted', adopted)} <Link to="/me/account">{t('shell.zoneAdoptedChange')}</Link>{' '}
      <button type="button" className={ui.button} onClick={() => setAdopted(null)}>
        {t('shell.zoneAdoptedDismiss')}
      </button>
    </p>
  );
}
