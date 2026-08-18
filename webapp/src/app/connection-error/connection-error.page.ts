import { Component } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { NavController } from '@ionic/angular';
import { AuthService } from '../auth/auth.service';

@Component({
  selector: 'app-connection-error',
  templateUrl: './connection-error.page.html',
  styleUrls: ['./connection-error.page.scss'],
})
export class ConnectionErrorPage {
  public retrying = false;
  public stillUnreachable = false;

  private readonly returnUrl: string;

  constructor(private route: ActivatedRoute, private auth: AuthService, private navCtrl: NavController) {
    this.returnUrl = this.route.snapshot.queryParams['returnUrl'] || '/list';
  }

  public async retry() {
    this.retrying = true;
    this.stillUnreachable = false;

    const sessionState = await this.auth.restoreSession();

    this.retrying = false;

    if (sessionState === 'unreachable') {
      this.stillUnreachable = true;
      return;
    }

    // navigateRoot rather than the plain Router: this page replaced whatever the user
    // was heading for, so the Ionic navigation stack has to be rebuilt, not popped.
    await this.navCtrl.navigateRoot(sessionState === 'authenticated' ? this.returnUrl : '/login');
  }
}
