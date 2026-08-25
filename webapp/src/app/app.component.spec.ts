import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { TranslateModule } from '@ngx-translate/core';

import { AppComponent } from './app.component';
import { AuthService } from './auth/auth.service';

describe('AppComponent', () => {
  let fixture: ComponentFixture<AppComponent>;
  let component: AppComponent;
  let auth: AuthService;

  const urls = () => component.appPages.map((p: { url: string }) => p.url);

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [AppComponent],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
      imports: [TranslateModule.forRoot(), HttpClientTestingModule, RouterTestingModule.withRoutes([])],
    }).compileComponents();

    fixture = TestBed.createComponent(AppComponent);
    component = fixture.componentInstance;
    auth = TestBed.inject(AuthService);
  });

  it('should create the app', () => {
    expect(component).toBeTruthy();
  });

  it('keeps the menu out of the way until somebody is signed in', () => {
    // The pages are built eagerly; it is the template that withholds the menu.
    expect(component.authenticated).toBeFalse();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('ion-menu')).toBeNull();
  });

  it('gives an ordinary account the devices, shares and account pages', () => {
    auth.current_user.next({ is_admin: false } as never);
    expect(urls()).toEqual(['/list', '/shares', '/account']);
  });

  it('adds the fleet pages for an admin', () => {
    auth.current_user.next({ is_admin: true } as never);
    expect(urls()).toContain('/diagnostics');
    expect(urls()).toContain('/classes');
  });

  it('leaves a demo session with nothing but the device list', () => {
    auth.current_user.next({ is_demo: true } as never);
    expect(urls()).toEqual(['/list']);
  });

  it('shows the menu once authenticated', () => {
    auth.authenticated.next(true);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('ion-menu')).not.toBeNull();
  });
});
