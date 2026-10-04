import { Lightbulb } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { GrowthStage } from '@fg2/shared-types/v1';
import styles from './GrowPage.module.css';

/**
 * Four short tips for the phase the grow is in - how to water a seedling, when
 * to train, how dry to keep the flowers, how slowly to dry - folded under the
 * phase line, so that somebody new finds them and nobody else has to scroll past
 * them. Curing is where the drying tips end, in the jar.
 */

const TIPS_OF: Partial<Record<GrowthStage, string>> = {
  germination: 'germination',
  seedling: 'seedling',
  vegetative: 'vegetative',
  flowering: 'flowering',
  drying: 'drying',
  curing: 'drying',
};

const TIP_NUMBERS = [1, 2, 3, 4];

export function PhaseTips({ stage }: { stage: GrowthStage | null }) {
  const { t } = useTranslation();
  const tips = stage ? TIPS_OF[stage] : undefined;
  if (!tips) return null;

  return (
    <details className={styles.tips} data-print="omit">
      <summary>
        <Lightbulb size={14} strokeWidth={1.75} aria-hidden />
        {t('assistant.tipsTitle')}
      </summary>
      <ul>
        {TIP_NUMBERS.map(number => (
          <li key={number}>{t(`assistant.tips.${tips}.${number}`)}</li>
        ))}
      </ul>
    </details>
  );
}
