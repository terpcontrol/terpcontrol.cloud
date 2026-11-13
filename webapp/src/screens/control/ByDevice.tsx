import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import type { Device } from '@fg2/shared-types/v1';
import { Facts } from '@/ui/Facts';
import { useKept } from '@/ui/kept';
import { deviceTitle } from '@/ui/naming';
import { Row } from '@/ui/Rows';
import type { RowLine } from './rows';
import styles from './Control.module.css';

/**
 * A page behind one of Steuerung's rows, device by device. `devices` come in
 * Steuerung's order: the first stands open, every further one is a row that
 * says its state and unfolds in place, and one alone has no name over it. A
 * device with nothing for the page is not handed in.
 *
 * `?device=` names a device to open unfolded, `unfolded` another the page
 * itself wants open - the one holding the alarm rule a link named.
 */
export function ByDevice({
  devices,
  line,
  unfolded = null,
  children,
}: {
  devices: Device[];
  /** What a folded device's row says about what is behind it. */
  line: (device: Device) => RowLine | null;
  unfolded?: string | null;
  children: (device: Device) => ReactNode;
}) {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const asked = params.get('device') ?? unfolded;
  const [first, ...others] = devices;
  if (!first) return null;
  const name = (device: Device) => deviceTitle(device, t, devices);

  return (
    <div className={styles.page}>
      <section className={styles.block} aria-label={name(first)}>
        {others.length > 0 ? <h2 className={styles.blockTitle}>{name(first)}</h2> : null}
        {children(first)}
      </section>
      {others.map(device => (
        <Folded key={device.id} id={device.id} title={name(device)} line={line(device)} asked={asked === device.id}>
          {() => children(device)}
        </Folded>
      ))}
    </div>
  );
}

/** How long a device a link named is followed into view while what stands above it is read. */
const FOLLOW_MS = 4000;

/**
 * Brings a block to the top of the window and keeps it there while the page
 * above it grows - the place's own device is still being read when the page
 * opens - until that has had its time or somebody scrolls.
 */
const follow = (block: HTMLElement) => {
  const bring = () => block.scrollIntoView?.({ block: 'start' });
  bring();
  const above = new ResizeObserver(bring);
  if (block.parentElement) above.observe(block.parentElement);
  const inputs = ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const;
  const stop = () => {
    above.disconnect();
    for (const input of inputs) window.removeEventListener(input, stop);
  };
  for (const input of inputs) window.addEventListener(input, stop, { passive: true });
  window.setTimeout(stop, FOLLOW_MS);
};

function Folded({
  id,
  title,
  line,
  asked,
  children,
}: {
  id: string;
  title: string;
  line: RowLine | null;
  asked: boolean;
  children: () => ReactNode;
}) {
  const [open, setOpen] = useKept(`device-${id}`, asked);
  // A link that names the device brings it into view, once per history entry: coming back finds the page as it was left.
  const [arrived, setArrived] = useKept(`arrived-${id}`, false);
  const arrive = (block: HTMLElement | null) => {
    if (!block || !asked || arrived) return;
    setArrived(true);
    follow(block);
  };

  return (
    <section ref={arrive} className={styles.block} aria-label={title}>
      <h2 className={styles.foldHead}>
        <Row
          alone
          title={title}
          line={line && !open ? <Facts facts={line.text.split(' · ')} /> : null}
          warn={line?.warn}
          unfolded={open}
          onOpen={() => setOpen(!open)}
        />
      </h2>
      {open ? children() : null}
    </section>
  );
}
