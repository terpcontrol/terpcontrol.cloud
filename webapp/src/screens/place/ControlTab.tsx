import { useTranslation } from 'react-i18next';
import { Link, useParams, useSearchParams } from 'react-router';
import { useCurrentPlace } from '@/app/places';
import { useSession } from '@/api/session';
import { useSpaceOverview } from '@/api/spaces';
import { LoadFailed, Waiting } from '@/ui/PageState';
import ui from '@/ui/ui.module.css';
import { Control } from '../control/Control';
import { PlaceHeading } from './PlaceHeading';
import heading from './PlaceHeading.module.css';
import styles from './Place.module.css';

/**
 * Steuerung, the tab: what one place is held at and what watches over it. It
 * opens on the place a link names, else the one last looked at, else the only
 * one; with more than one place its title is the switcher. The pages below it
 * - the alarm rules, the plan - keep the place in the address too, so an alert
 * can link to the rule it came from.
 */
export function ControlTab() {
  const { t } = useTranslation();
  const { user } = useSession();
  const { page = null } = useParams();
  const { home, places, here, choose } = useCurrentPlace();
  const [params] = useSearchParams();
  const asked = params.get('space');

  if (home.isPending) return <Waiting lines={4} />;
  if (!home.data) return <LoadFailed retry={() => void home.refetch()} />;

  // Support, reading a customer's place: the place the address names, read only,
  // rather than "nothing to steer here" over a place that steers plenty.
  if (user?.isAdmin === true && asked && !places.some(place => place.spaceId === asked)) return <Visiting spaceId={asked} page={page} />;

  if (!here) {
    return (
      <section className={`${styles.page} ${styles.reading}`}>
        <h1 className={heading.title}>{t('shell.tabs.control')}</h1>
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
      <PlaceHeading title={t('shell.tabs.control')} places={places} here={here} onChoose={choose} />
      <Control key={here.spaceId} spaceId={here.spaceId} sub={page} />
    </section>
  );
}

/** A customer's place, read by support: its Steuerung, said to be somebody else's. */
function Visiting({ spaceId, page }: { spaceId: string; page: string | null }) {
  const { t } = useTranslation();
  const overview = useSpaceOverview(spaceId);

  return (
    <section className={`${styles.page} ${styles.reading}`}>
      <h1 className={heading.title}>
        {t('shell.tabs.control')} · {overview.data?.name ?? '…'}
        <span className={`mono ${styles.visiting}`}>{t('timeline.visiting')}</span>
      </h1>
      <Control spaceId={spaceId} sub={page} />
    </section>
  );
}
