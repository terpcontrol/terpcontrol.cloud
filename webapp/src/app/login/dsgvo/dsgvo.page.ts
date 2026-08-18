import { Component } from '@angular/core';
import { ModalController } from '@ionic/angular';

@Component({
  selector: 'dsgvo-modal-page',
  templateUrl: './dsgvo.page.html',
  styles: [`
    ion-content {
      --padding-start: 0;
      --padding-end: 0;
      --padding-top: 0;
      --padding-bottom: 0;
    }

    .privacy-frame {
      display: block;
      width: 100%;
      height: 100%;
      border: 0;
    }
  `],
})
export class DsgvoModalPage {
    constructor(public modalController: ModalController) {}

  dismiss() {
    // using the injected ModalController this page
    // can "dismiss" itself and optionally pass back data
    this.modalController.dismiss({
      'dismissed': true
    });
  }
}
