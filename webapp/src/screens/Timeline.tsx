import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { useCurrentPlace } from '@/app/places';
import { useDevices } from '@/api/devices';
import { useSession } from '@/api/session';
import { LoadFailed, NoLongerHere, Waiting } from '@/ui/PageState';
import ui from '@/ui/ui.module.css';
import { Visited, VisitingTitle } from './place/PlaceTitle';
import { Timeline as TimelineScreen } from './timeline/Timeline';
import { withParams } from './timeline/view';
import styles from './timeline/Timeline.module.css';

/**
 * Verlauf, the bar's item: the curves of the chosen place. A link that names
 * a place (`?space=`, which is how a reading on Start, a diary line and an
 * alert open it) chooses it; which one that is stands in the header from the
 * second place on. A link that names a device (`?device=`) is about that
 * device: its curves, in the place it stands in - whichever place the address
 * or the header named before. A link that names a place of the account's own
 * that has ended draws that place's curves, read only, rather than another
 * place's.
 */
export function Timeline() {
  const { t } = useTranslation();
  const { user } = useSession();
  const { home, here, places, visiting, ended, stray } = useCurrentPlace(true);
  const [params, setParams] = useSearchParams();
  const devices = useDevices();
  const deviceId = params.get('device');
  const stands = deviceId ? devices.data?.items.find(one => one.id === deviceId)?.spaceId : null;
  // The device's own place is written into the address, which is what chooses a place: the header follows.
  const elsewhere = stands && stands !== params.get('space') && places.some(place => place.spaceId === stands) ? stands : null;
  useEffect(() => {
    if (elsewhere) setParams(withParams(params, { space: elsewhere }), { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per place the device turns out to stand in
  }, [elsewhere]);

  // Not the place chosen before, for the moment it takes to learn where the device stands.
  if (home.isPending || elsewhere || ended === undefined || (deviceId && devices.isPending)) return <Waiting lines={3} />;
  if (!home.data) return <LoadFailed title={t('shell.tabs.timeline')} read={home} />;
  if (stray) return <NoLongerHere what="space" />;

  if (visiting) {
    return (
      <Visited spaceId={visiting}>
        <TimelineScreen spaceId={visiting} title={<VisitingTitle title={t('shell.tabs.timeline')} spaceId={visiting} />} />
      </Visited>
    );
  }

  // The owner's own place that has ended keeps its curves, read only.
  if (ended) return <TimelineScreen spaceId={ended.id} ended title={<h1>{t('shell.tabs.timeline')}</h1>} place={ended.name} />;

  // Verlauf is a place's measurements over a window, so the cards that stand
  // for a grow and no place have nothing to draw here and are not offered.
  if (!here) {
    return (
      <section className={styles.screen}>
        <h1>{t('shell.tabs.timeline')}</h1>
        {/* The demo is a session that owns nothing and is refused every write,
            so sending it to Start to add a device or start a grow names two
            things it may not do. It is told what it is looking at instead. */}
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

  return <TimelineScreen spaceId={here.spaceId} title={<h1>{t('shell.tabs.timeline')}</h1>} place={places.length > 1 ? here.name : null} />;
}
