import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { ageAttribute } from '@/ui/age';
import { Help } from '@/ui/Help';
import ui from '@/ui/ui.module.css';
import type { Reading } from './readings';
import styles from './Start.module.css';

/** What a big figure states: a reading of the place, or on a card among several its CO₂. */
export type Figure = Pick<Reading, 'label' | 'figure' | 'number' | 'unit' | 'tone' | 'age'> & {
  key: Reading['key'] | 'co2';
  /** The verdict, said to a screen reader with the figure. */
  note?: string | null;
};

/**
 * The readings of a place as big figures side by side, each with its name
 * under it - on a place's Start each the way to its curve, with the last day
 * small under the name (`curveOf`, `under`), and on a card among several just
 * the figures, since the whole card is the way to the place. A figure off its
 * target takes the warning's ink; one that has stopped coming steps back.
 */
export function Figures<F extends Figure>({
  figures,
  curveOf,
  under,
}: {
  figures: F[];
  /** The address of a figure's curve, where each figure leads to it. */
  curveOf?: (figure: F) => string;
  /** What stands under a figure's name: its last day. */
  under?: (figure: F) => ReactNode;
}) {
  const { t } = useTranslation();

  return (
    <div className={styles.figures}>
      {figures.map(figure => {
        const value = (
          <span className={styles.figureValue} aria-hidden={curveOf ? true : undefined}>
            {figure.number}
            {figure.unit ? <span className={styles.figureUnit}> {figure.unit}</span> : null}
          </span>
        );
        return (
          <div key={figure.key} className={styles.figure} data-tone={figure.tone} {...ageAttribute(figure.age)}>
            {curveOf ? (
              <Link to={curveOf(figure)} className={styles.figureLink}>
                {value}
                {/* Said as one sentence that names the reading, with the verdict the figure does not draw. */}
                <span className={ui.visuallyHidden}>
                  {[`${figure.label} ${figure.figure}`, figure.note, t('start.reading.open')].filter(Boolean).join(', ')}
                </span>
              </Link>
            ) : (
              value
            )}
            <span className={styles.figureName}>
              <span aria-hidden={curveOf ? true : undefined}>{figure.label}</span>
              {curveOf && figure.key === 'vpd' ? <Help topic="vpd" /> : null}
            </span>
            {under?.(figure)}
          </div>
        );
      })}
    </div>
  );
}
