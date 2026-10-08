import { useTranslation } from 'react-i18next';
import type { Device } from '@fg2/shared-types/v1';
import { useConfigure } from '@/api/devices';
import { useDevicePlan, usePlanTransition } from '@/api/plans';
import { saidInAnyLanguage } from '@/i18n/i18n';

/**
 * Switching control back on, and with it the plan the switch paused: off
 * pauses a running plan so that its next step does not switch the device on
 * again, and on is the end of that. Left paused behind it, the plan stood still
 * without a word. A plan paused for anything else stays paused.
 */
export const useSwitchOn = (device: Device) => {
  const { i18n } = useTranslation();
  const configure = useConfigure(device.id);
  const plan = useDevicePlan(device.id);
  const move = usePlanTransition(device.id);
  const state = plan.data?.state;
  const resumes = state?.status === 'paused' && saidInAnyLanguage(i18n, 'climateControl.pauseReason', state.pauseReason);

  const switchOn = async () => {
    try {
      await configure.mutateAsync({ control: true });
      if (resumes) await move.mutateAsync({ kind: 'resume' });
    } catch {
      // Shown beside the button, from the mutation that refused.
    }
  };

  return { switchOn, resumes, pending: configure.isPending || move.isPending, error: configure.error ?? move.error };
};
