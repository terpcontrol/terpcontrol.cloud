import { Power } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Device } from '@fg2/shared-types/v1';
import { useConfigure } from '@/api/devices';
import { isMissing, useDevicePlan, usePlanTransition } from '@/api/plans';
import { useSaved } from '@/screens/control/climate/saved';
import { Sheet } from '@/ui/Sheet';
import { Refused } from '@/ui/PageState';
import { Row } from '@/ui/Rows';
import { SheetAnswer } from '@/ui/SheetParts';
import ui from '@/ui/ui.module.css';
import { useSwitchOn } from './switch-on';
import rows from './DevicePage.module.css';
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
 * document and the device is handed it when it next connects. Both ways are
 * answered as every setting of a device is (`useSaved`): the toast says that
 * it is stored, or that the device takes it over when it next connects, and
 * switching off can be taken back there - which also resumes the plan it
 * paused.
 *
 * It is a row of the device's own page - the one place the control is switched
 * off; Steuerung says that it is off and switches it back on where the targets
 * would stand.
 */
export function ControlRow({ device, offline }: { device: Device; offline: boolean }) {
  const { t } = useTranslation();
  const saved = useSaved(device);
  const on = useSwitchOn(device);
  const [asking, setAsking] = useState(false);
  const control = device.control;
  if (!control) return null;

  const switchOn = async () => {
    if (await on.switchOn()) saved.say(`${t('climateControl.label')} ${t('climateControl.state.on')}`, null, 'control');
  };

  return (
    <>
      {control.running ? (
        <Row title={t('climateControl.offAction')} onOpen={() => setAsking(true)} />
      ) : (
        <Row
          acts
          title={t(on.pending ? 'climateControl.switching' : 'climateControl.onAction')}
          line={t(offline ? 'climateControl.onDoesLater' : on.resumes ? 'climateControl.onDoesPlan' : 'climateControl.onDoes')}
          onOpen={() => (on.pending ? undefined : void switchOn())}
        />
      )}
      {!control.running && on.error ? <Refused error={on.error} className={rows.rowSays} /> : null}
      {asking ? <ControlOffSheet device={device} onClose={() => setAsking(false)} /> : null}
    </>
  );
}

/** What stops, whether a plan is paused for it, and how it comes back on. */
function ControlOffSheet({ device, onClose }: { device: Device; onClose: () => void }) {
  const { t } = useTranslation();
  const saved = useSaved(device);
  const plan = useDevicePlan(device.id);
  const move = usePlanTransition(device.id);
  const configure = useConfigure(device.id);
  const running = plan.data?.state.status === 'running' ? plan.data : null;
  // Whether a plan has to be paused is not guessed: a plan that could not be read keeps the switch back.
  const planKnown = plan.data !== undefined || isMissing(plan.error);

  const switchOff = async () => {
    try {
      if (running) await move.mutateAsync({ kind: 'pause', reason: t('climateControl.pauseReason') });
      await configure.mutateAsync({ control: false });
      saved.say(
        `${t('climateControl.label')} ${t('climateControl.state.off')}`,
        async () => {
          await configure.mutateAsync({ control: true });
          if (running) await move.mutateAsync({ kind: 'resume' });
        },
        'control',
      );
      onClose();
    } catch {
      // Shown under the buttons, from the mutation that refused.
    }
  };

  const busy = move.isPending || configure.isPending;
  const actions = (
    <SheetAnswer done={false} error={move.error ?? configure.error ?? (planKnown ? null : plan.error)} onClose={onClose}>
      <button type="button" className={`${ui.button} ${ui.primary}`} disabled={busy || !planKnown} onClick={() => void switchOff()}>
        <Power size={16} strokeWidth={1.75} aria-hidden />
        {t(busy ? 'climateControl.switching' : 'climateControl.yes')}
      </button>
    </SheetAnswer>
  );

  return (
    <Sheet title={t('climateControl.title')} onClose={onClose} actions={actions}>
      <div className={styles.body}>
        <p>{t(`climateControl.stops.${device.type === 'fridge' ? 'fridge' : 'controller'}`)}</p>
        <p>{t('climateControl.measures')}</p>
        {running ? <p>{t('climateControl.plan', { name: running.name })}</p> : null}
        <p className={ui.note}>{t('climateControl.back')}</p>
      </div>
    </Sheet>
  );
}
