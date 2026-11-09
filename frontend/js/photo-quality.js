// ============================================================
// e-Patong — Photo quality check
//
// Looks at a photo BEFORE the AI model sees it, and says whether the
// photo is good enough. Bad photos (black, blank, washed out, blurry)
// give the model nothing to work with — and the model can still answer
// "98% Tablet" for a black picture. So we stop them first.
//
// Two kinds of problems:
//   HARD (blocked)  too dark, too bright, blank  -> there is nothing to identify
//   SOFT (warning)  blurry, too small            -> user may choose "Scan anyway"
//
// The numbers below were chosen by measuring real photos and blurred /
// darkened copies of them (sharp photos scored 0.17+, blurred ones 0.08 or
// less, so the blur limit sits in the gap at 0.10).
//
// This file has no browser code inside, so the same file can be tested in Node.
// ============================================================
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PhotoQuality = factory();
}(typeof self !== 'undefined' ? self : this, function () {

  const LIMITS = {
    tooDarkMean:   0.10,   // average brightness (0 = black, 1 = white) below this -> too dark
    tooBrightMean: 0.94,   // above this -> washed out
    blankStd:      8,      // contrast (0–255) below this -> blank, nothing to see
    blurRatio:     0.10,   // sharpness score below this -> blurry
    minShortSide:  224,    // the model looks at 224×224 pixels
  };

  const MESSAGES = {
    too_dark:   'This photo is too dark. Move to a brighter spot.',
    too_bright: 'This photo is washed out by too much light. Avoid glare.',
    blank:      "We can't see anything in this photo. Put the item in front of the camera.",
    blurry:     'This photo looks blurry. Hold steady and let the camera focus.',
    small:      'This photo is very small. Move closer or use a higher-quality photo.',
  };

  // rgba: Uint8ClampedArray (or Array) of a SMALL copy of the photo (long side about 256 px)
  // w, h: size of that small copy
  // naturalW, naturalH: size of the ORIGINAL photo
  function assessPhotoQuality(rgba, w, h, naturalW, naturalH) {
    const n = w * h;
    const gray = new Float32Array(n);
    let sum = 0;
    for (let i = 0, p = 0; i < n; i++, p += 4) {
      const g = rgba[p] * 0.299 + rgba[p + 1] * 0.587 + rgba[p + 2] * 0.114;
      gray[i] = g; sum += g;
    }
    const mean255 = sum / n;
    let varSum = 0;
    for (let i = 0; i < n; i++) { const d = gray[i] - mean255; varSum += d * d; }
    const std = Math.sqrt(varSum / n);

    // Sharpness: how much fine detail there is compared with the overall contrast.
    // (Laplacian variance, divided by contrast so dim photos are not unfairly judged.)
    let sharpness = 0;
    if (w >= 3 && h >= 3 && std > 1e-6) {
      let lapSum = 0, lapSq = 0, count = 0;
      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          const i = y * w + x;
          const lap = gray[i - w] + gray[i + w] + gray[i - 1] + gray[i + 1] - 4 * gray[i];
          lapSum += lap; lapSq += lap * lap; count++;
        }
      }
      const lapMean = lapSum / count;
      sharpness = Math.sqrt(Math.max(0, lapSq / count - lapMean * lapMean)) / std;
    }

    const metrics = { brightness: mean255 / 255, contrast: std, sharpness };
    const issues = [];

    if (metrics.brightness < LIMITS.tooDarkMean)        issues.push({ code: 'too_dark',   level: 'hard' });
    else if (metrics.brightness > LIMITS.tooBrightMean) issues.push({ code: 'too_bright', level: 'hard' });
    else if (std < LIMITS.blankStd)                     issues.push({ code: 'blank',      level: 'hard' });
    else if (sharpness < LIMITS.blurRatio)              issues.push({ code: 'blurry',     level: 'soft' });

    if (naturalW && naturalH && Math.min(naturalW, naturalH) < LIMITS.minShortSide) {
      issues.push({ code: 'small', level: 'soft' });
    }
    issues.forEach((it) => { it.message = MESSAGES[it.code]; });

    return {
      ok:      issues.length === 0,
      blocked: issues.some((it) => it.level === 'hard'),   // a hard problem: do not scan at all
      issues,
      metrics,
    };
  }

  return { LIMITS, MESSAGES, assessPhotoQuality };
}));
