import { useEffect, useState } from 'react';
import styles from './QrCode.module.css';

/**
 * A QR code drawn as an SVG, for an address that is handed over by holding a
 * phone up to another one.
 *
 * The encoder is loaded when the first code is asked for and not before: the
 * app draws one on a single sheet, and the bundle every other screen loads
 * should not carry it. Until it has answered there is a square of the same
 * size, so that the sheet does not jump when the code arrives.
 *
 * The modules are dark on a light ground whatever the theme, through the two
 * tokens the theme file keeps constant for exactly this: a camera reads a
 * printed code, and a code inverted to suit dark mode is read by some phones
 * and not by others. The quiet zone around it is part of the drawing rather
 * than of the layout, because the encoder counts it as part of the code.
 */
export function QrCode({ value, label }: { value: string; label: string }) {
  const [drawn, setDrawn] = useState<{ size: number; path: string } | null>(null);

  useEffect(() => {
    let stale = false;
    void import('uqr').then(({ encode }) => {
      if (stale) return;
      const { size, data } = encode(value, { ecc: 'M', border: 4 });
      const path = data.map((row, y) => row.map((dark, x) => (dark ? `M${x} ${y}h1v1h-1z` : '')).join('')).join('');
      setDrawn({ size, path });
    });

    return () => {
      stale = true;
    };
  }, [value]);

  if (!drawn) return <div className={styles.qr} aria-busy="true" />;

  return (
    <svg className={styles.qr} viewBox={`0 0 ${drawn.size} ${drawn.size}`} role="img" aria-label={label} shapeRendering="crispEdges">
      <rect width={drawn.size} height={drawn.size} className={styles.paper} />
      <path d={drawn.path} className={styles.ink} />
    </svg>
  );
}
