import { Directive, ElementRef, Input, OnChanges } from '@angular/core';

/**
 * Holds an element at the height it had, for as long as it is asked to.
 *
 * This is the mechanical half of M3: while the handle moves, the diff table
 * collapses to a two-line scrub header, and if the section were allowed to
 * shrink at the same moment everything below would jump under the reader's
 * thumb. So the height is measured *before* the collapse - Angular updates a
 * directive's input before the embedded views inside that element - and put
 * back afterwards.
 *
 * It reserves height and nothing else. It cannot hide a row, and there is no
 * setting that turns it on: it follows the gesture and ends with it.
 */
@Directive({
  selector: '[appHoeheHalten]',
})
export class HoeheHaltenDirective implements OnChanges {
  @Input() appHoeheHalten = false;

  constructor(private element: ElementRef<HTMLElement>) {}

  ngOnChanges(): void {
    const knoten = this.element.nativeElement;

    if (!this.appHoeheHalten) {
      knoten.style.removeProperty('height');
      knoten.style.removeProperty('overflow');
      return;
    }

    // Already held: re-measuring now would measure the collapsed state.
    if (knoten.style.height) return;

    const hoehe = knoten.getBoundingClientRect().height;
    if (hoehe <= 0) return;

    knoten.style.height = `${hoehe}px`;
    knoten.style.overflow = 'hidden';
  }
}
