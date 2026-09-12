// Card tracking needs exactly two browser features on Chrome desktop: a camera
// that getUserMedia can open, and a secure context (HTTPS or localhost), because
// Chrome only exposes getUserMedia on secure origins. WebXR `immersive-ar` is
// intentionally NOT consulted: it is unavailable on desktop and is out of scope
// for this release.
export function detectCapabilities(media = typeof navigator !== 'undefined' ? navigator : undefined) {
  const reasons = [];
  const camera = Boolean(media?.mediaDevices?.getUserMedia);
  const secureContext = typeof window !== 'undefined' ? window.isSecureContext === true : false;

  if (!camera) reasons.push('Kamera tidak tersedia. Pakai Chrome desktop terbaru yang mengizinkan akses kamera.');
  if (!secureContext) reasons.push('Halaman tidak berjalan di konteks aman. Buka lewat HTTPS atau localhost supaya kamera diizinkan browser.');

  return {
    cardTracking: Boolean(camera && secureContext),
    camera,
    secureContext,
    reasons
  };
}

export function explainCapabilities(capabilities) {
  if (capabilities?.cardTracking) return 'Pelacakan kartu siap dipakai: kamera dan konteks aman tersedia.';
  return capabilities?.reasons?.[0] ?? 'Pelacakan kartu tidak tersedia. Gunakan Preview Desktop.';
}
