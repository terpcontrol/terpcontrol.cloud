import { ComponentsModule } from '../../components/components.module';
import { FormsModule } from '@angular/forms';
import { PipesModule } from '../../pipes/pipes.module';
import { TranslateModule } from '@ngx-translate/core';
import { RouterTestingModule } from '@angular/router/testing';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { ComponentFixture, TestBed, waitForAsync } from '@angular/core/testing';
import { IonicModule } from '@ionic/angular';

import { OutputdisplayComponent } from './outputdisplay.component';

describe('OutputdisplayComponent', () => {
  let component: OutputdisplayComponent;
  let fixture: ComponentFixture<OutputdisplayComponent>;

  beforeEach(waitForAsync(() => {
    TestBed.configureTestingModule({
      declarations: [ OutputdisplayComponent ],
      imports: [ComponentsModule, FormsModule, PipesModule, TranslateModule.forRoot(), HttpClientTestingModule, RouterTestingModule, IonicModule.forRoot()]
    }).compileComponents();
  }));

  beforeEach(() => {
    fixture = TestBed.createComponent(OutputdisplayComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
