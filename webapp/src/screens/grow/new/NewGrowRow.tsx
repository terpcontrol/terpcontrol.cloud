import { useTranslation } from 'react-i18next';
import { useMayManage } from '@/ui/session-access';
import ui from '@/ui/ui.module.css';

/**
 * Starting a grow from Grow, for an account whose grows stand in no place: the
 * same dashed row the sheet adds a strain with - the shape the app uses for
 * the thing that is not there yet. It only asks; the page holds the sheet.
 *
 * A session that may only look is offered nothing: the server refuses the
 * write, so a row that opened the sheet would be a row that ends in a refusal.
 */
export function NewGrowRow({ onOpen }: { onOpen: () => void }) {
  const { t } = useTranslation();
  const mayManage = useMayManage();

  if (!mayManage) return null;

  return (
    <button type="button" className={ui.addRow} onClick={onOpen}>
      {t('grow.new.row')}
    </button>
  );
}
