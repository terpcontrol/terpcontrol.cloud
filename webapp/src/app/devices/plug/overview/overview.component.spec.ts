import { ComponentsModule } from '../../../components/components.module';
import { FormsModule } from '@angular/forms';
import { PipesModule } from '../../../pipes/pipes.module';
import { TranslateModule } from '@ngx-translate/core';
import { RouterTestingModule } from '@angular/router/testing';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { ComponentFixture, TestBed, waitForAsync } from '@angular/core/testing';
import { IonicModule } from '@ionic/angular';

import { PlugOverviewComponent } from './overview.component';

describe('PlugOverviewComponent', () => {
  let component: PlugOverviewComponent;
  let fixture: ComponentFixture<PlugOverviewComponent>;

  beforeEach(waitForAsync(() => {
    TestBed.configureTestingModule({
      declarations: [ PlugOverviewComponent ],
      imports: [ComponentsModule, FormsModule, PipesModule, TranslateModule.forRoot(), HttpClientTestingModule, RouterTestingModule, IonicModule.forRoot()]
    }).compileComponents();
  }));

  beforeEach(() => {
    fixture = TestBed.createComponent(PlugOverviewComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
