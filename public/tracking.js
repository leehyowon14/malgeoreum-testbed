import { lines, complete, event, restore } from './model.js';
import { normalize, wordTracker } from './word-tracking.js';

function candidates(script, start, end, spoken) {
  if (!spoken) return [];
  const found = [];
  for (let i = start; i < end; i++) {
    const line = normalize(script[i].text);
    const matches =
      spoken.endsWith(line) ||
      (line.length >= 10 &&
        spoken.length >= line.length * 0.78 &&
        line.endsWith(spoken));
    if (line && matches) found.push(i);
  }
  return found;
}

// A narrow edit-distance band bounds work for both word and sentence comparisons.
// Sentence acceptance thresholds describe local matching confidence.
const minSimilarity = 0.80;
const minLead = 0.10;
function similarity(a, b) {
  const length = Math.max(a.length, b.length);
  const budget = Math.min(24, Math.ceil(length * (1 - minSimilarity + minLead)));
  if (Math.abs(a.length - b.length) > budget) return 0;
  const outside = budget + 1;
  let prev = new Uint32Array(b.length + 1).fill(outside);
  let row = new Uint32Array(b.length + 1);
  for (let j = 0; j <= Math.min(b.length, budget); j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    const first = Math.max(1, i - budget);
    const last = Math.min(b.length, i + budget);
    row[first - 1] = first === 1 ? i : outside;
    if (last < b.length) row[last + 1] = outside;
    let lowest = outside;
    for (let j = first; j <= last; j++) {
      const substitution = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + substitution);
      lowest = Math.min(lowest, row[j]);
    }
    if (lowest > budget) return 0;
    [prev, row] = [row, prev];
  }
  return prev[b.length] <= budget ? 1 - prev[b.length] / length : 0;
}

function approximateCandidate(script, start, end, spoken) {
  if (spoken.length < 12) return -1;
  let best = -1;
  let bestScore = 0;
  let runnerUp = 0;
  // The preceding line can veto a match when a presenter repeats it.
  for (let i = Math.max(0, start - 1); i < end; i++) {
    const score = similarity(spoken, normalize(script[i].text));
    if (score > bestScore) {
      runnerUp = bestScore;
      bestScore = score;
      best = i;
    } else {
      runnerUp = Math.max(runnerUp, score);
    }
  }
  if (best < start || bestScore < minSimilarity || bestScore - runnerUp < minLead)
    return -1;
  const line = normalize(script[best].text);
  // A prefix alone is insufficient evidence that the speaker reached the checkpoint.
  if (line.length < 12 || line.startsWith(spoken) || !spoken.endsWith(line.slice(-3)))
    return -1;
  return best;
}

export function matchSentence(script, index, text) {
  const spoken = normalize(text);
  const end = Math.min(script.length, index + 4);
  const matches = candidates(script, index, end, spoken);
  if (matches.length) return matches.length === 1 ? matches[0] : -1;
  return approximateCandidate(script, index, end, spoken) === index ? index : -1;
}
// Evidence is scoped to one connection. No raw speech is written into a run.
export function tracker(run) {
  const generation = run.generation,
    used = new Set();
  const script = lines(run.plan);
  const words = wordTracker(script, similarity, run.active);
  let previousCandidates = [];
  return function receive({ operation, text, observed, partial = false }) {
    if (
      run.status !== 'running' ||
      run.generation !== generation ||
      run.pausedAt !== null ||
      !['auto', 'searching', 'hold'].includes(run.control) ||
      used.has(operation) || run.seen.includes(operation) ||
      (observed != null && run.lastObservation != null && observed < run.lastObservation)
    )
      return false;
    if (!partial) {
      const cut = words.boundary(run.index, text);
      if (cut !== null) {
        // Only the end of the whole audio item has an observed time.
        const earlier = receive({
          operation: operation + '/before/' + script[run.index].id,
          text: text.slice(0, cut),
        });
        const later = receive({ operation, text: text.slice(cut), observed });
        return earlier || later;
      }
    }
    let start = run.index;
    while (
      start > 0 &&
      run.unconfirmedSkips?.includes(
        script[start - 1].group || script[start - 1].id,
      )
    )
      start--;
    if (start >= script.length) return false;
    const word = words.locate({ operation, text, partial, now: run.active, start, index: run.index });
    run.wordCursor = word.cursor;
    if (partial) {
      run.candidate = word.matched ? script[word.cursor.line].id : null;
      return false;
    }
    used.add(operation);
    run.candidate = null;
    const spoken = normalize(text);
    if (!spoken) return false;
    const end = Math.min(run.index + 4, script.length);
    const matches = candidates(script, start, end, spoken);
    let target = matches.length === 1 ? matches[0] : null;
    if (matches.length > 1) {
      const adjacent = matches.filter((i) => previousCandidates.includes(i - 1));
      if (adjacent.length === 1) target = adjacent[0];
    }
    if (!matches.length) {
      const near = approximateCandidate(script, start, end, spoken);
      if (near !== -1) {
        // A fuzzy jump needs corroboration from a different, adjacent final turn.
        if (near === run.index || previousCandidates.includes(near - 1)) target = near;
        matches.push(near);
      }
    }
    if (target === null && word.supportedEnd &&
        (word.fromStable || word.cursor.line === run.index || run.read?.length || word.remote)) {
      target = word.cursor.line;
    }
    previousCandidates = matches;
    if (target === null) {
      // A word in the middle can move the cursor without completing its sentence.
      run.control = word.matched && !word.supportedEnd && matches.length === 0 ? 'auto' : 'hold';
      if (observed != null) run.lastObservation = observed;
      return false;
    }
    run.control = 'auto';
    if (run.index !== target) {
      for (const line of script.slice(run.index, target)) {
        const key = line.group || line.id;
        if (run.omitted.includes(key) && !run.unconfirmedSkips.includes(key))
          run.unconfirmedSkips.push(key);
      }
      event(run, 'recognized-position', { sentenceId: script[target].id });
      run.index = target;
    }
    const line = script[target],
      key = line.group || line.id;
    if (run.omitted.includes(key)) restore(run, key, true);
    run.historicalPace = observed == null || run.active - observed > 3000;
    if (observed != null) run.lastObservation = observed;
    words.reset(run.active);
    run.wordCursor = null;
    return complete(run, {
      operation,
      generation,
      sentenceId: line.id,
      source: 'auto',
      observed,
    });
  };
}
