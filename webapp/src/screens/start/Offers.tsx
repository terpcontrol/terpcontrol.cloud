import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { useUpdateMe } from '@/api/account';
import { useChooseDiary } from '@/api/layers';
import { useSetPresetPrompt } from '@/api/spaces';
import { GROW } from '@/app/places';
import { Refused } from '@/ui/PageState';
import { Sheet } from '@/ui/Sheet';
import ui from '@/ui/ui.module.css';
import { WhatGrows } from '@/screens/grow/new/WhatGrows';
import styles from './Start.module.css';

/**
 * "Was wächst im Zelt?" - the diary, offered where a device regulates and
 * nothing is said to grow: the card a skipped last step of the setup leaves
 * on Start. An answer starts the grow, and with the first grow the diary.
 * "Nein danke" is kept so the card does not come back on the next phone:
 * with the account while it keeps no diary at all, and with this one place
 * for somebody who keeps one elsewhere - a fridge full of jars holds no grow.
 */
export function GrowOffer({ spaceId, name, diary }: { spaceId: string; name: string; diary: boolean }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const account = useChooseDiary();
  const place = useSetPresetPrompt(spaceId);
  const [asking, setAsking] = useState(false);
  const busy = account.isPending || place.isPending;

  return (
    <section className={styles.card} aria-labelledby="start-grow-offer">
      <h2 className={styles.offerTitle} id="start-grow-offer">
        {t('start.grow.title', { name })}
      </h2>
      <p className={styles.cardText}>{t('start.grow.text')}</p>
      <div className={styles.pair}>
        <button type="button" className={styles.go} onClick={() => setAsking(true)}>
          {t('home.invite.startGrow')}
        </button>
        <button type="button" className={styles.wide} disabled={busy} onClick={() => (diary ? place.mutate('never') : account.mutate('off'))}>
          {t('home.diary.decline')}
        </button>
      </div>
      <Refused error={account.error ?? place.error} />
      {asking ? (
        <Sheet title={t('start.grow.title', { name })} onClose={() => setAsking(false)}>
          <div className={ui.sheetBody}>
            <WhatGrows spaceId={spaceId} onStarted={() => void navigate(GROW)} />
          </div>
        </Sheet>
      ) : null}
    </section>
  );
}

/** Hardware, offered under a diary kept by hand. "Nein danke" is kept with the account. */
export function DeviceOffer() {
  const { t } = useTranslation();
  const decline = useUpdateMe();

  return (
    <section className={styles.card} aria-labelledby="start-device-offer">
      <h2 className={styles.offerTitle} id="start-device-offer">
        {t('start.device.title')}
      </h2>
      <div className={styles.pair}>
        <Link to="/claim" className={styles.go} data-tone="brand">
          {t('home.addDevice.title')}
        </Link>
        <button
          type="button"
          className={styles.wide}
          disabled={decline.isPending}
          onClick={() => decline.mutate({ preferences: { deviceOfferDeclined: true } })}
        >
          {t('home.diary.decline')}
        </button>
      </div>
      <Refused error={decline.error} />
    </section>
  );
}
