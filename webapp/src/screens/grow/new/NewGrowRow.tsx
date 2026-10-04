import { useTranslation } from 'react-i18next';
import { useMayManage } from '@/ui/session-access';
import ui from '@/ui/ui.module.css';

/**
 * Starting a grow from the home: a row under the cards rather than a button in
 * the header, because a grow is not one of the places and would read as one if
 * it sat among them. It is the same dashed row the sheet adds a strain with -
 * the shape the app uses for the thing that is not there yet.
 *
 * It only asks. The sheet belongs to the home, because what the sheet writes
 * decides which half of the home is drawn, and a sheet held inside the half
 * that goes would go with it and take a half-answered grow along.
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
