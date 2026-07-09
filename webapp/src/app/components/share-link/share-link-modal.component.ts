import { Component, ElementRef, Input } from '@angular/core';
import { ModalController } from '@ionic/angular';
import type { SharePage } from '@fg2/shared-types';
import { ShareService, copyToClipboard } from '../../services/share.service';

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
  // Diary links only: let visitors open the chart views linked from the grow report.
  public includeCharts = false;
  // Date (YYYY-MM-DD) at whose end the link expires; empty means it never expires.
  public expiresDate = '';
  public minExpiresDate = ShareLinkModalComponent.toDateString(new Date());
  public creating = false;
  public createdLink = '';
  public copied = false;
  public error = false;

  constructor(
    private modalController: ModalController,
    private shares: ShareService,
    private elementRef: ElementRef<HTMLElement>,
  ) {}

  private static toDateString(date: Date): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  public optionsChanged() {
    this.createdLink = '';
    this.copied = false;
  }

  public expiryPicked(modal: { dismiss: () => Promise<boolean> }) {
    this.optionsChanged();
    void modal.dismiss();
  }

  public clearExpiry(modal: { dismiss: () => Promise<boolean> }) {
    this.expiresDate = '';
    this.optionsChanged();
    void modal.dismiss();
  }

  private expiresAt(): number | null {
    if (!this.expiresDate) {
      return null;
    }

    const [year, month, day] = this.expiresDate.slice(0, 10).split('-').map(Number);
    return new Date(year, month - 1, day, 23, 59, 59, 999).getTime();
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
        charts: this.page === 'diary' && this.includeCharts,
        expires_at: this.expiresAt(),
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
    if (await copyToClipboard(this.createdLink, this.elementRef.nativeElement)) {
      this.copied = true;
      setTimeout(() => this.copied = false, 2000);
    }
  }

  public close() {
    void this.modalController.dismiss();
  }
}
