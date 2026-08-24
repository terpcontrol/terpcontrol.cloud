import { Component, Input, OnChanges, OnDestroy, SimpleChanges } from '@angular/core';
import { AlertController } from '@ionic/angular';
import { TranslateService } from '@ngx-translate/core';
import { DeviceService } from 'src/app/services/devices.service';
import { MAX_SOCKETS, parseSocketList, parseSocketRoles, socketIpFromCsv, SocketEntry, SOCKET_ROLES } from 'src/app/util/socket-info';

const DEVICE_ONLINE_TIMEOUT_MS = 10 * 60 * 1000;
const SOCKET_CONFIRM_POLLS = 3;
const SOCKET_CONFIRM_POLL_MS = 5000;
const SOCKET_TEST_RESET_MS = 6000;

/**
 * Smart sockets the device manages: the sockets it reports, cloud-side
 * edit/test/remove and the add flow (Terp sockets pair on the device, manual
 * entry is an explicit skip). A role can hold any number of sockets, so
 * everything here is keyed by the socket's slot rather than its role.
 * Commands go to the device immediately; the device confirms by re-reporting.
 */
@Component({
  selector: 'smart-sockets',
  templateUrl: './smart-sockets.component.html',
  styleUrls: ['./smart-sockets.component.scss'],
})
export class SmartSocketsComponent implements OnChanges, OnDestroy {
  @Input() deviceId = '';
  @Input() hardwareInfo: Record<string, string> | undefined;
  @Input() lastseen: number | undefined;

  public socketRoles = [...SOCKET_ROLES];
  public sockets: SocketEntry[] = [];

  public editingKey: string | null = null;
  public socketDraft = { ip: '', user: '', password: '' };
  public pendingKeys = new Set<string>();
  public testedKeys = new Set<string>();
  /** Role of a socket being added: it has no row to mark pending on yet. */
  public pendingAddRole: string | null = null;

  /** Add-socket flow, mirroring the webcam add flow. */
  public addingSocket = false;
  public addSocketBrand: 'terp' | 'tasmota' | null = null;
  public addSocketRole = '';
  public terpSocketManual = false;

  private timers: ReturnType<typeof setTimeout>[] = [];

  constructor(
    private devices: DeviceService,
    private alertController: AlertController,
    private translate: TranslateService,
  ) {}

  ngOnChanges(changes: SimpleChanges) {
    if (changes['hardwareInfo']) {
      this.sockets = this.readSockets();
      // The device confirms socket changes by re-reporting its table.
      this.pendingKeys.clear();
      this.pendingAddRole = null;
    }
  }

  ngOnDestroy() {
    this.timers.forEach(timer => clearTimeout(timer));
  }

  get socketsReported(): boolean {
    return this.hardwareInfo?.['sockets'] !== undefined;
  }

  get deviceOffline(): boolean {
    return typeof this.lastseen === 'number' && this.lastseen > 0 && Date.now() - this.lastseen > DEVICE_ONLINE_TIMEOUT_MS;
  }

  get canAddSocket(): boolean {
    return this.sockets.length < MAX_SOCKETS;
  }

  /** Identity for pending/editing state; the slot when the device reports one. */
  socketKey(socket: SocketEntry): string {
    return socket.slot >= 0 ? String(socket.slot) : socket.role;
  }

  trackBySocket(_index: number, socket: SocketEntry): string {
    return this.socketKey(socket);
  }

  trackByRole(_index: number, role: string): string {
    return role;
  }

  /** How many sockets share a role, for the "Heater 2 of 3" style label. */
  positionInRole(socket: SocketEntry): number {
    return this.sockets.filter(other => other.role === socket.role).indexOf(socket) + 1;
  }

  countForRole(role: string): number {
    return this.sockets.filter(socket => socket.role === role).length;
  }

  startAddSocket() {
    this.addingSocket = true;
    this.addSocketBrand = null;
    this.addSocketRole = this.socketRoles[0];
    this.socketDraft = { ip: '', user: '', password: '' };
    this.editingKey = null;
    this.terpSocketManual = false;
  }

  pickSocketBrand(brand: 'terp' | 'tasmota') {
    this.addSocketBrand = brand;
    this.terpSocketManual = false;
  }

  cancelAddSocket() {
    this.addingSocket = false;
    this.addSocketBrand = null;
    this.terpSocketManual = false;
  }

