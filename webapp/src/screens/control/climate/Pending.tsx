import { useTranslation } from 'react-i18next';
import { useNow } from '@/ui/useNow';
import { useZone } from '@/ui/zone';
import { savedWords, type PendingItem } from './figures';
import styles from './Climate.module.css';

/**
 * What a block's device has not been handed, as the one note of that block:
 * a single setting in a sentence - stored when, and what the device still
 * holds - and several as their count, which unfolds each of them. Only what
 * the server's `pending` says is said: where it does not know what the
 * device holds, the note says that the device takes the setting over.
 */
export function PendingNote({ items }: { items: readonly PendingItem[] }) {
  const { t } = useTranslation();
  const now = useNow();
  const zone = useZone();
  const [first] = items;
  if (!first) return null;
  const saved = (at: string) => savedWords(t, at, now, zone);

  if (items.length === 1) {
    return (
      <p className={styles.pending} role="status">
        {t(
          first.switchedOn
            ? 'control.pending.on'
            : first.held === null
              ? 'control.pending.unknown'
              : first.one
                ? 'control.pending.window'
                : 'control.pending.figure',
          {
            name: first.name,
            value: first.value,
            saved: saved(first.savedAt),
            held: first.held ?? '',
          },
        )}
      </p>
    );
  }

  const newest = items.reduce((last, item) => (item.savedAt > last ? item.savedAt : last), first.savedAt);
  return (
    <details className={styles.pending}>
      <summary>{t('control.pending.several', { number: items.length, saved: saved(newest) })}</summary>
      <ul>
        {items.map(item => (
          <li key={item.name}>{t(item.held === null ? 'control.pending.oneUnknown' : 'control.pending.one', { ...item })}</li>
        ))}
      </ul>
    </details>
  );
}
