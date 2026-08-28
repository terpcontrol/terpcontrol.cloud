import { ComponentRef, Directive, Input, OnChanges, OnDestroy, SimpleChanges, ViewContainerRef } from '@angular/core';
import type { Ding, DingArt, Zelt } from '@fg2/shared-types';
import { KoerperBasis } from './koerper-basis';
import { koerperFuer } from './koerper.registry';

/**
 * Puts the body for a Ding's art into the Tafel. The component is rebuilt only
 * when the art changes; a re-read of the same Ding pushes new inputs into the
 * instance that is already standing, which is the same reason the lists are
 * cached - nothing that did not change may cost a DOM rebuild.
 */
@Directive({
  selector: '[appKoerper]',
})
export class KoerperHostDirective implements OnChanges, OnDestroy {
  @Input('appKoerper') ding: Ding | null = null;
  @Input() appKoerperZelt: Zelt | null = null;
  @Input() appKoerperDinge: readonly Ding[] = [];

  private art: DingArt | null = null;
  private ref: ComponentRef<KoerperBasis> | null = null;

  constructor(private container: ViewContainerRef) {}

  ngOnChanges(_changes: SimpleChanges): void {
    if (!this.ding || !this.appKoerperZelt) {
      this.leeren();
      return;
    }

    if (this.ding.art !== this.art) {
      this.leeren();
      const komponente = koerperFuer(this.ding.art);
      if (!komponente) return;

      this.art = this.ding.art;
      this.ref = this.container.createComponent(komponente);
    }

    this.ref?.setInput('ding', this.ding);
    this.ref?.setInput('zelt', this.appKoerperZelt);
    this.ref?.setInput('dinge', this.appKoerperDinge);
  }

  ngOnDestroy(): void {
    this.leeren();
  }

  private leeren(): void {
    this.container.clear();
    this.ref = null;
    this.art = null;
  }
}
