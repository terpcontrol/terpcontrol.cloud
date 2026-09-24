import { ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { HomeSpaceCard } from '@fg2/shared-types/v1';
import { useHome } from '@/api/home';
import { useSession } from '@/api/session';
import { LoadFailed, Waiting } from '@/ui/PageState';
import ui from '@/ui/ui.module.css';
import { useNow } from '@/ui/useNow';
import { livenessOf, measuredAtOf } from './home/attention';
import { LivenessPill } from './home/SpaceCard';
import { lastSpace, rememberSpace } from './timeline/last-space';
import { Timeline as TimelineScreen } from './timeline/Timeline';
import styles from './timeline/Timeline.module.css';

/**
 * The Timeline tab of the bottom bar. It opens on the place last looked at -
 * from a tent page or from this picker - and falls back to the first place the
 * home lists, which is the one that most wants attention. The tent page's own
 * Timeline tab draws the same screen for the tent it belongs to.
 */
export function Timeline() {
  const { t } = useTranslation();
  const now = useNow();
  const home = useHome();
  const { user } = useSession();
  const [picked, setPicked] = useState<string | null>(() => lastSpace());

  if (home.isPending) return <Waiting lines={3} />;
  if (!home.data) return <LoadFailed retry={() => void home.refetch()} />;

  // A timeline is a place's measurements over a window, so the cards that stand
  // for a grow and no place have nothing to draw here and are not offered.
  const places = home.data.spaces.filter((card): card is HomeSpaceCard & { spaceId: string } => card.spaceId !== null);
  if (places.length === 0) {
    return (
      <section className={styles.screen}>
        <h1 className={styles.title}>{t('shell.tabs.timeline')}</h1>
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

  const here = places.find(space => space.spaceId === picked) ?? places[0];
  const choose = (spaceId: string) => {
    setPicked(spaceId);
    rememberSpace(spaceId);
  };

  return (
    <TimelineScreen
      spaceId={here.spaceId}
      reportsAge
      heading={
        <h1 className={styles.title}>
          {t('shell.tabs.timeline')}
          <span className={styles.titleDot}>·</span>
          <span className={styles.picker}>
            <span className={styles.pickerName}>{here.name}</span>
            <ChevronDown size={16} strokeWidth={2} aria-hidden />
            {/* The name is what is read and the select is what is used, so the
                picker is one native control with the caption drawn over it. */}
            <select value={here.spaceId} aria-label={t('timeline.pickSpace')} onChange={event => choose(event.target.value)}>
              {places.map(space => (
                <option key={space.spaceId} value={space.spaceId}>
                  {space.name}
                </option>
              ))}
            </select>
          </span>
          {/* How alive the place is, read off the home's own card rather than asked for again. */}
          <LivenessPill liveness={livenessOf(here)} measuredAt={measuredAtOf(here.values)} now={now} explain />
        </h1>
      }
    />
  );
}
