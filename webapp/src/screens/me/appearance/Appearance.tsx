import { useTranslation } from 'react-i18next';
import type { UnitPreference } from '@fg2/shared-types/v1';
import { useSession } from '@/api/session';
import { LANGUAGES, setLanguage, type Language } from '@/i18n/i18n';
import { useTheme, type ThemeChoice } from '@/theme/theme-context';
import { Help } from '@/ui/Help';
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
 * the units.
 *
 * The first two are the browser's and stay where they have always lived - the
 * theme is one attribute on <html> and the language one key in local storage -
 * because both have to be known before the first frame, long before any
 * account has answered; the whole app shows either the moment it is chosen.
 * The units are the account's, so that a phone and a laptop agree on what a
 * weight is; each goes to `PATCH /me` as the one preference it changes and is
 * answered as every setting of the account is. The demo has no account to
 * keep them on and is shown the two settings it can change.
 */
export function Appearance() {
  const { t, i18n } = useTranslation();
  const { user } = useSession();
  const { choice, setChoice } = useTheme();
  const language = i18n.resolvedLanguage ?? i18n.language;

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
        <Menu name={t('me.appearance.language')} value={language} onChange={value => void setLanguage(value as Language)}>
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
            <span className="label">
              {t('me.appearance.units')}
              <Help topic="units" />
            </span>
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
