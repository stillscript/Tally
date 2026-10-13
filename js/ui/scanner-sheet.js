import { html, useState, useEffect, useRef } from '../preact.js';
import { startScanner, scanErrorMessage } from '../scanner.js';
import { normalizeBarcode } from '../barcode.js';
import { toast } from '../store.js';
import { Icon } from './icons.js';
import { closeSheet, replaceSheet } from './nav.js';
import { mealForTime } from '../util.js';

export function ScannerSheet({ meal = mealForTime(), date }) {
  const video = useRef(null);
  const ctl = useRef(null);
  const [status, setStatus] = useState('starting');
  const [err, setErr] = useState('');
  const [torch, setTorch] = useState(false);
  const [hasTorch, setHasTorch] = useState(false);
  const [typing, setTyping] = useState(false);
  const [code, setCode] = useState('');

  useEffect(() => {
    let alive = true;
    startScanner(video.current, {
      onCode: ({ raw, format }) => {
        if (!alive) return;
        ctl.current?.stop();
        replaceSheet('food', { barcode: raw, format, meal, date, fromScan: true });
      },
    })
      .then(c => {
        if (!alive) return c.stop();
        ctl.current = c;
        setHasTorch(!!c.torch);
        setStatus('scanning');
      })
      .catch(e => {
        if (!alive) return;
        setErr(scanErrorMessage(e));
        setStatus('error');
        setTyping(true);
      });
    return () => {
      alive = false;
      ctl.current?.stop();
    };
  }, []);

  function submit(e) {
    e.preventDefault();
    if (!normalizeBarcode(code)) return toast('Those digits don’t form a valid barcode — check them and try again');
    ctl.current?.stop();
    replaceSheet('food', { barcode: code, meal, date, fromScan: true });
  }

  async function toggleTorch() {
    try {
      await ctl.current.torch(!torch);
      setTorch(!torch);
    } catch {}
  }

  return html`<div class="scanner" role="dialog" aria-modal="true" aria-label="Scan a barcode">
    <video ref=${video} playsinline muted autoplay></video>
    <div class="scan-shade"></div>
    <div class="scan-top">
      <button class="icon-btn on-dark" onClick=${closeSheet} aria-label="Close scanner"><${Icon} n="x" /></button>
      <span class="scan-title">Scan barcode</span>
      ${hasTorch ? html`<button class=${'icon-btn on-dark' + (torch ? ' lit' : '')} onClick=${toggleTorch} aria-label="Flashlight" aria-pressed=${torch}><${Icon} n="flash" /></button>` : html`<span class="icon-spacer"></span>`}
    </div>
    <div class=${'scan-box' + (status === 'scanning' ? ' live' : '')}><span class="scan-line"></span></div>
    <div class="scan-bottom">
      ${status === 'starting' && html`<p class="scan-hint">Starting camera…</p>`}
      ${status === 'scanning' && !typing && html`<p class="scan-hint">Line up the barcode inside the box</p>`}
      ${status === 'error' && html`<p class="scan-error">${err}</p>`}
      ${typing
        ? html`<form class="scan-type" onSubmit=${submit}>
            <input class="input" inputmode="numeric" pattern="[0-9 ]*" placeholder="Type the barcode digits" autoFocus
              value=${code} onInput=${e => setCode(e.currentTarget.value)} aria-label="Barcode digits" />
            <button class="btn primary" type="submit">Look up</button>
          </form>`
        : html`<button class="btn on-dark" onClick=${() => setTyping(true)}><${Icon} n="keyboard" /> Type it instead</button>`}
      <button class="btn link on-dark" onClick=${() => replaceSheet('add', { meal, date })}>Search by name</button>
    </div>
  </div>`;
}
