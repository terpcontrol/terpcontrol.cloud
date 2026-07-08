import { Component, Input } from '@angular/core';
import { ModalController } from '@ionic/angular';
import type { SharePage } from '@fg2/shared-types';
import { ShareService } from '../../services/share.service';

@Component({
  selector: 'app-share-link-modal',
  templateUrl: './share-link-modal.component.html',
  styleUrls: ['./share-link-modal.component.scss'],
})
export class ShareLinkModalComponent {
  @Input() deviceId = '';
  @Input() page: SharePage = 'charts';
  // Whether the view being shared currently includes webcam images. View-only
  // links only allow the webcam when it was part of the shared view.
  @Input() webcamActive = false;

  public editable = false;
  public validDays: number | null = 7;
  public creating = false;
  public createdLink = '';
  public copied = false;
  public error = false;

  constructor(private modalController: ModalController, private shares: ShareService) {}

  public optionsChanged() {
    this.createdLink = '';
    this.copied = false;
  }

  public async createLink() {
    this.creating = true;
    this.error = false;
    try {
      const query = new URLSearchParams(window.location.search);
      query.delete('share');

      const share = await this.shares.create({
        device_id: this.deviceId,
        page: this.page,
        editable: this.editable,
        webcam: this.webcamActive,
        valid_days: this.validDays,
        query: query.toString(),
      });

      this.createdLink = this.shares.linkFor(share);
    } catch (_error) {
      this.error = true;
    } finally {
      this.creating = false;
    }
  }

  public async copyLink() {
    try {
      await navigator.clipboard.writeText(this.createdLink);
      this.copied = true;
      setTimeout(() => this.copied = false, 2000);
    } catch (_error) {
      // Clipboard unavailable (insecure context): the link stays selectable in the input.
    }
  }

  public close() {
    void this.modalController.dismiss();
  }
}
