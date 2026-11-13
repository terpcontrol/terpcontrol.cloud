import { useTranslation } from 'react-i18next';
import type { UnitPreference } from '@fg2/shared-types/v1';
import { useSession } from '@/api/session';
import { LANGUAGES, setLanguage, type Language } from '@/i18n/i18n';
import { useLog } from '@/log/log-context';
import { useTheme, type ThemeChoice } from '@/theme/theme-context';
import { Refused } from '@/ui/PageState';
import ui from '@/ui/ui.module.css';
import { languageName } from '../doors';
import { AccountRead, MePage, Menu, Row } from '../parts';
import { useSaveAccount } from '../save';
import { InstallRow } from './InstallRow';

const THEMES: ThemeChoice[] = ['system', 'light', 'dark'];

/** The three questions the contract asks about units, in the order the page asks them, each with its two answers. */
const UNITS: { kind: keyof UnitPreference; choices: string[] }[] = [
  { kind: 'temperature', choices: ['celsius', 'fahrenheit'] },
  { kind: 'weight', choices: ['grams', 'ounces'] },
  { kind: 'volume', choices: ['liters', 'gallons'] },
];

/**
 * Ich › Darstellung: the theme, the language, the app on the home screen, and
 * the units; each line says where its setting holds.
 *
 * The theme is this browser's alone. The language chosen here is this
 * browser's and is told to the account, which a browser nobody chose one in
 * follows (`followAccount`); the change is answered by the toast, in the
 * language it changed to. The units are the account's and go to `PATCH /me`
 * as the one preference changed - stored, and not yet what the views show,
 * which their line says. The demo has no account and is shown the two
 * settings it can change.
 */
export function Appearance() {
  const { t, i18n } = useTranslation();
  const { user } = useSession();
  const { tell } = useLog();
  const { choice, setChoice } = useTheme();
  const language = (i18n.resolvedLanguage ?? i18n.language) as Language;
  const speak = (next: Language) =>
    void setLanguage(next).then(() => {
      // In the language just chosen: this render's `t` still speaks the one before.
      const said = i18n.getFixedT(next);
      tell({
        label: said('me.saved.setting', { what: said('me.appearance.language'), value: languageName(said, next) }),
        from: 'me:language',
        undo: () => setLanguage(language),
      });
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

      {user?.isDemo === true ? null : <Units />}
    </MePage>
  );
}

/** The units, each a menu of its two answers, held still while a change is on its way. */
function Units() {
  const { t } = useTranslation();
  const { save, error } = useSaveAccount();

  return (
    <AccountRead lines={3}>
      {(account, held) => {
        const units = account.preferences.units;

        return (
          <>
            <span className="label">{t('me.appearance.units')}</span>
            <p className={ui.note}>{t('me.appearance.unitsLine')}</p>
            {UNITS.map(({ kind, choices }) => (
              <Row key={kind} title={t(`me.appearance.${kind}`)} line={null}>
                <Menu
                  name={t(`me.appearance.${kind}`)}
                  value={units[kind]}
                  disabled={held}
                  onChange={value =>
                    save(
                      { preferences: { units: { ...units, [kind]: value } } },
                      t('me.saved.setting', { what: t(`me.appearance.${kind}`), value: t(`me.appearance.unit.${value}`) }),
                      now => ({ preferences: { units: { ...now.preferences.units, [kind]: units[kind] } } }),
                    )
                  }
                >
                  {choices.map(unit => (
                    <option key={unit} value={unit}>
                      {t(`me.appearance.unit.${unit}`)}
                    </option>
                  ))}
                </Menu>
              </Row>
            ))}
            <Refused error={error} />
          </>
        );
      }}
    </AccountRead>
  );
}
