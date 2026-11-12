import { useTranslation } from 'react-i18next';
import { useDevices } from '@/api/devices';
import { useSpaceOverview } from '@/api/spaces';
import { deviceTitle } from '@/ui/naming';
import { Choice, Choices } from '@/ui/SheetParts';

/**
 * Which climate a page draws, where a place holds several: every device
 * together - the place's own pooled curves, which is what the page drew before
 * there was a choice - or one of them on its own, its lines and its band.
 * Nothing is drawn where the place holds one climate or none, or for a reader
 * who is shown the tent rather than the hardware in it.
 */
export function ClimatePicker({
  spaceId,
  chosen,
  onChoose,
  className,
}: {
  spaceId: string | null;
  chosen: string | null;
  onChoose: (deviceId: string | null) => void;
  className?: string;
}) {
  const { t } = useTranslation();
  const climates = useSpaceOverview(spaceId ?? '', spaceId !== null).data?.climates ?? [];
  const ids = climates.flatMap(climate => (climate.deviceId ? [climate.deviceId] : []));
  const devices = useDevices(ids.length > 1).data?.items;
  if (ids.length < 2) return null;

  return (
    <div className={className}>
      <Choices label={t('cockpit.devices.pick')}>
        <Choice chosen={chosen === null || !ids.includes(chosen)} onChoose={() => onChoose(null)}>
          {t('cockpit.devices.all')}
        </Choice>
        {ids.map(id => {
          const device = devices?.find(one => one.id === id);
          return (
            <Choice key={id} chosen={chosen === id} onChoose={() => onChoose(id)}>
              {device ? deviceTitle(device, t, devices) : t('cockpit.devices.waiting')}
            </Choice>
          );
        })}
      </Choices>
    </div>
  );
}
