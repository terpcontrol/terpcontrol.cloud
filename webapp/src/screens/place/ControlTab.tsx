import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams, useSearchParams } from 'react-router';
import { CONTROL_PAGES, controlPath, useCurrentPlace } from '@/app/places';
import { useSession } from '@/api/session';
import { PageHead } from '@/ui/PageHead';
import { LoadFailed, NoLongerHere, NothingHere, Waiting } from '@/ui/PageState';
import ui from '@/ui/ui.module.css';
import { Control } from '../control/Control';
import { PlaceEnded, Visited } from './PlaceTitle';
import styles from './Place.module.css';

/**
 * Steuerung, the bar's item: what the chosen place is held at, what watches
 * over it and what stands in it. A link that names a place chooses it, and the
 * pages below - the alarm rules, the plan, the outputs, the work mode - keep
 * it in the address, so an alert can link to the rule it came from.
 */
export function ControlTab() {
  const { t } = useTranslation();
  const { user } = useSession();
  const { page = null } = useParams();
  const [params] = useSearchParams();
  const { home, places, here, visiting, ended, stray } = useCurrentPlace(true);
  // While the places are read, and where they cannot be, a page keeps its own name: a page under Steuerung its way back too.
  const sub = CONTROL_PAGES.find(one => one === page) ?? null;
  const space = params.get('space');
  const under = (body: ReactNode) => (
    <section className={`${ui.stack3} ${ui.page} ${styles.steering}`}>
      <PageHead title={t(`control.page.${sub}`)} back={{ to: space ? controlPath(space) : '/control', label: t('control.back') }} />
      {body}
    </section>
  );

  if (home.isPending || ended === undefined) return sub ? under(<Waiting lines={4} />) : <Waiting lines={4} title={t('shell.tabs.control')} />;
  if (!home.data) return sub ? under(<LoadFailed read={home} />) : <LoadFailed title={t('shell.tabs.control')} read={home} />;
  if (stray) return <NoLongerHere what="space" />;

  // Support, reading a customer's place: the place the address names, read only,
  // rather than "nothing to steer here" over a place that steers plenty.
  if (visiting) {
    return (
      <Visited spaceId={visiting}>
        <section className={`${ui.stack3} ${ui.page} ${styles.steering}`}>
          <Control spaceId={visiting} sub={page} />
        </section>
      </Visited>
    );
  }

  if (ended) {
    return (
      <section className={`${ui.stack3} ${ui.page} ${styles.steering}`}>
        <PlaceEnded title={t('shell.tabs.control')} name={ended.name} />
      </section>
    );
  }

  if (!here) {
    return (
      <section className={`${ui.stack3} ${ui.page} ${styles.steering}`}>
        <h1>{t('shell.tabs.control')}</h1>
        {user?.isDemo === true ? (
          <p className={`${ui.cardDashed} ${ui.note}`}>{t('place.control.demoNothing')}</p>
        ) : (
          <NothingHere to="/claim" where={t('space.control.noControllerAdd')}>
            {t('place.control.nothing')}
          </NothingHere>
        )}
      </section>
    );
  }

  return (
    <section className={`${ui.stack3} ${ui.page} ${styles.steering}`}>
      <Control key={here.spaceId} spaceId={here.spaceId} sub={page} here={here} several={places.length > 1} />
    </section>
  );
}
