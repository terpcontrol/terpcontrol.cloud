import { Injectable } from '@angular/core';

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

/**
 * Home-screen installation of the web app. Chromium browsers fire
 * `beforeinstallprompt` (only over HTTPS/localhost); we stash the event and
 * replay it when the user taps the menu entry. iOS Safari has no prompt API
 * at all, so callers fall back to add-to-home-screen instructions.
 */
@Injectable({ providedIn: 'root' })
export class PwaInstallService {
  private deferredPrompt: InstallPromptEvent | null = null;
  private installedThisSession = false;

  constructor() {
    window.addEventListener('beforeinstallprompt', event => {
      event.preventDefault();
      this.deferredPrompt = event as InstallPromptEvent;
    });
    window.addEventListener('appinstalled', () => {
      this.deferredPrompt = null;
      this.installedThisSession = true;
    });
  }

  /** Already running from the home screen — no point offering installation. */
  get isStandalone(): boolean {
    return (
      this.installedThisSession ||
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as any).standalone === true
    );
  }

  get isIos(): boolean {
    const userAgent = window.navigator.userAgent;
    // iPadOS 13+ masquerades as macOS but reports touch points.
    return /iPad|iPhone|iPod/.test(userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }

  /**
   * Shows the browser's install dialog. Returns false only when no native
   * prompt is available, so the caller can offer manual instructions instead.
   * A dismissed dialog still returns true: the browser handled the
   * interaction, and instructions on top of a fresh "no" would be noise.
   */
  async promptInstall(): Promise<boolean> {
    const prompt = this.deferredPrompt;
    if (!prompt) {
      return false;
    }
    await prompt.prompt();
    const choice = await prompt.userChoice;
    if (choice.outcome === 'accepted') {
      this.deferredPrompt = null;
      return true;
    }
    // Dismissed: the browser handled the interaction — no fallback needed.
    return true;
  }
}