  /** Terp sockets normally pair on the device; the form is the manual skip. */
  get socketFormVisible(): boolean {
    return this.addSocketBrand === 'tasmota' || (this.addSocketBrand === 'terp' && this.terpSocketManual);
  }

  async applyAddSocket() {
    if (!this.addSocketRole || !this.socketDraftValid) {
      return;
    }
    try {
      // A socket being added has no slot yet, so `append` is what tells the
      // device to add one to the role rather than reconfigure the one it has.
      await this.devices.sendAuxCommand(this.deviceId, 'socket_set', this.addSocketRole, {
        ip: this.socketDraft.ip.trim(),
        user: this.socketDraft.user.trim(),
        password: this.socketDraft.password.trim(),
        append: true,
      });
      this.pendingAddRole = this.addSocketRole;
      this.schedulePendingRefetch();
      this.addingSocket = false;
      this.addSocketBrand = null;
    } catch (e) {
      console.log('Socket add failed:', e);
    }
  }

  startEditSocket(socket: SocketEntry) {
    const key = this.socketKey(socket);
    if (this.editingKey === key) {
      this.editingKey = null;
      return;
    }
    this.editingKey = key;
    this.addingSocket = false;
    // Prefill the reported address; credentials are write-only (empty = keep).
    this.socketDraft = { ip: socket.ip, user: '', password: '' };
  }

  get socketDraftValid(): boolean {
    const ip = this.socketDraft.ip.trim();
    return ip.length > 0 && ip.length <= 64 && /^[a-zA-Z0-9._-]+$/.test(ip);
  }

  async applySocketDraft(socket: SocketEntry) {
    if (!this.socketDraftValid) {
      return;
    }
    try {
      await this.devices.sendAuxCommand(this.deviceId, 'socket_set', socket.role, {
        ip: this.socketDraft.ip.trim(),
        user: this.socketDraft.user.trim(),
        password: this.socketDraft.password.trim(),
        ...this.slotOf(socket),
      });
      this.editingKey = null;
      this.markPending(this.socketKey(socket));
    } catch (e) {
      console.log('Socket set failed:', e);
    }
  }

  async testSocket(socket: SocketEntry) {
    const key = this.socketKey(socket);
    try {
      await this.devices.sendAuxCommand(this.deviceId, 'socket_test', socket.role, this.slotOf(socket));
      this.testedKeys.add(key);
      this.timers.push(setTimeout(() => this.testedKeys.delete(key), SOCKET_TEST_RESET_MS));
    } catch (e) {
      console.log('Socket test failed:', e);
    }
  }

  async removeSocket(socket: SocketEntry) {
    const alert = await this.alertController.create({
      header: this.translate.instant('auxDevices.sockets.removeConfirmTitle'),
      message: this.translate.instant('auxDevices.sockets.removeConfirmText', {
        role: this.translate.instant('auxDevices.sockets.roles.' + socket.role),
      }),
      buttons: [
        { text: this.translate.instant('misc.cancel'), role: 'cancel' },
        { text: this.translate.instant('auxDevices.sockets.remove'), role: 'destructive' },
      ],
    });
    await alert.present();
    const { role: result } = await alert.onDidDismiss();
    if (result !== 'destructive') {
      return;
    }

    try {
      await this.devices.sendAuxCommand(this.deviceId, 'socket_remove', socket.role, this.slotOf(socket));
      this.markPending(this.socketKey(socket));
    } catch (e) {
      console.log('Socket removal failed:', e);
    }
  }

  private slotOf(socket: SocketEntry): { slot?: number } {
    return socket.slot >= 0 ? { slot: socket.slot } : {};
  }

  private readSockets(): SocketEntry[] {
    const table = parseSocketList(this.hardwareInfo);
    if (table) {
      return table;
    }
    // Firmware from before the socket table reports one socket per role, and
    // has no slots to address them by.
    return parseSocketRoles(this.hardwareInfo?.['sockets']).map(role => ({
      slot: -1,
      role,
      id: '',
      ip: socketIpFromCsv(this.hardwareInfo?.['socket_ips'], role) ?? '',
    }));
  }

  private markPending(key: string) {
    this.pendingKeys.add(key);
    this.schedulePendingRefetch();
  }

  /** The device re-reports its sockets; poll a few refetches to pick it up. */
  private schedulePendingRefetch() {
    for (let i = 1; i <= SOCKET_CONFIRM_POLLS; i++) {
      this.timers.push(setTimeout(() => void this.devices.refetchDevices(), i * SOCKET_CONFIRM_POLL_MS));
    }
  }
}
