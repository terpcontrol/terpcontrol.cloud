import { Power } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Device } from '@fg2/shared-types/v1';
import { workModesOf } from '@fg2/shared-types/v1-schemas/configuration-fields.js';
import { controlPath, devicePath } from '@/app/places';
import { Announce } from '@/ui/Announce';
import { Help } from '@/ui/Help';
import { deviceName } from '@/ui/naming';
import { Refused } from '@/ui/PageState';
import { Row, Rows } from '@/ui/Rows';
import ui from '@/ui/ui.module.css';
import { useNow } from '@/ui/useNow';
import { useZone } from '@/ui/zone';
import { useSwitchOn } from '../devices/switch-on';
import { pendingMode, savedWords } from './climate/figures';
import { ByDevice, NothingHere } from './ByDevice';
import { useSettings } from './climate/saved';
import { ChoiceSetting, SettingLine, SettingsBlock, SwitchSetting } from './devices/Settings';
import { useLeads } from './lead';
import { hasMode, modeLine, modesOf } from './rows';
import styles from './Control.module.css';
import own from './devices/Own.module.css';

/**
 * Betriebsart: the work modes no climate preset sets, and a fridge's energy
 * saving. Germination and drying follow the stage, so the climate preset
 * alone starts and ends them; running, they are read here with the way there.
 */

export function ModePage({ spaceId, devices, mayManage }: { spaceId: string; devices: Device[]; mayManage: boolean }) {
  const { t } = useTranslation();
  const now = useNow();
  const zone = useZone();
  const moded = devices.filter(hasMode);

  // A tent controller has no mode to choose: what is left to say is where its stage's mode is set. A socket, a lamp and a fan have none at all.
  if (moded.length === 0) {
    return (
      <NothingHere to={controlPath(spaceId)} where={t('control.back')}>
        {t('control.mode.none')}
        {devices.some(device => workModesOf(device.type).length > 0) ? ` ${t('control.mode.byPreset')}` : null}
      </NothingHere>
    );
  }

  return (
    <ByDevice devices={moded} line={device => modeLine(t, device, now, zone)}>
      {device => <DeviceMode device={device} mayManage={mayManage} />}
    </ByDevice>
  );
}

function DeviceMode({ device, mayManage }: { device: Device; mayManage: boolean }) {
  const { t } = useTranslation();
  const settings = useSettings(device);
  const leads = useLeads(device);
  const control = device.control;
  if (!control) return null;
  if (!control.running) return <ControlOff device={device} mayManage={mayManage} />;

  const held = pendingMode(t, device, settings.pending);
  const pending = held ? [held] : [];
  const title = t('operatingMode.label');
  // A mode the stage brought is the climate preset's to end, where the device's climate is set.
  const spell = control.drying ? 'drying' : control.mode === 'germination' ? 'germination' : null;
  if (spell) {
    return (
      <>
        <SettingsBlock label={title} pending={pending}>
          <SettingLine label={title} help={spell}>
            <span className={own.read}>{t(`operatingMode.${spell}`)}</span>
          </SettingLine>
        </SettingsBlock>
        {mayManage ? (
          <Rows>
            <Row
              to={leads && device.spaceId ? controlPath(device.spaceId) : devicePath(device.id)}
              title={t('operatingMode.toPreset')}
              line={t('operatingMode.byPreset')}
            />
          </Rows>
        ) : null}
      </>
    );
  }

  const modes = modesOf(device);
  const shared = { device, settings, mayManage };
  return (
    <SettingsBlock label={title} pending={pending} error={settings.error}>
      {modes.length > 1 ? (
        <ChoiceSetting
          {...shared}
          name="mode"
          label={title}
          help="advanced.operatingMode"
          options={modes.map(mode => ({ value: mode, label: t(`operatingMode.${mode}`) }))}
          says={mode => t(`operatingMode.${mode}Note`)}
        />
      ) : null}
      {/* Energy saving belongs to a day and night of the standard mode. */}
      {device.type === 'fridge' && control.mode === 'standard' ? (
        <SwitchSetting {...shared} name="energySaving" label={t('energySaving.label')} help="energySaving" />
      ) : null}
    </SettingsBlock>
  );
}

/**
 * A device whose control is switched off, said where its climate would stand -
 * on Steuerung, and on the page of a device that leads a place - with the one
 * tap that switches it on and what that brings back; off is switched on the
 * device's page.
 *
 * Switched off while the device was not heard (`storedAt`), off is a setting
 * it has not been handed like any other: the sentence says since when it is
 * stored and that the device goes on regulating, and the cards under it stay.
 */
export function ControlOff({ device, mayManage, storedAt = null }: { device: Device; mayManage: boolean; storedAt?: string | null }) {
  const { t } = useTranslation();
  const now = useNow();
  const zone = useZone();
  const on = useSwitchOn(device);
  const kind = device.type === 'fridge' || device.type === 'controller' ? device.type : 'other';

  return (
    <div className={styles.state} data-tone="warn" role={storedAt ? 'status' : undefined}>
      <p>
        {storedAt ? (
          t('control.pending.off', { saved: savedWords(t, storedAt, now, zone), device: deviceName(device, t) })
        ) : (
          <>
            <strong>{t('control.state.off')}.</strong> {t(mayManage ? `climateControl.offLine.${kind}` : 'climateControl.offLineRead')}
            {mayManage && on.resumes ? ` ${t('climateControl.onDoesPlan')}` : null}
            {mayManage && on.later ? ` ${t('climateControl.onDoesLater')}` : null}
          </>
        )}
        <Help topic="climateControl" />
      </p>
      {mayManage ? (
        <button type="button" className={`${ui.button} ${storedAt ? '' : ui.primary}`} disabled={on.pending} onClick={() => void on.switchOn()}>
          <Power size={16} strokeWidth={1.75} aria-hidden />
          {t(on.pending ? 'climateControl.switching' : 'climateControl.onAction')}
        </button>
      ) : null}
      <Refused error={on.error} />
      <Announce text={on.pending && t('climateControl.switching')} />
    </div>
  );
}
