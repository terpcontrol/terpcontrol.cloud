import { Component, OnInit } from '@angular/core';
import { ToastController } from '@ionic/angular';
import { TranslateService } from '@ngx-translate/core';
import { DataService } from 'src/app/services/data.service';
import { DeviceWithParsedSettings, DeviceService } from 'src/app/services/devices.service';

@Component({
  selector: 'app-list',
  templateUrl: './list.page.html',
  styleUrls: ['./list.page.scss'],
})
export class ListPage implements OnInit {


  public all_devices:DeviceWithParsedSettings[] = [];
  public id:string = '';
  public loading = true;
  public claiming = false;
  public wizardDevice: DeviceWithParsedSettings | null = null;

  private reloaded = false;

  constructor(
    private deviceService: DeviceService,
    public data: DataService,
    private toastController: ToastController,
    private translate: TranslateService,
  ) { }

  ngOnInit(): void {
    this.deviceService.devices.subscribe(devices => {
      if (devices.length <= 0 && !this.reloaded) {
        this.reloaded = true;
        setTimeout(() => {
          if (!this.all_devices?.length) {
            void this.deviceService.refetchDevices().finally(() => this.loading = false);
          }
        }, 2000);
      } else {
        this.reloaded = false;
        this.all_devices = devices;
        this.loading = false;
      }
    });

    // Failsafe so a failed fetch shows the empty state instead of a spinner forever.
    setTimeout(() => this.loading = false, 8000);
  }

  async claimDevice() {
    const code = this.id.trim().toUpperCase();
    if (!code || this.claiming) {
      return;
    }

    this.claiming = true;
    try {
      const device = await this.deviceService.claim(code);
      this.id = '';
      if (device) {
        this.wizardDevice = device;
      }
    } catch (error) {
      console.log('Claiming failed:', error);
      const toast = await this.toastController.create({
        message: this.translate.instant('onboarding.claimFailed'),
        duration: 4000,
        position: 'top',
        color: 'danger',
      });
      await toast.present();
    } finally {
      this.claiming = false;
    }
  }

  openWizard(device: DeviceWithParsedSettings) {
    this.wizardDevice = device;
  }

  closeWizard() {
    this.wizardDevice = null;
  }
}
