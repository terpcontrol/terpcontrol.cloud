import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class ThemeService {
  private readonly storageKey = 'app-dark-mode';

  public darkMode = false;

  constructor() {
    const stored = localStorage.getItem(this.storageKey);
    if (stored !== null) {
      this.apply(stored === 'true');
    } else {
      this.apply(window.matchMedia('(prefers-color-scheme: dark)').matches);
    }

    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
      if (localStorage.getItem(this.storageKey) === null) {
        this.apply(e.matches);
      }
    });
  }

  public toggle() {
    this.set(!this.darkMode);
  }

  public set(enabled: boolean) {
    this.apply(enabled);
    localStorage.setItem(this.storageKey, String(enabled));
  }

  private apply(enabled: boolean) {
    this.darkMode = enabled;
    document.body.classList.toggle('dark', enabled);
  }
}
