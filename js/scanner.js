// Camera barcode scanning.
// Android Chrome has a built-in BarcodeDetector. iPhone Safari doesn't, so we load
// a WebAssembly build of ZXing that implements the same API (~1 MB, cached after first use).
import { normalizeBarcode } from './barcode.js';

const PONYFILL = 'https://cdn.jsdelivr.net/npm/barcode-detector@3.2.2/dist/iife/ponyfill.js';
export const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e'];

let detectorClass = null;
function loadDetectorClass() {
  if (detectorClass) return detectorClass;
  detectorClass = (async () => {
    if ('BarcodeDetector' in window) {
      try {
        const supported = await window.BarcodeDetector.getSupportedFormats();
        if (supported.includes('ean_13') && supported.includes('upc_a')) return window.BarcodeDetector;
      } catch {}
    }
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = PONYFILL;
      s.crossOrigin = 'anonymous';
      s.onload = resolve;
      s.onerror = () => reject(Object.assign(new Error('Could not load the barcode reader'), { name: 'LoadError' }));
      document.head.appendChild(s);
    });
    return window.BarcodeDetectionAPI.BarcodeDetector;
  })();
  detectorClass.catch(() => { detectorClass = null; });
  return detectorClass;
}

// Start warming up the decoder before the camera opens.
export const preloadScanner = () => loadDetectorClass().catch(() => {});

export async function startScanner(video, { onCode }) {
  if (!window.isSecureContext) throw Object.assign(new Error('insecure'), { name: 'InsecureContext' });
  if (!navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error('no camera api'), { name: 'NotSupportedError' });

  const detPromise = loadDetectorClass();
  detPromise.catch(() => {});
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
  });
  let Det;
  try {
    Det = await detPromise;
  } catch (e) {
    stream.getTracks().forEach(t => t.stop());
    throw e;
  }
  video.setAttribute('playsinline', '');
  video.muted = true;
  video.srcObject = stream;
  await video.play().catch(() => {});

  const track = stream.getVideoTracks()[0];
  let caps = {};
  try { caps = track.getCapabilities?.() || {}; } catch {}
  try {
    if (caps.focusMode?.includes('continuous')) await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] });
  } catch {}

  const detector = new Det({ formats: FORMATS });
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  let stopped = false;
  let frame = 0;
  const recent = []; // codes seen in the last few frames

  async function tick() {
    if (stopped) return;
    try {
      const vw = video.videoWidth, vh = video.videoHeight;
      if (vw && vh && video.readyState >= 2) {
        // Alternate between the middle band (where the guide box is: faster, fewer misreads)
        // and the whole frame (catches cans held sideways or barcodes off to one side).
        const full = frame++ % 2 === 1;
        const cw = full ? vw : Math.round(vw * 0.9), ch = full ? vh : Math.round(vh * 0.55);
        const scale = Math.min(1, 1280 / Math.max(cw, ch));
        canvas.width = Math.round(cw * scale);
        canvas.height = Math.round(ch * scale);
        ctx.drawImage(video, (vw - cw) / 2, (vh - ch) / 2, cw, ch, 0, 0, canvas.width, canvas.height);
        const found = await detector.detect(canvas);
        for (const b of found) {
          const n = normalizeBarcode(b.rawValue, b.format);
          if (!n) continue;
          // 12/13-digit codes carry a strong check digit: one read is enough.
          // Short 8-digit codes (cans, small packs) must repeat once within a few frames.
          const short = String(b.rawValue).replace(/\D/g, '').length <= 8;
          if (!short || recent.includes(n.gtin14)) {
            stopped = true;
            navigator.vibrate?.(35);
            onCode({ raw: b.rawValue, format: b.format, n });
            return;
          }
          recent.push(n.gtin14);
          if (recent.length > 6) recent.shift();
          break;
        }
      }
    } catch (e) {
      // Individual frame failures are normal; keep going.
    }
    if (!stopped) setTimeout(tick, 60);
  }
  tick();

  return {
    stop() {
      stopped = true;
      stream.getTracks().forEach(t => t.stop());
      video.srcObject = null;
    },
    torch: caps.torch ? on => track.applyConstraints({ advanced: [{ torch: on }] }) : null,
  };
}

export function scanErrorMessage(e) {
  switch (e?.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Camera access is blocked. Allow camera access for this site in your browser settings, then try again.';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'No camera was found on this device.';
    case 'NotReadableError':
      return 'The camera is being used by another app. Close it and try again.';
    case 'InsecureContext':
      return 'The camera only works when Tally is opened over https://.';
    case 'LoadError':
      return 'Couldn’t load the barcode reader. Check your connection and try again.';
    default:
      return 'The camera couldn’t start on this device.';
  }
}
