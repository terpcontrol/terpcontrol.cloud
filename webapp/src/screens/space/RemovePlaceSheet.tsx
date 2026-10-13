import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SpaceOverview } from '@fg2/shared-types/v1';
import { useCameras } from '@/api/cameras';
import { useDevices } from '@/api/devices';
import { useClearAndRemoveSpace, useSpaces } from '@/api/spaces';
import { Sheet } from '@/ui/Sheet';
import { Refused } from '@/ui/PageState';
import { Block, Choice, Choices } from '@/ui/SheetParts';
import { deviceTitle } from '@/ui/naming';
import ui from '@/ui/ui.module.css';
import { placesFor } from '../devices/moving';

/**
 * Ending a place somebody no longer wants, whatever still stands in it.
 *
 * Emptying a place by hand first - each device moved, the camera, the grow -
 * is a round of errands on three screens, and a place could only be ended
 * once it was done. So the sheet says what is still here, asks for one place
 * all of it moves to, and moves it there before the place ends: the devices
 * with the cameras they answer for, a camera on its own, and a running grow
 * from today on. What was measured and written here stays readable.
 */
export function RemovePlaceSheet({ overview, onClose, onRemoved }: { overview: SpaceOverview; onClose: () => void; onRemoved: () => void }) {
  const { t } = useTranslation();
  const spaces = useSpaces();
  const devices = useDevices();
  const cameras = useCameras();
  const remove = useClearAndRemoveSpace(overview.spaceId);
  const [to, setTo] = useState<string | null>(null);

  const deviceIds = overview.deviceIds ?? [];
  const here = (devices.data?.items ?? []).filter(device => deviceIds.includes(device.id));
  // A camera on a device moves with it; only one that answers to none is moved on its own.
  const loose = (cameras.data?.items ?? []).filter(
    camera => camera.spaceId === overview.spaceId && !(camera.deviceId && deviceIds.includes(camera.deviceId)),
  );
  const grows = overview.grows;
  const holds = deviceIds.length > 0 || loose.length > 0 || grows.length > 0;
  const elsewhere = placesFor(spaces.data?.items ?? []).filter(space => space.id !== overview.spaceId && space.archivedAt === null);
  const ready = !remove.isPending && (!holds || to !== null);

  const what = [
    ...here.map(device => deviceTitle(device, t, devices.data?.items)),
    ...loose.map(camera => camera.name),
    ...grows.map(grow => t('space.remove.grow', { name: grow.name })),
  ];

  return (
    <Sheet
      title={t('space.remove.title', { name: overview.name })}
      onClose={onClose}
      actions={
        <button
          type="button"
          className={`${ui.button} ${ui.primary}`}
          disabled={!ready}
          onClick={() =>
            remove.mutate(
              { to, deviceIds, cameraIds: loose.map(camera => camera.id), growIds: grows.map(grow => grow.growId) },
              { onSuccess: onRemoved },
            )
          }
        >
          {remove.isPending ? t('space.empty.removing') : t('space.empty.remove', { name: overview.name })}
        </button>
      }
    >
      <div className={ui.sheetBody}>
        {holds ? (
          <>
            <p className={ui.note}>{t('space.remove.holds', { what: what.join(' · ') })}</p>
            <Block label={t('space.remove.to')}>
              {elsewhere.length > 0 ? (
                <Choices label={t('space.remove.to')}>
                  {elsewhere.map(space => (
                    <Choice key={space.id} chosen={to === space.id} disabled={remove.isPending} onChoose={() => setTo(space.id)}>
                      {space.name}
                    </Choice>
                  ))}
                </Choices>
              ) : (
                <p className={ui.note}>{t('space.remove.nowhere')}</p>
              )}
            </Block>
          </>
        ) : (
          <p className={ui.note}>{t('space.empty.says', { name: overview.name })}</p>
        )}
        <p className={ui.note}>{t('space.empty.note')}</p>
        <Refused error={remove.error} />
      </div>
    </Sheet>
  );
}
