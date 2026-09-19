import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import type { DeviceClaimCreate } from '@fg2/shared-types/v1';
import { claimCodeOf, useClaimDevice } from '@/api/claims';
import { ApiError } from '@/api/problem';
import { Sheet } from '@/log/Sheet';
import { useMayManage } from '@/ui/session-access';
import ui from '@/ui/ui.module.css';
import { DeviceList } from './DeviceList';
import styles from './Devices.module.css';

/**
 * The fourth tab: every controller, every camera and every smart socket this
 * account has. The tent page carries the same list narrowed to one place.
 */
export function Devices() {
  const { t } = useTranslation();
  const mayManage = useMayManage();
  const [adding, setAdding] = useState(false);

  return (
    <section className={styles.page}>
      <header className={styles.head}>
        <h1 className={styles.title}>{t('shell.tabs.devices')}</h1>
        {mayManage ? (
          <button type="button" className={`${ui.button} ${styles.add}`} onClick={() => setAdding(true)}>
            + {t('devices.add')}
          </button>
        ) : null}
      </header>

      <DeviceList />

      {adding ? <AddSheet onClose={() => setAdding(false)} /> : null}
    </section>
  );
}

/**
 * The two ways something new arrives. A device is claimed with the code on its
 * display, which is this field; a camera is paired at the controller, joined to
 * Wi-Fi from the phone or given a stream address, and all three of those are
 * screens of their own that arrive with onboarding - so this says where they
 * will be rather than offering a field that leads nowhere.
 */
function AddSheet({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const claim = useClaimDevice();
  const form = useForm<DeviceClaimCreate>({ defaultValues: { code: '' } });

  const submit = form.handleSubmit(async body => {
    try {
      await claim.mutateAsync({ code: claimCodeOf(body.code).trim() });
      onClose();
    } catch (error) {
      form.setError('code', {
        message: error instanceof ApiError ? error.problem.detail || error.problem.title : t('devices.claimFailed'),
      });
    }
  });

  return (
    <Sheet title={t('devices.add')} onClose={onClose}>
      <form className={styles.addForm} onSubmit={event => void submit(event)}>
        <label className="label" htmlFor="claim-code">
          {t('devices.claimLabel')}
        </label>
        <input id="claim-code" className={ui.input} autoComplete="off" autoFocus {...form.register('code', { required: true })} />
        {form.formState.errors.code?.message ? (
          <p className={ui.problem} role="alert">
            {form.formState.errors.code.message}
          </p>
        ) : null}
        <button type="submit" className={`${ui.button} ${ui.primary}`} disabled={claim.isPending}>
          {claim.isPending ? t('devices.claiming') : t('devices.claim')}
        </button>
      </form>

      <p className={`${ui.note} ${styles.addNote}`}>{t('devices.addCameraLater')}</p>
    </Sheet>
  );
}
