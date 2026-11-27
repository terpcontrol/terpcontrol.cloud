import { Power } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Device } from '@fg2/shared-types/v1';
import { useConfigure } from '@/api/devices';
import { isMissing, useDevicePlan, usePlanTransition } from '@/api/plans';
import { useSaved } from '@/screens/control/climate/saved';
import { Sheet } from '@/ui/Sheet';
import { Row } from '@/ui/Rows';
import { SheetAnswer } from '@/ui/SheetParts';
import ui from '@/ui/ui.module.css';
import styles from './Maintenance.module.css';

/**
 * Regelung ausschalten: the whole of a fridge's or a controller's climate
 * control, switched off for an empty cabinet, a clean or the weeks between two
 * grows. A row of the device's own page, the one place it is switched off;
 * where it is off, the page says so and switches it back on as Steuerung does
 * (`ControlOff`).
 *
 * Off is asked first, because it stops the heater, the cooling, the light, the
 * CO2 and the fans at once and they stay stopped - the same list Steuerung's
 * note says while it is off. Its yes is the one danger style. A running plan
 * is paused with it - its next step would switch the control back on, as
 * saving the targets or applying a preset does. A device that is not
 * answering is still switched, and answered as every setting of a device is
 * (`useSaved`).
 */
export function ControlRow({ device }: { device: Device }) {
  const { t } = useTranslation();
  const [asking, setAsking] = useState(false);
  if (!device.control?.running) return null;

  return (
    <>
      <Row title={t('climateControl.offAction')} onOpen={() => setAsking(true)} />
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
      const undo = async () => {
        await configure.mutateAsync({ control: true });
        if (running) await move.mutateAsync({ kind: 'resume' });
      };
      saved.say(
        `${t('climateControl.label')} ${t('climateControl.state.off')}`,
        { undo, undone: `${t('climateControl.label')} ${t('climateControl.state.on')}` },
        'control',
        running ? { now: t('control.saved.planPaused'), back: t('control.saved.planGoesOn') } : undefined,
        true,
      );
      onClose();
    } catch {
      // Shown under the buttons, from the mutation that refused.
    }
  };

  const busy = move.isPending || configure.isPending;
  const actions = (
    <SheetAnswer done={false} error={move.error ?? configure.error ?? (planKnown ? null : plan.error)} onClose={onClose}>
      <button type="button" className={`${ui.button} ${ui.dangerFilled}`} disabled={busy || !planKnown} onClick={() => void switchOff()}>
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
