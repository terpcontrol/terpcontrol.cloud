import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { useAccountMe, useUpdateMe } from '@/api/account';
import { useChooseDiary } from '@/api/layers';
import { useSetPresetPrompt } from '@/api/spaces';
import { GROW } from '@/app/places';
import { useLog } from '@/log/log-context';
import { Refused } from '@/ui/PageState';
import { Sheet } from '@/ui/Sheet';
import ui from '@/ui/ui.module.css';
import { WhatGrows } from '@/screens/grow/new/WhatGrows';
import { usePlaceStage } from './stage';
import styles from './Start.module.css';

/**
 * "Was wächst im Zelt?" - the diary, offered where a device regulates and
 * nothing is said to grow: the card a skipped last step of the setup leaves
 * on Start. An answer starts the grow, and with the first grow the diary.
 * "Nein danke" is kept so the card does not come back on the next phone:
 * with the account while it keeps no diary at all, and with this one place
 * for somebody who keeps one elsewhere - a fridge full of jars holds no grow.
 * The card is gone with the tap, so a toast answers it: that the diary stays
 * off and where it is switched on, with the way to take the tap back.
 *
 * "Grow starten" opens the short form on the stage the place is on.
 */
export function GrowOffer({ spaceId, name, diary }: { spaceId: string; name: string; diary: boolean }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const account = useChooseDiary();
  const place = useSetPresetPrompt(spaceId);
  const me = useAccountMe();
  const { tell } = useLog();
  const stage = usePlaceStage(spaceId);
  const [asking, setAsking] = useState(false);
  const busy = account.isPending || place.isPending;

  // The card goes with the answer, so what follows it hangs on the write's own promise and not on this card still standing.
  const decline = () => {
    if (diary) {
      void place.mutateAsync('never').then(
        () => tell({ label: t('start.grow.declinedHere', { name }), undo: () => place.mutateAsync('ask') }),
        () => undefined,
      );
      return;
    }
    // What the account said before, which is what taking the answer back restores: its own choice, or none.
    const before = me.data?.preferences.diary ?? null;
    void account.mutateAsync('off').then(
      () => tell({ label: t('start.grow.declined'), undo: () => account.mutateAsync(before) }),
      () => undefined,
    );
  };

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
        <button type="button" className={styles.wide} disabled={busy} onClick={decline}>
          {t('home.diary.decline')}
        </button>
      </div>
      <Refused error={account.error ?? place.error} />
      {asking ? (
        <Sheet title={t('start.grow.title', { name })} onClose={() => setAsking(false)}>
          <div className={ui.sheetBody}>
            <WhatGrows spaceId={spaceId} stage={stage} onStarted={() => void navigate(GROW)} />
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
