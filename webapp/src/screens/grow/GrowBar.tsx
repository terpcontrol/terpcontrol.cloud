import { STAGES } from '@/ui/stages';
import { useProgress } from './progress';
import styles from './GrowBar.module.css';

/**
 * A grow's bar, which means one thing. Fed by a scheme, the grow has a planned
 * length: one track, filled by the days gone of the days planned. Without one
 * nothing states a length, so the bar is the six stages as segments, the ones
 * reached filled - a first day of flowering is the fourth segment begun, not
 * two thirds of a way nobody measured.
 *
 * `label` says it to a screen reader where nothing beside the bar does.
 */
export function GrowBar({ grow, label }: { grow: Parameters<typeof useProgress>[0]; label?: string }) {
  const { fill, reached } = useProgress(grow);
  const said = label ? ({ role: 'img', 'aria-label': label } as const) : ({ 'aria-hidden': true } as const);

  return fill !== null ? (
    <span className={styles.track} {...said}>
      <span style={{ width: `${Math.round(fill * 100)}%` }} />
    </span>
  ) : (
    <span className={styles.stages} {...said}>
      {STAGES.map((stage, index) => (
        <span key={stage} data-reached={index < reached || undefined} />
      ))}
    </span>
  );
}
