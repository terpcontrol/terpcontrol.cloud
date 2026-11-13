import type { HomeAnswer, HomeSpaceCard } from '@fg2/shared-types/v1';
import { useAccountMe } from '@/api/account';
import { useSession } from '@/api/session';
import { GROW } from '@/app/places';
import { RefreshFailed } from '@/ui/PageState';
import { useNow } from '@/ui/useNow';
import { NotifyNotice } from '@/screens/notifications/NotifyNotice';
import { AddPlace } from './AddPlace';
import { Latest } from './Latest';
import { DeviceOffer } from './Offers';
import { PhaseLine } from './Phase';
import { OwnPhoto } from './Picture';
import { Today } from './Today';
import styles from './Start.module.css';
import ui from '@/ui/ui.module.css';
import { useGrowPlants } from '@/api/grows';

/**
 * Start of an account whose one grow stands in no place: a diary kept by
 * hand, drawn as a place without hardware is - the grow's name, its newest
 * photo, phase and week, what is due and what was written last - from the
 * home's own card, since there is no place to read.
 */
export function GrowStart({ card, answer, failedAt }: { card: HomeSpaceCard; answer: HomeAnswer; failedAt: number | null }) {
  const now = useNow();
  const { user } = useSession();
  const me = useAccountMe();
  const grow = card.grow!;
  const plants = useGrowPlants(grow.growId);

  return (
    <section className={`${ui.stack3} ${styles.page}`} data-single>
      <div className={styles.head}>
        <h1>{grow.name}</h1>
      </div>
      <RefreshFailed failedAt={failedAt} now={now} />
      <NotifyNotice later />
      <OwnPhoto grow={grow} entries={card.entries} />
      <PhaseLine grow={grow} to={GROW} />
      <Today now={now} />
      <Latest
        entries={card.entries}
        events={card.events}
        people={answer.people}
        on={{ label: grow.name, spaceId: null, ownerId: user?.id ?? null }}
        diary
        plants={plants.data?.items ?? []}
        now={now}
      />
      {me.data && me.data.preferences.deviceOfferDeclined !== true ? <DeviceOffer /> : null}
      <AddPlace />
    </section>
  );
}
