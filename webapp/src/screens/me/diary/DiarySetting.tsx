import { useTranslation } from 'react-i18next';
import type { DiaryChoice } from '@fg2/shared-types/v1';
import { expectLayout, useChooseDiary } from '@/api/layers';
import { useLog } from '@/log/log-context';
import { Refused } from '@/ui/PageState';
import ui from '@/ui/ui.module.css';
import { AccountPage, Row } from '../parts';

/** The three answers, as the page offers them: let the account's use decide, or say so outright. */
const CHOICES: { key: 'auto' | DiaryChoice; choice: DiaryChoice | null }[] = [
  { key: 'auto', choice: null },
  { key: 'on', choice: 'on' },
  { key: 'off', choice: 'off' },
];

/**
 * Ich › Grow-Tagebuch: whether the diary is kept - Grow and the Eintrag button
 * in the bar, what is due on Start, the tasks behind the bell - as the app's
 * one control for one answer out of three, with what the answer that holds
 * means under it. A tap is the write, answered by the toast with the way back.
 */
export function DiarySetting() {
  const { t } = useTranslation();
  const { tell } = useLog();
  const choose = useChooseDiary();

  return (
    <AccountPage title={t('me.diary.title')} demo={t('me.demo')}>
      {(account, held) => {
        const kept = account.preferences.diary ?? null;
        // An answer that may bring Grow and Eintrag into the bar was given here, so the shell does not announce
        // it; where the diary did not come after all, the word is taken back.
        const set = (choice: DiaryChoice | null) => {
          if (choice !== 'off') expectLayout({ diary: true });
          return choose.mutateAsync(choice).then(me => {
            if (me.layers?.diary !== true) expectLayout({ diary: false });
          });
        };

        return (
          <>
            <Row title={t('me.diary.label')} help="diaryLayer" line={t(`me.diary.line.${kept ?? (account.layers?.diary ? 'autoOn' : 'auto')}`)}>
              <div className={ui.segments} role="radiogroup" aria-label={t('me.diary.label')}>
                {CHOICES.map(({ key, choice }) => (
                  <button
                    key={key}
                    type="button"
                    role="radio"
                    aria-checked={kept === choice}
                    className={ui.segment}
                    disabled={held || choose.isPending}
                    onClick={() => {
                      if (kept === choice) return;
                      void set(choice).then(
                        () => tell({ label: t(`me.diary.told.${key}`), undo: () => set(kept), from: 'me:diary' }),
                        // Said under the row, from the write that was refused.
                        () => undefined,
                      );
                    }}
                  >
                    {t(`me.diary.choice.${key}`)}
                  </button>
                ))}
              </div>
            </Row>
            <Refused error={choose.error} />
          </>
        );
      }}
    </AccountPage>
  );
}
