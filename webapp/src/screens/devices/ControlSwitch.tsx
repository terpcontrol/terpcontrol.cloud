import { Power } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Device } from '@fg2/shared-types/v1';
import { useConfigure } from '@/api/devices';
import { isMissing, useDevicePlan, usePlanTransition } from '@/api/plans';
import { Sheet } from '@/log/Sheet';
import { Refused } from '@/ui/PageState';
import ui from '@/ui/ui.module.css';
import { TwoLines } from './Maintenance';
import styles from './Maintenance.module.css';

/**
 * Regelung ein/aus: the whole of a fridge's or a controller's climate control,
 * switched off for an empty cabinet, a clean or the weeks between two grows,
 * and on again.
 *
 * Off is asked first, because it stops the heater, the cooling, the light and
 * the CO2 at once and they stay stopped. A running plan is paused with it - the
 * plan's next step would switch the control back on, which is what saving the
 * targets or applying a preset does too, and what the question says. On is one
 * tap: it is the state everything else in the app assumes.
 *
 * A device that is not answering is still switched: the server keeps the
 * document and the device is handed it when it next connects, and the receipt
 * says so.
 */
export function ControlButton({ device, offline, className }: { device: Device; offline: boolean; className?: string }) {
  const { t } = useTranslation();
  const configure = useConfigure(device.id);
  const [asking, setAsking] = useState(false);
  const control = device.control;
  if (!control) return null;

  return (
    <>
      {control.running ? (
        <TwoLines
          Icon={Power}
          name={t('climateControl.offAction')}
          does={t(`climateControl.offDoes.${device.type === 'fridge' ? 'fridge' : 'controller'}`)}
          className={className}
          onClick={() => setAsking(true)}
        />
      ) : (
        <TwoLines
          Icon={Power}
          name={t(configure.isPending ? 'climateControl.switching' : 'climateControl.onAction')}
          does={t(offline ? 'climateControl.onDoesLater' : 'climateControl.onDoes')}
          disabled={configure.isPending}
          className={`${ui.primary} ${styles.filled} ${className ?? ''}`}
          onClick={() => configure.mutate({ control: true })}
        />
      )}
      {!control.running ? <Refused error={configure.error} /> : null}
      {asking ? <ControlOffSheet device={device} offline={offline} onClose={() => setAsking(false)} /> : null}
    </>
  );
}

/** What stops, whether a plan is paused for it, and how it comes back on; then what happened. */
function ControlOffSheet({ device, offline, onClose }: { device: Device; offline: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const plan = useDevicePlan(device.id);
  const move = usePlanTransition(device.id);
  const configure = useConfigure(device.id);
  const running = plan.data?.state.status === 'running' ? plan.data : null;
  // Whether a plan has to be paused is not guessed: a plan that could not be read keeps the switch back.
  const planKnown = plan.data !== undefined || isMissing(plan.error);
  const done = configure.isSuccess;

  const switchOff = async () => {
    try {
      if (running) await move.mutateAsync({ kind: 'pause', reason: t('climateControl.pauseReason') });
      await configure.mutateAsync({ control: false });
    } catch {
      // Shown under the buttons, from the mutation that refused.
    }
  };

  const busy = move.isPending || configure.isPending;
  const actions = done ? (
    <button type="button" className={`${ui.button} ${ui.primary}`} onClick={onClose}>
      {t('maintenance.done')}
    </button>
  ) : (
    <>
      <Refused error={move.error ?? configure.error ?? (planKnown ? null : plan.error)} />
      <button type="button" className={`${ui.button} ${ui.primary}`} disabled={busy || !planKnown} onClick={() => void switchOff()}>
        <Power size={16} strokeWidth={1.75} aria-hidden />
        {t(busy ? 'climateControl.switching' : 'climateControl.yes')}
      </button>
      <button type="button" className={ui.button} onClick={onClose}>
        {t('maintenance.cancel')}
      </button>
    </>
  );

  return (
    <Sheet title={t('climateControl.title')} onClose={onClose} actions={actions}>
      <div className={styles.body} role={done ? 'status' : undefined}>
        {done ? (
          <>
            <p>{t('climateControl.done')}</p>
            {offline ? <p className={ui.note}>{t('climateControl.unheard')}</p> : null}
          </>
        ) : (
          <>
            <p>{t(`climateControl.stops.${device.type === 'fridge' ? 'fridge' : 'controller'}`)}</p>
            <p>{t('climateControl.measures')}</p>
            {running ? <p>{t('climateControl.plan', { name: running.name })}</p> : null}
            <p className={ui.note}>{t('climateControl.back')}</p>
          </>
        )}
      </div>
    </Sheet>
  );
}
