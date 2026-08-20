import { Component, EventEmitter, Input, Output } from '@angular/core';
import { LogCategoryFilterValue } from './log-entry-viewer.component';
import { LogTranslateService } from '../../services/log-translate.service';

@Component({
  selector: 'app-log-category-selector',
  templateUrl: './log-category-selector.component.html',
})
export class LogCategorySelectorComponent {
  @Input() availableCategories: string[] = [];
  @Input() selectedCategories: LogCategoryFilterValue = [];

  @Output() selectedCategoriesChange = new EventEmitter<LogCategoryFilterValue>();

  constructor(private logTranslate: LogTranslateService) {}

  categoryLabel(category: string): string {
    return this.logTranslate.getCategoryLabel(category);
  }

  onSelectedCategoryChange(categories: LogCategoryFilterValue): void {
    this.selectedCategoriesChange.emit(categories || []);
  }
}

