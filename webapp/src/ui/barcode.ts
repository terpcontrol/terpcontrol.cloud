/**
 * The platform's own QR reader, where there is one. It is not in every
 * browser, so a screen asks `canScan()` first and says so where it is missing
 * rather than showing a button that does nothing.
 */
export interface BarcodeDetectorLike {
  detect(source: HTMLVideoElement): Promise<{ rawValue: string }[]>;
}

declare global {
  interface Window {
    BarcodeDetector?: new (options: { formats: string[] }) => BarcodeDetectorLike;
  }
}

export const canScan = (): boolean => typeof window !== 'undefined' && !!window.BarcodeDetector && !!navigator.mediaDevices?.getUserMedia;
