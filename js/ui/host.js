import { html } from '../preact.js';
import { S } from '../store.js';
import { FoodSheet } from './food.js';
import { ScannerSheet } from './scanner-sheet.js';
import { AddSheet } from './add.js';
import { QuickAddSheet } from './quickadd.js';
import { LabelSheet } from './label.js';
import { WeightSheet } from './weight.js';
import { CheckInSheet } from './checkin.js';
import { ProfileSheet, TargetsSheet, PreferencesSheet, FoodDataSheet, DataSheet } from './settings.js';
import { AppearanceSheet } from './appearance.js';
import { TargetsInfoSheet } from './explain.js';
import { SaveMealSheet, MealTemplateSheet } from './meals.js';
import { AiSetupSheet, PhotoSheet, RestaurantSheet, CoachSheet, AiEntrySheet } from './ai.js';
import { VoiceSheet } from './voice.js';
import { WhatsNewSheet } from './whatsnew.js';
import { ScoreInfoSheet } from './week.js';

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
  preferences: PreferencesSheet,
  'food-data': FoodDataSheet,
  'your-data': DataSheet,
  appearance: AppearanceSheet,
  'targets-info': TargetsInfoSheet,
  'save-meal': SaveMealSheet,
  'meal-template': MealTemplateSheet,
  'ai-setup': AiSetupSheet,
  photo: PhotoSheet,
  restaurant: RestaurantSheet,
  coach: CoachSheet,
  'ai-entry': AiEntrySheet,
  voice: VoiceSheet,
  'whats-new': WhatsNewSheet,
  'score-info': ScoreInfoSheet,
};

export function SheetHost() {
  return S.ui.sheets.map(s => {
    const C = SHEETS[s.type];
    return C ? html`<${C} key=${s.key} ...${s.props} />` : null;
  });
}
