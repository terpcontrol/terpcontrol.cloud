import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useGrows } from '@/api/grows';
import { growDay } from '@/screens/grow/progress';
import ui from '@/ui/ui.module.css';
import { alsoIn } from './movable-grows';

/**
 * The other grows running where a grow stands, each the way to its own page: a place that holds two shows both -
 * under the bar's Grow, on either grow's page and on Start - and never the newer alone.
 */
export function AlsoHere({ growId, spaceId }: { growId: string; spaceId: string | null }) {
  const { t } = useTranslation();
  const also = alsoIn(useGrows(spaceId !== null).data?.items, spaceId, growId);
  if (spaceId === null || also.length === 0) return null;

  return (
    <p className={ui.note}>
      {t('grow.alsoHere')}{' '}
      {also.map((grow, at) => (
        <span key={grow.id}>
          {at > 0 ? ', ' : null}
          <Link to={`/grows/${grow.id}`}>
            {[grow.name, growDay(t, grow.summary)].filter(Boolean).join(' · ')}
            {' ›'}
          </Link>
        </span>
      ))}
    </p>
  );
}
