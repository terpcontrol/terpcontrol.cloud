import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import '@/ui/barcode';
import { useModalFocus } from './modal-focus';
import ui from './ui.module.css';
import styles from './QrScanner.module.css';

interface QrScannerProps {
  onCode: (value: string) => void;
  onClose: () => void;
  /**
   * The camera could not be opened at all. Permission is the usual reason and
   * cannot be asked about before the attempt, so the screen that offered the
   * scan is the one that says why nothing happened; without this the overlay
   * would simply vanish and leave the button looking broken.
   */
  onFailed?: (error: unknown) => void;
}

/** A full-screen camera view that hands back the first QR code it sees. */
export function QrScanner({ onCode, onClose, onFailed }: QrScannerProps) {
  const { t } = useTranslation();
  const video = useRef<HTMLVideoElement>(null);
  const overlay = useModalFocus<HTMLDivElement>(onClose);
  // Held in a ref so that a caller writing the handler inline does not restart
  // the camera on every render of the screen behind the overlay.
  const failed = useRef(onFailed);
  useEffect(() => {
    failed.current = onFailed;
  }, [onFailed]);

  useEffect(() => {
    const element = video.current;
    const Detector = window.BarcodeDetector;
    const give = (error: unknown) => (failed.current ? failed.current(error) : onClose());
    if (!element) return;
    if (!Detector) return give(new Error('no barcode detector'));

    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    let done = false;
    const detector = new Detector({ formats: ['qr_code'] });

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment' } })
      .then(async media => {
        if (done) return media.getTracks().forEach(track => track.stop());
        stream = media;
        element.srcObject = media;
        await element.play();
        timer = setInterval(async () => {
          const codes = await detector.detect(element).catch(() => []);
          if (codes[0] && !done) {
            done = true;
            onCode(codes[0].rawValue);
          }
        }, 250);
      })
      .catch(give);

    return () => {
      done = true;
      if (timer) clearInterval(timer);
      stream?.getTracks().forEach(track => track.stop());
    };
  }, [onCode, onClose]);

  return (
    <div className={styles.overlay} ref={overlay} role="dialog" aria-modal="true" aria-label={t('home.addDevice.scan')} tabIndex={-1}>
      <video ref={video} className={styles.video} muted playsInline />
      <p className={`mono ${styles.hint}`}>{t('home.addDevice.scanHint')}</p>
      <button type="button" className={ui.button} onClick={onClose}>
        {t('home.addDevice.cancel')}
      </button>
    </div>
  );
}
