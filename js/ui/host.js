import { html } from '../preact.js';
import { S } from '../store.js';
import { FoodSheet } from './food.js';
import { ScannerSheet } from './scanner-sheet.js';
import { AddSheet } from './add.js';
import { QuickAddSheet } from './quickadd.js';
import { LabelSheet } from './label.js';
import { WeightSheet } from './weight.js';
import { CheckInSheet } from './checkin.js';
import { ProfileSheet, TargetsSheet } from './settings.js';

const SHEETS = {
  food: FoodSheet,
  scanner: ScannerSheet,
  add: AddSheet,
  quick: QuickAddSheet,
  label: LabelSheet,
  weight: WeightSheet,
  checkin: CheckInSheet,
  profile: ProfileSheet,
  targets: TargetsSheet,
};

export function SheetHost() {
  return S.ui.sheets.map(s => {
    const C = SHEETS[s.type];
    return C ? html`<${C} key=${s.key} ...${s.props} />` : null;
  });
}
