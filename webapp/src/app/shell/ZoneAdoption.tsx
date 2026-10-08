import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useMe, useUpdateMe } from '@/api/account';
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
  const me = useMe();
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

  // The language is the browser's to choose, but what the server writes itself -
  // the day counter burnt into a film - is read in the one the account was last
  // used in, so the account is told it without a word.
  const language = i18n.resolvedLanguage ?? null;
  const { mutate } = update;
  useEffect(() => {
    if (!account?.preferences || !mayManage || !language || account.preferences.locale === language || told.current === language) return;
    told.current = language;
    mutate({ preferences: { locale: language } });
  }, [account, mayManage, language, mutate]);

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
