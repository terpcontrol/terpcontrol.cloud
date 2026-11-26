import { useTranslation } from 'react-i18next';
import type { Device } from '@fg2/shared-types/v1';
import { useConfigure } from '@/api/devices';
import { useDevicePlan, usePlanTransition } from '@/api/plans';
import { saidInAnyLanguage } from '@/i18n/i18n';
import { useSaved } from '@/screens/control/climate/saved';

/**
 * Switching control back on, and with it the plan the switch paused: off
 * pauses a running plan so that its next step does not switch the device on
 * again, and on is the end of that. Left paused behind it, the plan stood still
 * without a word. A plan paused for anything else stays paused. It is answered
 * as every setting of a device is (`useSaved`), with the plan that goes on
 * named; `later` is a device that is not there to hear it.
 */
export const useSwitchOn = (device: Device) => {
  const { t, i18n } = useTranslation();
  const saved = useSaved(device);
  const configure = useConfigure(device.id);
  const plan = useDevicePlan(device.id);
  const move = usePlanTransition(device.id);
  const state = plan.data?.state;
  const resumes = state?.status === 'paused' && saidInAnyLanguage(i18n, 'climateControl.pauseReason', state.pauseReason);

  const switchOn = async () => {
    try {
      await configure.mutateAsync({ control: true });
      if (resumes) await move.mutateAsync({ kind: 'resume' });
      saved.say(
        `${t('climateControl.label')} ${t('climateControl.state.on')}`,
        null,
        'control',
        resumes ? { now: t('control.saved.planGoesOn') } : undefined,
        true,
      );
    } catch {
      // Shown beside the button, from the mutation that refused.
    }
  };

  return { switchOn, resumes, later: saved.offline, pending: configure.isPending || move.isPending, error: configure.error ?? move.error };
};
