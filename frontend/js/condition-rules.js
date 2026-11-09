// ============================================================
// e-Patong — Condition rules (usable / for parts / for disposal)
//
// BEFORE: the "condition" was guessed from how bright the photo was.
//         That does not measure condition at all (a cracked laptop in a
//         bright photo looked "Still Usable").
// NOW   : the user answers 3 simple questions, and these rules turn the
//         answers into one of the same three labels.
//
// THIS ONE FILE is used by BOTH:
//   - the scan page (browser)    -> shows the result as soon as you answer
//   - the server (routes/scan.js)-> works it out AGAIN when you press Save
// so the two can never disagree, and the browser can't make up a condition.
// ============================================================
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ConditionRules = factory();
}(typeof self !== 'undefined' ? self : this, function () {

  // The 3 questions, shown on the scan page
  const QUESTIONS = [
    { key: 'works',    title: 'Does it still work?',
      choices: [ { value: 'yes', text: 'Works' }, { value: 'no', text: "Doesn't work" }, { value: 'unsure', text: 'Not sure' } ] },
    { key: 'damage',   title: 'Is it damaged?',
      choices: [ { value: 'none', text: 'No damage' }, { value: 'minor', text: 'Minor (scratches, small cracks)' },
                 { value: 'major', text: 'Major (cracked screen, broken, burnt, swollen)' } ] },
    { key: 'complete', title: 'Is it complete?',
      choices: [ { value: 'yes', text: 'Nothing missing' }, { value: 'no', text: 'Something is missing' } ] },
  ];

  // The three labels (same wording the app has always used)
  const CONDITIONS = {
    usable: {
      label: 'Still Usable', icon: '✅',
      description: 'This item appears to be in good condition and may still be functional. Consider donating or reselling before disposal.',
    },
    for_parts: {
      label: 'For Parts Only', icon: '⚠️',
      description: 'This item shows signs of wear or damage. It may still have recoverable components or materials useful for repair.',
    },
    for_disposal: {
      label: 'Recommended for Disposal', icon: '♻️',
      description: 'This item appears heavily damaged or degraded. Please dispose of it at a proper e-waste collection facility.',
    },
  };

  // Are the answers complete and made only of allowed values?
  function isValidAnswers(a) {
    if (!a || typeof a !== 'object') return false;
    return QUESTIONS.every((q) =>
      typeof a[q.key] === 'string' && q.choices.some((c) => c.value === a[q.key]));
  }

  // THE RULE:
  //   Still Usable   -> it works, damage is none or minor, and nothing is missing
  //   For Disposal   -> it does NOT clearly work AND it is badly damaged
  //   For Parts Only -> everything else (e.g. works but badly damaged, or does not work but not broken)
  // Returns { status, label, icon, description } or null if the answers are not valid.
  function decideCondition(a) {
    if (!isValidAnswers(a)) return null;
    const works = a.works === 'yes';
    let status;
    if (works && a.damage !== 'major' && a.complete === 'yes') status = 'usable';
    else if (!works && a.damage === 'major')                   status = 'for_disposal';
    else                                                       status = 'for_parts';
    return Object.assign({ status }, CONDITIONS[status]);
  }

  // The category has a peso RANGE (min to max). The condition decides which part of it applies:
  //   usable       -> the upper half
  //   for parts    -> the middle half
  //   for disposal -> the lower half
  // The result always stays inside the range the admin set.
  function bandFor(status, min, max) {
    const lo = Number(min), hi = Number(max), r = hi - lo;
    const cut = (x) => Math.round(x * 100) / 100;
    if (status === 'usable')       return { min: cut(lo + 0.50 * r), max: cut(hi) };
    if (status === 'for_parts')    return { min: cut(lo + 0.25 * r), max: cut(lo + 0.75 * r) };
    if (status === 'for_disposal') return { min: cut(lo),            max: cut(lo + 0.50 * r) };
    return { min: cut(lo), max: cut(hi) };
  }

  return { QUESTIONS, CONDITIONS, isValidAnswers, decideCondition, bandFor };
}));
