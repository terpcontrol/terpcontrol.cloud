import { useTranslation } from 'react-i18next';
import { advancedItem, type ChartsContext } from '@/ui/advanced/item';
import { SettingRow } from '@/ui/advanced/SettingRow';
import { Choice, Choices } from '@/ui/SheetParts';
import ui from '@/ui/ui.module.css';
import { STEPS, stepLabel } from '../steps';

/**
 * The fine settings of the charts page, which the old charts offered beside
 * the chart and which few growers ever touch: how wide a window each point
 * stands for, which half of the cycle a VPD line keeps, and whether a window
 * that ends now follows it. Each is stored in the page's address, so a link
 * or a reload keeps it.
 */

function Step({ settings, change, answeredStep }: ChartsContext) {
  const { t } = useTranslation();
  const asked = settings.stepSeconds;
  // A step the window was too wide for comes back wider, and is said rather than left to be wondered about.
  const widened = asked !== null && answeredStep !== null && answeredStep > asked;

  return (
    <SettingRow
      label={t('chartFine.step')}
      help="advanced.chartStep"
      note={widened ? t('chartFine.widened', { step: stepLabel(answeredStep, t) }) : asked === null ? t('chartFine.stepAuto') : undefined}
    >
      <select
        className={`mono ${ui.chip}`}
        aria-label={t('chartFine.step')}
        value={asked ?? ''}
        onChange={event => change({ stepSeconds: event.target.value === '' ? null : Number(event.target.value) })}
      >
        <option value="">{t('chartFine.auto')}</option>
        {STEPS.map(step => (
          <option key={step} value={step}>
            {stepLabel(step, t)}
          </option>
        ))}
      </select>
    </SettingRow>
  );
}

const HALVES = ['all', 'day', 'night'] as const;

function VpdHalf({ settings, change }: ChartsContext) {
  const { t } = useTranslation();

  return (
    <SettingRow label={t('chartFine.vpdHalf')} help="advanced.chartVpdHalf" note={t(`chartFine.vpdHalfNote.${settings.vpdHalf}`)} wide>
      <Choices label={t('chartFine.vpdHalf')}>
        {HALVES.map(half => (
          <Choice key={half} chosen={settings.vpdHalf === half} onChoose={() => change({ vpdHalf: half })}>
            {t(`chartFine.half.${half}`)}
          </Choice>
        ))}
      </Choices>
    </SettingRow>
  );
}

function Live({ settings, change, endsNow }: ChartsContext) {
  const { t } = useTranslation();

  return (
    <SettingRow label={t('chartFine.live')} help="advanced.chartLive" note={settings.live && !endsNow ? t('chartFine.liveHeld') : undefined}>
      <button
        type="button"
        className={ui.switch}
        role="switch"
        aria-checked={settings.live}
        aria-label={t('chartFine.live')}
        onClick={() => change({ live: !settings.live })}
      >
        <span className={ui.knob} aria-hidden />
      </button>
    </SettingRow>
  );
}

export const items = [
  advancedItem({ scope: 'charts', id: 'chart-step', order: 10, shows: () => true, Item: Step }),
  advancedItem({ scope: 'charts', id: 'chart-vpd-half', order: 20, shows: ({ vpdDrawn }) => vpdDrawn, Item: VpdHalf }),
  advancedItem({ scope: 'charts', id: 'chart-live', order: 30, shows: () => true, Item: Live }),
];
