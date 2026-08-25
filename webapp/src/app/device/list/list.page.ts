import { Component, OnInit } from '@angular/core';
import { ToastController } from '@ionic/angular';
import { TranslateService } from '@ngx-translate/core';
import type { Zelt } from '@fg2/shared-types';
import { DataService } from 'src/app/services/data.service';
import { DevicesLoadState, DeviceWithParsedSettings, DeviceService } from 'src/app/services/devices.service';
import { ZelteService } from 'src/app/services/dinge.service';

@Component({
  selector: 'app-list',
  templateUrl: './list.page.html',
  styleUrls: ['./list.page.scss'],
})
export class ListPage implements OnInit {


  public all_devices:DeviceWithParsedSettings[] = [];
  /**
   * The tents this account keeps. They are the way into `/z/:zelt_id` - the
   * diary is a place of its own and a tent with no device has no device page to
   * be reached through.
   */
  public zelte: Zelt[] = [];
  public loadState: DevicesLoadState = 'loading';
  public id:string = '';
  public claiming = false;
  public wizardDevice: DeviceWithParsedSettings | null = null;
  /** Dashboard mode: the claim input stays tucked behind "+ add device". */
  public showClaimInput = false;

  get loading(): boolean {
    return this.loadState === 'loading';
  }

  /**
   * Most users own exactly one device — the page then acts as that device's
   * dashboard (its name in the header, claim input collapsed) instead of a
   * one-item list. A second device switches back to the normal list.
   */
  get singleDevice(): DeviceWithParsedSettings | null {
    return !this.loading && this.all_devices.length === 1 ? this.all_devices[0] : null;
  }

  constructor(
    private deviceService: DeviceService,
    public data: DataService,
    private toastController: ToastController,
    private translate: TranslateService,
    private zelteService: ZelteService,
  ) { }

  ngOnInit(): void {
    this.deviceService.devices.subscribe(devices => this.all_devices = devices);
    this.deviceService.loadState.subscribe(loadState => this.loadState = loadState);
    void this.loadZelte();
  }

  /** A tent list that cannot be read is simply absent; it is a way in, not the page. */
  private async loadZelte(): Promise<void> {
    try {
      this.zelte = await this.zelteService.zelte();
    } catch (error) {
      this.zelte = [];
    }
  }

  retry() {
    void this.deviceService.refetchDevices();
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
