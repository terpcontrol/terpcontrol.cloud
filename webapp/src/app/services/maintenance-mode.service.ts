import { Injectable } from '@angular/core';
import { AlertController, AlertInput, ToastController } from '@ionic/angular';
import { TranslateService } from '@ngx-translate/core';
import { DeviceService } from './devices.service';
import { isDemoWriteBlocked } from '../auth/auth.interceptor';

/** Offered durations in minutes; 0 ends the maintenance window immediately. */
const DURATIONS_MINUTES = Array.from({ length: 24 }, (_, index) => (index + 1) * 5);

@Injectable({ providedIn: 'root' })
export class MaintenanceModeService {
  constructor(
    private devices: DeviceService,
    private alertController: AlertController,
    private toastController: ToastController,
    private translate: TranslateService,
  ) {}

  /**
   * Asks for a duration and activates (or ends) maintenance mode.
   * Resolves with the new "until" timestamp, or null when nothing changed.
   */
  async promptFor(deviceId: string, currentUntil = 0): Promise<number | null> {
    const inputs: AlertInput[] = [
      {
        label: this.translate.instant('devices.maintenance.deactivate'),
        type: 'radio',
        value: 0,
        checked: currentUntil <= 0,
      },
      ...DURATIONS_MINUTES.map(minutes => ({
        label: this.translate.instant('devices.maintenance.minutes', { minutes }),
        type: 'radio' as const,
        value: minutes,
      })),
    ];

    let result: number | null = null;

    const alert = await this.alertController.create({
      header: this.translate.instant('devices.maintenance.title'),
      message: this.translate.instant('devices.maintenance.text'),
      inputs,
      buttons: [
        { text: this.translate.instant('misc.cancel'), role: 'cancel' },
        {
          text: this.translate.instant('misc.save'),
          handler: async (minutes: number) => {
            try {
              await this.devices.activateMaintenanceMode(deviceId, minutes);
              result = minutes <= 0 ? 0 : Date.now() + minutes * 60 * 1000;
              await this.toast(
                this.translate.instant(
                  minutes <= 0 ? 'devices.maintenance.deactivated' : 'devices.maintenance.activated',
                  { minutes },
                ),
              );
              return true;
            } catch (error: any) {
              if (isDemoWriteBlocked(error)) {
                return true;
              }
              console.log('Failed to activate maintenance mode:', error);
              await this.toast(this.translate.instant('devices.maintenance.failed'));
              return false;
            }
          },
        },
      ],
    });

    await alert.present();
    await alert.onDidDismiss();
    return result;
  }

  private async toast(message: string) {
    const toast = await this.toastController.create({ message, duration: 5000 });
    await toast.present();
  }
}
