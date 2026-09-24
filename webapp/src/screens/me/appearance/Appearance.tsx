import { useTranslation } from 'react-i18next';
import type { Me, UnitPreference } from '@fg2/shared-types/v1';
import { useMe, useUpdateMe, useUpdatingMe } from '@/api/account';
import { useSession } from '@/api/session';
import { LANGUAGES, setLanguage, type Language } from '@/i18n/i18n';
import { useTheme, type ThemeChoice } from '@/theme/theme-context';
import { LoadFailed, Refused, RefreshFailed, Waiting } from '@/ui/PageState';
import { useMayManage } from '@/ui/session-access';
import ui from '@/ui/ui.module.css';
import { useNow } from '@/ui/useNow';
import { browserZone, zoneNames } from '@/ui/zone';
import { languageName } from '../doors';
import { MePage, Menu, Row } from '../parts';
import styles from './Appearance.module.css';

const THEMES: ThemeChoice[] = ['system', 'light', 'dark'];

/** The three questions the contract asks about units, in the order the page asks them, each with its two answers. */
const UNITS: { kind: keyof UnitPreference; choices: string[] }[] = [
  { kind: 'temperature', choices: ['celsius', 'fahrenheit'] },
  { kind: 'weight', choices: ['grams', 'ounces'] },
  { kind: 'volume', choices: ['liters', 'gallons'] },
];

/**
 * Me › Appearance: the theme, the language, and the units.
 *
 * The first two are the browser's and stay where they have always lived - the
 * theme is one attribute on <html> and the language one key in local storage -
 * because both have to be known before the first frame, long before any
 * account has answered. The units and the time zone are the account's, so that
 * a phone and a laptop agree on what a weight is and on when the night begins;
 * they go to `PATCH /me` as the whole preferences object with one field
 * changed, since the route replaces what it is given rather than merging into
 * it. The demo has no account to keep them on, and is told so under the two
 * settings it can still change.
 *
 * The zone is the one setting here the server acts on rather than merely draws:
 * quiet hours are read in it, so the browser's zone would be the wrong answer
 * however convenient - what this device is in is offered as a suggestion and
 * never written by itself.
 */
export function Appearance() {
  const { t, i18n } = useTranslation();
  const { user } = useSession();
  const isDemo = user?.isDemo === true;
  const { choice, setChoice } = useTheme();
  const language = i18n.resolvedLanguage ?? i18n.language;

  return (
    <MePage title={t('me.appearance.title')}>
      <span className="label">{t('me.appearance.display')}</span>

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

      <span className="label">{t('me.appearance.units')}</span>
      {isDemo ? <p className={`${ui.cardDashed} ${ui.note}`}>{t('me.demo')}</p> : <FromTheAccount />}
    </MePage>
  );
}

/** What the account states rather than the browser: the units, each a menu of its two answers, and the zone every clock time is drawn in. All held still while a change is on its way. */
function FromTheAccount() {
  const { t } = useTranslation();
  const now = useNow();
  const me = useMe();
  const mayManage = useMayManage();
  const update = useUpdateMe();
  const updating = useUpdatingMe();

  if (me.isPending) return <Waiting lines={3} />;
  if (!me.data) return <LoadFailed retry={() => void me.refetch()} />;

  const account: Me = me.data;
  const held = !mayManage || updating;
  const units = account.preferences.units;

  return (
    <>
      <RefreshFailed failedAt={me.isError ? me.dataUpdatedAt : null} now={now} />
      {UNITS.map(({ kind, choices }) => (
        <Row key={kind} title={t(`me.appearance.${kind}`)} line={t('me.appearance.unitsLine')}>
          <Menu
            name={t(`me.appearance.${kind}`)}
            value={units[kind]}
            disabled={held}
            onChange={value => update.mutate({ preferences: { ...account.preferences, units: { ...units, [kind]: value } } })}
          >
            {choices.map(unit => (
              <option key={unit} value={unit}>
                {t(`me.appearance.unit.${unit}`)}
              </option>
            ))}
          </Menu>
        </Row>
      ))}

      <span className="label">{t('me.appearance.clock')}</span>
      <Row title={t('me.appearance.timezone')} line={zoneLine(t, account.preferences.timezone)}>
        <Menu
          name={t('me.appearance.timezone')}
          value={account.preferences.timezone}
          className={styles.zone}
          disabled={held}
          onChange={value => update.mutate({ preferences: { ...account.preferences, timezone: value } })}
        >
          {offeredZones(account.preferences.timezone).map(zone => (
            <option key={zone} value={zone}>
              {zone}
            </option>
          ))}
        </Menu>
      </Row>
      <Refused error={update.error} />
    </>
  );
}

/**
 * The zones the menu offers: everything this browser knows, plus UTC, the
 * account's own and this device's. The three are added by hand because the
 * browser's list is of places rather than of offsets and holds no UTC at all,
 * and an account that keeps a zone it cannot be given back - which is every
 * account the migration left on UTC - would be a menu that only goes one way.
 */
const offeredZones = (kept: string): string[] => {
  const known = new Set(zoneNames());
  known.add('UTC');
  known.add(kept);
  const here = browserZone();
  if (here) known.add(here);

  return [...known].sort();
};

/** Why the zone matters, and what this device is in where that is something else - the one hint an account still on the migration's UTC needs. */
const zoneLine = (t: (key: string, options?: Record<string, unknown>) => string, kept: string): string => {
  const here = browserZone();

  return [t('me.appearance.timezoneLine'), here && here !== kept ? t('me.appearance.timezoneHere', { zone: here }) : null].filter(Boolean).join(' ');
};
