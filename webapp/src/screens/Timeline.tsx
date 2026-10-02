import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { useCurrentPlace } from '@/app/places';
import { useSession } from '@/api/session';
import { useSpaceOverview } from '@/api/spaces';
import { LoadFailed, Waiting } from '@/ui/PageState';
import ui from '@/ui/ui.module.css';
import { PlaceHeading } from './place/PlaceHeading';
import { Timeline as TimelineScreen } from './timeline/Timeline';
import heading from './place/PlaceHeading.module.css';
import styles from './timeline/Timeline.module.css';

/**
 * Verlauf, the tab: the Timeline of one place. It opens on the place a link
 * names (`?space=`, which is how a tile of the cockpit and an alert open it),
 * else on the place last looked at, else on the first the home lists; with
 * more than one place its title is the switcher.
 */
export function Timeline() {
  const { t } = useTranslation();
  const { user } = useSession();
  const { home, places, here, choose } = useCurrentPlace();
  const [params] = useSearchParams();
  const asked = params.get('space');

  if (home.isPending) return <Waiting lines={3} />;
  if (!home.data) return <LoadFailed retry={() => void home.refetch()} />;

  // Support, reading a customer's place from the fleet: an administrator may
  // read any place, and one that is not among their own is drawn as the place
  // the address names rather than swapped for one of their own.
  if (user?.isAdmin === true && asked && !places.some(place => place.spaceId === asked)) return <Visiting spaceId={asked} />;

  // A timeline is a place's measurements over a window, so the cards that stand
  // for a grow and no place have nothing to draw here and are not offered.
  if (!here) {
    return (
      <section className={styles.screen}>
        <h1 className={heading.title}>{t('shell.tabs.timeline')}</h1>
        {/* The demo is a session that owns nothing and is refused every write,
            so sending it to the Home to add a device or start a grow names two
            things it may not do. It is told what it is looking at instead, the
            way the demo's own inbox and task list already are. */}
        <p className={`${ui.cardDashed} ${ui.note}`}>
          {user?.isDemo === true ? (
            t('timeline.demoNoSpaces')
          ) : (
            <>
              {t('timeline.noSpaces')} <Link to="/">{t('shell.tabs.home')}</Link>
            </>
          )}
        </p>
      </section>
    );
  }

  return (
    <TimelineScreen
      spaceId={here.spaceId}
      heading={<PlaceHeading title={t('shell.tabs.timeline')} places={places} here={here} onChoose={choose} />}
    />
  );
}

/** A customer's place, read by support: the Timeline of the place the address names, said to be somebody else's. */
function Visiting({ spaceId }: { spaceId: string }) {
  const { t } = useTranslation();
  const overview = useSpaceOverview(spaceId);

  return (
    <TimelineScreen
      spaceId={spaceId}
      heading={
        <h1 className={heading.title}>
          {t('shell.tabs.timeline')} · {overview.data?.name ?? '…'}
          <span className={`mono ${styles.visiting}`}>{t('timeline.visiting')}</span>
        </h1>
      }
    />
  );
}
