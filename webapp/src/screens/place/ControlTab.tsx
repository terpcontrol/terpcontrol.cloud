import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { useCurrentPlace } from '@/app/places';
import { useSession } from '@/api/session';
import { LoadFailed, Waiting } from '@/ui/PageState';
import ui from '@/ui/ui.module.css';
import { Control } from '../control/Control';
import { PlaceTitle, VisitingTitle } from './PlaceTitle';
import styles from './Place.module.css';

/**
 * Steuerung, the bar's item: what the chosen place is held at and what watches
 * over it. A link that names a place chooses it, and the pages below - the
 * alarm rules, the plan - keep it in the address, so an alert can link to the
 * rule it came from.
 */
export function ControlTab() {
  const { t } = useTranslation();
  const { user } = useSession();
  const { page = null } = useParams();
  const { home, here, visiting } = useCurrentPlace();

  if (home.isPending) return <Waiting lines={4} />;
  if (!home.data) return <LoadFailed retry={() => void home.refetch()} />;

  // Support, reading a customer's place: the place the address names, read only,
  // rather than "nothing to steer here" over a place that steers plenty.
  if (visiting) {
    return (
      <section className={`${styles.page} ${styles.reading}`}>
        <VisitingTitle title={t('shell.tabs.control')} spaceId={visiting} />
        <Control spaceId={visiting} sub={page} />
      </section>
    );
  }

  if (!here) {
    return (
      <section className={`${styles.page} ${styles.reading}`}>
        <h1>{t('shell.tabs.control')}</h1>
        <p className={`${ui.cardDashed} ${ui.note}`}>
          {user?.isDemo === true ? (
            t('place.control.demoNothing')
          ) : (
            <>
              {t('place.control.nothing')} <Link to="/claim">{t('space.control.noControllerAdd')}</Link>
            </>
          )}
        </p>
      </section>
    );
  }

  return (
    <section className={`${styles.page} ${styles.reading}`}>
      <PlaceTitle title={t('shell.tabs.control')} here={here} />
      <Control key={here.spaceId} spaceId={here.spaceId} sub={page} />
    </section>
  );
}
