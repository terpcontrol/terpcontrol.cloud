import { useTranslation } from 'react-i18next';
import { LANGUAGES, setLanguage, type Language } from '@/i18n/i18n';
import { useLog } from '@/log/log-context';
import { useTheme, type ThemeChoice } from '@/theme/theme-context';
import ui from '@/ui/ui.module.css';
import { languageName } from '../doors';
import { MePage, Menu, Row } from '../parts';
import { InstallRow } from './InstallRow';

const THEMES: ThemeChoice[] = ['system', 'light', 'dark'];

/**
 * Ich › Darstellung: the theme, the language and the app on the home screen;
 * each line says where its setting holds.
 *
 * The theme is this browser's alone. The language chosen here is this
 * browser's and is told to the account, which a browser nobody chose one in
 * follows (`followAccount`); the change is answered by the toast, in the
 * language it changed to. Units are not offered: the account stores a choice
 * of °F, ounces and gallons, but no view converts, so a choice that changed
 * nothing on screen is not drawn until one does.
 */
export function Appearance() {
  const { t, i18n } = useTranslation();
  const { tell } = useLog();
  const { choice, setChoice } = useTheme();
  const language = (i18n.resolvedLanguage ?? i18n.language) as Language;
  const speak = (next: Language) =>
    void setLanguage(next).then(() => {
      // Each answer in the language that holds when it is read: the change in the one just chosen - this render's
      // `t` still speaks the one before -, the way back in the one gone back to.
      const said = (speaks: Language) => {
        const words = i18n.getFixedT(speaks);
        return words('me.saved.setting', { what: words('me.appearance.language'), value: languageName(words, speaks) });
      };
      tell({ label: said(next), from: 'me:language', undo: () => setLanguage(language), undone: said(language) });
    });

  return (
    <MePage title={t('me.appearance.title')}>
      <Row title={t('me.theme.label')} line={t('me.appearance.themeLine')}>
        <div className={ui.segments} role="radiogroup" aria-label={t('me.theme.label')}>
          {THEMES.map(option => (
            <button key={option} type="button" role="radio" aria-checked={choice === option} className={ui.segment} onClick={() => setChoice(option)}>
              {t(`me.theme.${option}`)}
            </button>
          ))}
        </div>
      </Row>

      <Row title={t('me.appearance.language')} line={t('me.appearance.languageLine')}>
        <Menu name={t('me.appearance.language')} value={language} onChange={value => speak(value as Language)}>
          {LANGUAGES.map(code => (
            <option key={code} value={code}>
              {languageName(t, code)}
            </option>
          ))}
        </Menu>
      </Row>

      <InstallRow />
    </MePage>
  );
}
