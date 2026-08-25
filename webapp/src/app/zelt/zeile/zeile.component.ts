import { Component, Input, OnChanges } from '@angular/core';
import type { Ding, Zelt } from '@fg2/shared-types';
import { Marke, dingAlter, dingMarke, dingName, dingWert } from 'src/app/util/ding-text';
import { formatTimeAgo } from 'src/app/util/time-ago';
import { DingTextService } from './ding-text.service';

/**
 * One row. The same shape for all sixteen arts - square, name, value, age - and
 * that is the point: a list is made of these, and learning one row is learning
 * every list in the product.
 *
 * What differs per art is only which words land in the three slots, which is a
 * pure mapping over the Ding. There is no per-art row, no expanded row and no
 * density option.
 */
@Component({
  selector: 'app-zeile',
  templateUrl: './zeile.component.html',
  styleUrls: ['./zeile.component.scss'],
})
export class ZeileComponent implements OnChanges {
  @Input() ding!: Ding;
  @Input() zelt!: Zelt;
  /**
   * The other Dinge on the screen. A socket has no clock of its own - it is as
   * fresh as the device that reports it - and the parent device is a row in
   * here.
   */
  @Input() umfeld: readonly Ding[] = [];
  /** The middle slot, when the Tafel knows something `d` alone cannot say. */
  @Input() wertText: string | null = null;
  /** Rows below the Vorher hairline are dimmed rather than hidden. §6.1. */
  @Input() gedimmt = false;
  /**
   * Now, as the screen last read it. It is an input rather than a `Date.now()`
   * in here so that the row goes stale while the screen is open, instead of
   * keeping the reading it had when it was drawn.
   */
  @Input() jetzt = Date.now();

  public name = '';
  public wert = '';
  public marke: Marke = 'voll';
  public alter = '';

  constructor(private texte: DingTextService) {}

  ngOnChanges(): void {
    if (!this.ding) return;

    this.name = this.texte.text(dingName(this.ding));
    this.wert = this.wertText ?? this.texte.text(dingWert(this.ding));
    this.marke = dingMarke(this.ding, this.jetzt, this.umfeld);
    this.alter = formatTimeAgo(dingAlter(this.ding, this.umfeld));
  }

  /** Every row walks to its own Tafel; that is what makes the browser a browser. */
  get ziel(): unknown[] {
    return ['/z', this.ding?.zelt_id ?? '', this.ding?.ding_id ?? ''];
  }
}
