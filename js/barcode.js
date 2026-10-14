// Barcode math. Retail food barcodes are GTINs (UPC-A, UPC-E, EAN-13, EAN-8).
// Databases disagree on format: USDA stores 14-digit GTINs with leading zeros,
// Open Food Facts uses EAN-13. So every scan is normalized to all forms.

export const digitsOnly = s => String(s ?? '').replace(/\D/g, '');

export function gtinCheckDigit(body) {
  let sum = 0;
  for (let i = body.length - 1, w = 3; i >= 0; i--, w = w === 3 ? 1 : 3) sum += Number(body[i]) * w;
  return (10 - (sum % 10)) % 10;
}

export function isValidGtin(code) {
  const d = digitsOnly(code);
  if (![8, 12, 13, 14].includes(d.length)) return false;
  return gtinCheckDigit(d.slice(0, -1)) === Number(d[d.length - 1]);
}

// UPC-E (the short code on cans and small packs) -> full 12-digit UPC-A.
export function upcEtoA(code) {
  let d = digitsOnly(code);
  if (d.length === 6) d = '0' + d;
  let check = null;
  if (d.length === 8) {
    check = d[7];
    d = d.slice(0, 7);
  }
  if (d.length !== 7 || (d[0] !== '0' && d[0] !== '1')) return null;
  const ns = d[0];
  const [a, b, c, e, f, g] = d.slice(1);
  let body;
  if (g <= '2') body = ns + a + b + g + '0000' + c + e + f;
  else if (g === '3') body = ns + a + b + c + '00000' + e + f;
  else if (g === '4') body = ns + a + b + c + e + '00000' + f;
  else body = ns + a + b + c + e + f + '0000' + g;
  const cd = String(gtinCheckDigit(body));
  if (check != null && check !== cd) return null;
  return body + cd;
}

const fromUpcA = a => ({ gtin14: '00' + a, ean13: '0' + a, upcA: a, display: a });
const fromEan13 = d => (d[0] === '0' ? fromUpcA(d.slice(1)) : { gtin14: '0' + d, ean13: d, upcA: null, display: d });
const fromEan8 = d => ({ gtin14: d.padStart(14, '0'), ean13: null, upcA: null, ean8: d, display: d });

// Returns { gtin14, ean13, upcA, display, alt? } or null when the digits fail the check digit.
export function normalizeBarcode(raw, format) {
  const d = digitsOnly(raw);
  // Some decoders report UPC-E already expanded to 12 digits; only expand the short form.
  if ((format === 'upc_e' && d.length <= 8) || d.length === 6 || d.length === 7) {
    const a = upcEtoA(d);
    return a ? fromUpcA(a) : null;
  }
  if (d.length === 8) {
    const asEan8 = isValidGtin(d) ? fromEan8(d) : null;
    if (format === 'ean_8') return asEan8;
    const a = upcEtoA(d);
    const asUpcE = a ? fromUpcA(a) : null;
    // Typed 8-digit code: in North America it is almost always UPC-E.
    if (asUpcE && asEan8) return { ...asUpcE, alt: asEan8 };
    return asUpcE || asEan8;
  }
  if (!isValidGtin(d)) return null;
  if (d.length === 12) return fromUpcA(d);
  if (d.length === 13) return fromEan13(d);
  if (d.length === 14) return d[0] === '0' ? fromEan13(d.slice(1)) : { gtin14: d, ean13: null, upcA: null, display: d };
  return null;
}
