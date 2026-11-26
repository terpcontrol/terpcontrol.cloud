import { useTranslation } from 'react-i18next';
import { ageAttribute } from '@/ui/age';
import { Spoken } from '@/ui/Spoken';
import type { Reading } from './readings';
import styles from './Start.module.css';

/** What a big figure on a card states: a reading of the place, and its last hour's mean where there is one. */
export type Figure = Pick<Reading, 'key' | 'label' | 'number' | 'unit' | 'tone' | 'age'> & {
  /** The mean of the last hour without its unit, which the figure above already has ("25,5"), and with it, as it is said. */
  mean?: { number: string; said: string } | null;
};

/**
 * The readings of a place among several as big figures side by side, each
 * with its name and, under it, its last hour's mean - the card as a whole is
 * the way to the place. A figure off its target takes the warning's ink; one
 * that has stopped coming steps back.
 */
export function Figures({ figures }: { figures: Figure[] }) {
  const { t } = useTranslation();

  return (
    <span className={styles.figures}>
      {figures.map(figure => (
        <span key={figure.key} className={styles.figure} data-tone={figure.tone} {...ageAttribute(figure.age)}>
          <span className={styles.figureValue}>
            {figure.number}
            {figure.unit ? <span className={styles.figureUnit}> {figure.unit}</span> : null}
          </span>
          <span className={styles.figureName}>{figure.label}</span>
          {figure.mean ? (
            <span className={styles.figureMean}>
              <Spoken said={t('spoken.hourMean', { value: figure.mean.said })}>{`${t('start.tile.hourMean')} ${figure.mean.number}`}</Spoken>
            </span>
          ) : null}
        </span>
      ))}
    </span>
  );
}
