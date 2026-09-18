import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import '@/ui/barcode';
import ui from './ui.module.css';
import styles from './QrScanner.module.css';

interface QrScannerProps {
  onCode: (value: string) => void;
  onClose: () => void;
}

/** A full-screen camera view that hands back the first QR code it sees. */
export function QrScanner({ onCode, onClose }: QrScannerProps) {
  const { t } = useTranslation();
  const video = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const element = video.current;
    const Detector = window.BarcodeDetector;
    if (!element || !Detector) return;

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
      .catch(onClose);

    return () => {
      done = true;
      if (timer) clearInterval(timer);
      stream?.getTracks().forEach(track => track.stop());
    };
  }, [onCode, onClose]);

  return (
    <div className={styles.overlay} role="dialog" aria-label={t('home.addDevice.scan')}>
      <video ref={video} className={styles.video} muted playsInline />
      <p className={`mono ${styles.hint}`}>{t('home.addDevice.scanHint')}</p>
      <button type="button" className={ui.button} onClick={onClose}>
        {t('home.addDevice.cancel')}
      </button>
    </div>
  );
}
