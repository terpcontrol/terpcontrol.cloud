import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useCurrentPlace } from '@/app/places';
import { useSession } from '@/api/session';
import { LoadFailed, Waiting } from '@/ui/PageState';
import ui from '@/ui/ui.module.css';
import { PlaceTitle, Visited, VisitingTitle } from './place/PlaceTitle';
import { Timeline as TimelineScreen } from './timeline/Timeline';
import styles from './timeline/Timeline.module.css';

/**
 * Verlauf, the bar's item: the Timeline of the chosen place. A link that names
 * a place (`?space=`, which is how a tile of a place and an alert open it)
 * chooses it; which one that is stands in the header from the second place on.
 */
export function Timeline() {
  const { t } = useTranslation();
  const { user } = useSession();
  const { home, here, visiting } = useCurrentPlace();

  if (home.isPending) return <Waiting lines={3} />;
  if (!home.data) return <LoadFailed retry={() => void home.refetch()} />;

  if (visiting) {
    return (
      <Visited spaceId={visiting}>
        <TimelineScreen spaceId={visiting} heading={<VisitingTitle title={t('shell.tabs.timeline')} spaceId={visiting} />} />
      </Visited>
    );
  }

  // A timeline is a place's measurements over a window, so the cards that stand
  // for a grow and no place have nothing to draw here and are not offered.
  if (!here) {
    return (
      <section className={styles.screen}>
        <h1>{t('shell.tabs.timeline')}</h1>
        {/* The demo is a session that owns nothing and is refused every write,
            so sending it to the Home to add a device or start a grow names two
            things it may not do. It is told what it is looking at instead, the
            way the demo's own inbox and task list already are. */}
        <p className={`${ui.cardDashed} ${ui.note}`}>
          {user?.isDemo === true ? (
            t('timeline.demoNoSpaces')
          ) : (
            <>
              {t('timeline.noSpaces')} <Link to="/">{t('shell.tabs.home')}</Link>.
            </>
          )}
        </p>
      </section>
    );
  }

  return <TimelineScreen spaceId={here.spaceId} heading={<PlaceTitle title={t('shell.tabs.timeline')} here={here} />} />;
}
