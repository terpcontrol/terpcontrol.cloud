import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class ThemeService {
  private readonly storageKey = 'app-dark-mode';

  public darkMode = false;

  constructor() {
    this.apply(localStorage.getItem(this.storageKey) === 'true');
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
