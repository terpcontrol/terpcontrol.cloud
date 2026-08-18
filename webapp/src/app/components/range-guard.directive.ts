import { Directive, ElementRef, OnDestroy, OnInit, Renderer2 } from '@angular/core';

const DISARM_AFTER_MS = 8000;

/**
 * Keeps a slider inert until it is deliberately tapped, so starting a scroll
 * on it (mobile) can never change the value. Tapping the slider row arms it;
 * it disarms again a few seconds after the last interaction.
 */
@Directive({ selector: 'ion-range[rangeGuard]' })
export class RangeGuardDirective implements OnInit, OnDestroy {
  private armed = false;
  private disarmTimer: ReturnType<typeof setTimeout> | null = null;
  private unlisteners: (() => void)[] = [];

  constructor(private el: ElementRef<HTMLElement>, private renderer: Renderer2) {}

  ngOnInit() {
    this.renderer.addClass(this.el.nativeElement, 'range-guard');
    this.disarm();

    const parent = this.el.nativeElement.parentElement;
    if (parent) {
      this.renderer.setStyle(parent, 'cursor', 'pointer');
      this.unlisteners.push(this.renderer.listen(parent, 'click', () => this.arm()));
    }

    this.unlisteners.push(
      this.renderer.listen(this.el.nativeElement, 'ionChange', () => this.armed && this.scheduleDisarm()),
      this.renderer.listen(this.el.nativeElement, 'ionKnobMoveStart', () => this.cancelTimer()),
      this.renderer.listen(this.el.nativeElement, 'ionKnobMoveEnd', () => this.scheduleDisarm()),
    );
  }

  ngOnDestroy() {
    this.cancelTimer();
    this.unlisteners.forEach(unlisten => unlisten());
  }

  private arm() {
    if (this.armed) {
      return;
    }
    this.armed = true;
    this.renderer.removeStyle(this.el.nativeElement, 'pointer-events');
    this.renderer.addClass(this.el.nativeElement, 'range-guard-armed');
    this.scheduleDisarm();
  }

  private disarm() {
    this.armed = false;
    this.renderer.setStyle(this.el.nativeElement, 'pointer-events', 'none');
    this.renderer.removeClass(this.el.nativeElement, 'range-guard-armed');
    this.cancelTimer();
  }

  private scheduleDisarm() {
    this.cancelTimer();
    this.disarmTimer = setTimeout(() => this.disarm(), DISARM_AFTER_MS);
  }

  private cancelTimer() {
    if (this.disarmTimer) {
      clearTimeout(this.disarmTimer);
      this.disarmTimer = null;
    }
  }
}
