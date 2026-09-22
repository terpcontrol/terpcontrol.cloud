import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Chart } from '@/charts/Chart';
import { plotOption } from '@/charts/series';
import type { ChartPalette } from '@/charts/tokens';
import ui from '@/ui/ui.module.css';
import type { Card } from './cards';
import styles from './Charts.module.css';

/**
 * One panel: what it is, what it is measured in, and the picture. The header
 * carries the whole of the explanation - "VPD · band moves with the phase ·
 * leaf −2 °C" - because a chart with a legend inside it loses a third of its
 * height on a phone to words that never change.
 */
export function ChartCard({ card }: { card: Card }) {
  const { t } = useTranslation();
  const option = useMemo(() => (palette: ChartPalette) => plotOption(palette, card.plot), [card.plot]);

  return (
    <section className={`${ui.card} ${styles.card}`}>
      <header className={styles.cardHead}>
        <span className={styles.cardTitle}>{card.title}</span>
        {card.about ? <span className={styles.cardAbout}>· {card.about}</span> : null}
        <span className={`mono ${styles.cardUnit}`}>{card.unit}</span>
      </header>
      <div className={styles.plot}>
        <Chart option={option} height="100%" ariaLabel={t('charts.plotAlt', { title: card.title })} />
      </div>
      {card.left.length > 0 ? (
        <p className={`${ui.note} ${styles.leftOut}`}>{t('charts.leftOut', { count: card.left.length, names: card.left.join(', ') })}</p>
      ) : null}
    </section>
  );
}
