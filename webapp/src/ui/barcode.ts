import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * The platform's own QR reader, where there is one. It is not in every
 * browser, so a scan asks `canScan()` first and says so where it is missing
 * rather than showing a button that does nothing.
 */
interface BarcodeDetectorLike {
  detect(source: HTMLVideoElement): Promise<{ rawValue: string }[]>;
}

declare global {
  interface Window {
    BarcodeDetector?: new (options: { formats: string[] }) => BarcodeDetectorLike;
  }
}

const canScan = (): boolean => typeof window !== 'undefined' && !!window.BarcodeDetector && !!navigator.mediaDevices?.getUserMedia;

/**
 * The scan offered beside a code field: `scan` opens the reader, or says why
 * there is none; `scanner` is what the screen hands <QrScanner> while it is
 * open; `note` says why a scan did not happen. The handlers keep their
 * identity while `onCode` keeps its own, because the reader restarts the
 * camera whenever they change.
 */
export const useQrScan = (onCode: (value: string) => void) => {
  const { t } = useTranslation();
  const [scanning, setScanning] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const found = useCallback(
    (value: string) => {
      setScanning(false);
      onCode(value);
    },
    [onCode],
  );
  const onClose = useCallback(() => setScanning(false), []);
  const onFailed = useCallback(() => {
    setScanning(false);
    setNote(t('home.addDevice.scanDenied'));
  }, [t]);

  const scan = () => {
    if (!canScan()) return setNote(t('home.addDevice.scanUnavailable'));
    setNote(null);
    setScanning(true);
  };

  return { scan, note, scanner: scanning ? { onCode: found, onClose, onFailed } : null };
};
