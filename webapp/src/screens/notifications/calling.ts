import type { NotificationCategory } from '@fg2/shared-types/v1';
import { useShape } from '@/app/shell/shape';
import { callingRows } from './reach';

/** The rows of the grid something on this account can raise, read off what it has: devices, cameras, a diary. */
export const useCallingRows = (): NotificationCategory[] => {
  const { steering, cameras, diary } = useShape();
  return callingRows({ steering, cameras: cameras > 0, diary });
};

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** "Cam-Warnungen und Erinnerungen": the rows in words, for the notice and for what the tap did. */
export const rowsInWords = (t: Translate, rows: NotificationCategory[]): string => {
  const words = rows.map(row => t(`notify.row.${row}`));
  const said = words.length > 1 ? `${words.slice(0, -1).join(', ')} ${t('notify.and')} ${words.at(-1)}` : (words[0] ?? '');
  return said.charAt(0).toUpperCase() + said.slice(1);
};
