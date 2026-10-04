import { useContext, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { UNSAFE_DataRouterContext, useBlocker, type Location } from 'react-router';
import { Sheet } from '@/log/Sheet';
import ui from '@/ui/ui.module.css';
import styles from './Targets.module.css';

/** What a panel with figures nobody has saved yet hands up, so that leaving can ask about all of them at once. */
export interface Unsaved {
  /** Sends the panel's draft; true once the device's document took it. */
  save: () => Promise<boolean>;
  discard: () => void;
}

/**
 * The question asked before targets nobody saved are left behind.
 *
 * A draft lives in the page, so walking away from it - another tab, the bell,
 * the alarm row under the targets, the switcher to another place - used to
 * drop it without a word, and the grower who had set the light to come on at
 * ten went on believing it would. The save bar cannot stand in the way of all
 * of those, so leaving asks instead: save and go on, throw the change away and
 * go on, or stay. Only a move to another page or another place is asked about;
 * the "Nacht ›" jump inside the page changes nothing but the hash.
 *
 * Closing the browser tab is the browser's own question, which is the most a
 * page may ask there.
 */
export function LeaveGuard({ unsaved, onAsking }: { unsaved: ReadonlyMap<string, Unsaved>; onAsking: (asking: boolean) => void }) {
  const dirty = unsaved.size > 0;

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  // A screen drawn on its own, as a test lays one out, has no router that can
  // hold a navigation back; the question is then not asked rather than thrown.
  return useContext(UNSAFE_DataRouterContext) ? <Blocking unsaved={unsaved} onAsking={onAsking} /> : null;
}

const elsewhere = ({ currentLocation, nextLocation }: { currentLocation: Location; nextLocation: Location }): boolean =>
  currentLocation.pathname !== nextLocation.pathname || currentLocation.search !== nextLocation.search;

function Blocking({ unsaved, onAsking }: { unsaved: ReadonlyMap<string, Unsaved>; onAsking: (asking: boolean) => void }) {
  const { t } = useTranslation();
  const blocker = useBlocker(next => unsaved.size > 0 && elsewhere(next));
  const [saving, setSaving] = useState(false);
  // The save bars stand aside while the question is open: it asks the same thing, and the bar would stand over it.
  const asking = blocker.state === 'blocked';
  useEffect(() => onAsking(asking), [asking, onAsking]);

  if (blocker.state !== 'blocked') return null;

  const stay = () => blocker.reset();
  const discard = () => {
    for (const panel of unsaved.values()) panel.discard();
    blocker.proceed();
  };
  const save = async () => {
    setSaving(true);
    const results = await Promise.all([...unsaved.values()].map(panel => panel.save()));
    setSaving(false);
    // A save that was refused says why under its own bar, which is on the page being left - so the page stays.
    if (results.every(Boolean)) blocker.proceed();
    else blocker.reset();
  };

  return (
    <Sheet
      title={t('targets.leave.title')}
      onClose={stay}
      actions={
        <>
          <button type="button" className={`${ui.button} ${ui.primary}`} disabled={saving} onClick={() => void save()}>
            {saving ? t('targets.saving') : t('targets.leave.save')}
          </button>
          <button type="button" className={ui.button} disabled={saving} onClick={discard}>
            {t('targets.leave.discard')}
          </button>
          <button type="button" className={ui.button} disabled={saving} onClick={stay}>
            {t('targets.leave.stay')}
          </button>
        </>
      }
    >
      <p className={styles.leaveText}>{t('targets.leave.body')}</p>
    </Sheet>
  );
}
