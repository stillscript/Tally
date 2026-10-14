// Major US sodas from their Nutrition Facts labels (12 fl oz / 355 ml can), stored per 100 ml.
const can = (kcal, sugar, sodium) => {
  const k = 100 / 355;
  return { kcal: kcal * k, p: 0, c: sugar * k, f: 0, fiber: 0, sugar: sugar * k, addedSugar: sugar * k, satFat: 0, sodium: sodium * k };
};
const SIZES = [
  { label: '12 fl oz can (355 ml)', g: 355 },
  { label: '20 fl oz bottle (591 ml)', g: 591 },
  { label: '7.5 fl oz mini can (222 ml)', g: 222 },
  { label: '16 fl oz (473 ml)', g: 473 },
];

export const BRAND_DRINKS = [
  { id: 'label:coca-cola', name: 'Coca-Cola', brand: 'Coca-Cola', aliases: ['coke', 'coca cola', 'regular coke', 'classic coke', 'cola', 'soda', 'pop'], per100: can(140, 39, 45) },
  { id: 'label:diet-coke', name: 'Diet Coke', brand: 'Coca-Cola', aliases: ['diet coke', 'diet soda', 'diet cola'], per100: can(0, 0, 40) },
  { id: 'label:coke-zero', name: 'Coca-Cola Zero Sugar', brand: 'Coca-Cola', aliases: ['coke zero', 'zero sugar', 'coke zero sugar'], per100: can(0, 0, 35) },
  { id: 'label:pepsi', name: 'Pepsi', brand: 'PepsiCo', aliases: ['pepsi', 'cola', 'soda', 'pop'], per100: can(150, 41, 30) },
  { id: 'label:diet-pepsi', name: 'Diet Pepsi', brand: 'PepsiCo', aliases: ['diet pepsi', 'diet soda'], per100: can(0, 0, 35) },
  { id: 'label:sprite', name: 'Sprite', brand: 'Coca-Cola', aliases: ['sprite', 'lemon lime soda', '7up', 'soda'], per100: can(140, 38, 65) },
  { id: 'label:dr-pepper', name: 'Dr Pepper', brand: 'Keurig Dr Pepper', aliases: ['dr pepper', 'dr. pepper', 'soda'], per100: can(150, 39, 55) },
  { id: 'label:mountain-dew', name: 'Mountain Dew', brand: 'PepsiCo', aliases: ['mountain dew', 'mtn dew', 'dew', 'soda'], per100: can(170, 46, 60) },
].map(d => ({ ...d, cat: 'Drinks', base: 'ml', servings: SIZES }));
