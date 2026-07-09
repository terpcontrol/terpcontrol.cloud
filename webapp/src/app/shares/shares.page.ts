import { Component } from '@angular/core';
import { AlertController, ToastController } from '@ionic/angular';
import { TranslateService } from '@ngx-translate/core';
import type { ShareLink } from '@fg2/shared-types';
import { ShareService, copyToClipboard, isShareActive } from '../services/share.service';
import { DeviceService } from '../services/devices.service';

@Component({
  selector: 'app-shares',
  templateUrl: './shares.page.html',
  styleUrls: ['./shares.page.scss'],
})
export class SharesPage {
  public loading = false;
  public activeShares: ShareLink[] = [];
  public inactiveShares: ShareLink[] = [];
  public copiedShareId = '';

  constructor(
    private shares: ShareService,
    private devices: DeviceService,
    private alertController: AlertController,
    private toastController: ToastController,
    private translate: TranslateService,
  ) {}

  ionViewWillEnter() {
    void this.load();
  }

  public async load() {
    this.loading = true;
    try {
      const shares = await this.shares.list();
      this.activeShares = shares.filter(share => isShareActive(share));
      this.inactiveShares = shares.filter(share => !isShareActive(share));
    } finally {
      this.loading = false;
    }
  }

  public deviceName(share: ShareLink): string {
    const device = this.devices.devices.getValue().find(device => device.device_id === share.device_id);
    return device?.name || share.device_id;
  }

  public statusKey(share: ShareLink): string {
    if (share.revokedAt) {
      return 'share.status.revoked';
    }
    return isShareActive(share) ? 'share.status.active' : 'share.status.expired';
  }

  public async copyLink(share: ShareLink) {
    if (await copyToClipboard(this.shares.linkFor(share))) {
      this.copiedShareId = share.share_id;
      setTimeout(() => this.copiedShareId = '', 2000);
    } else {
      const toast = await this.toastController.create({ message: this.translate.instant('misc.errorOccurred'), duration: 2000 });
      await toast.present();
    }
  }

  public async revoke(share: ShareLink) {
    const alert = await this.alertController.create({
      header: this.translate.instant('share.revokeConfirmTitle'),
      message: this.translate.instant('share.revokeConfirmText'),
      buttons: [
        { text: this.translate.instant('misc.close'), role: 'cancel' },
        { text: this.translate.instant('share.revoke'), role: 'destructive' },
      ],
    });
    await alert.present();
    const { role } = await alert.onDidDismiss();
    if (role !== 'destructive') {
      return;
    }

    await this.shares.revoke(share.share_id);
    await this.load();
  }

  public async remove(share: ShareLink) {
    await this.shares.remove(share.share_id);
    await this.load();
  }

  public async removeInactive() {
    await this.shares.removeInactive();
    await this.load();
  }
}
