const wordPattern = /[\p{L}\p{N}\p{M}]+/gu;
const contextSize = 4;

export const normalize = (text) =>
  text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

function tails(keys) {
  const result = [];
  let joined = '';
  for (let i = keys.length - 1; i >= Math.max(0, keys.length - contextSize); i--) {
    joined = keys[i] + joined;
    result.push(joined);
  }
  return result;
}

function indexWords(script) {
  return script.map(({ text }, line) => {
    const keys = [], entries = [];
    for (const match of text.matchAll(wordPattern)) {
      const key = normalize(match[0]);
      if (!key) continue;
      keys.push(key);
      entries.push({
        key, tails: tails(keys),
        cursor: { line, word: entries.length, start: match.index, end: match.index + match[0].length },
      });
    }
    return entries;
  });
}

// Compare suffixes ending at a specific script word. Joining words on both sides
// accommodates Korean spacing differences and a word split across audio commits.
function scoreWord(entry, heard, similarity, nearby, remote) {
  // Require a whole recognized word or an exact span with different spacing.
  // Earlier words may be approximate when choosing between repeated locations.
  if (!entry.tails.some((tail) => heard.includes(tail))) return null;

  let best = null;
  for (let h = 0; h < heard.length; h++) {
    for (let s = 0; s < entry.tails.length; s++) {
      const count = Math.min(h, s) + 1;
      if (remote && (count < 3 || heard[h].length < 8)) continue;
      if (!nearby && (count < 2 || heard[h].length < 5)) continue;
      const target = entry.tails[s];
      const same = heard[h] === target;
      if (!same && (target.length < 3 || heard[h].length < 3)) continue;
      const ratio = same ? 1 : similarity(heard[h], target);
      if (ratio < (remote ? 0.86 : count === 1 ? 0.74 : 0.78)) continue;
      const score = ratio + (count - 1) * 0.075;
      if (!best || score > best.score) best = { score, count, ratio };
    }
  }
  return best;
}

function findWord(indexed, heard, similarity, { start, end, localEnd, center, expected }) {
  let best = null, second = null;
  if (heard.length < 3 || heard.at(-1).length < 8) end = Math.min(localEnd, end);
  for (let line = start; line < end; line++) {
    for (const entry of indexed[line]) {
      const distance = line === center ? Math.abs(entry.cursor.word - expected) : Infinity;
      const nearby = distance <= 3 || (line === center && heard[0] === entry.key && entry.key.length >= 4);
      const evidence = scoreWord(entry, heard, similarity, nearby, line >= localEnd);
      if (!evidence) continue;
      const option = { entry, distance, ...evidence };
      if (!best || option.score > best.score || (option.score === best.score && distance < best.distance)) {
        second = best;
        best = option;
      } else if (!second || option.score > second.score ||
                 (option.score === second.score && distance < second.distance)) second = option;
    }
  }
  if (!best || !second || best.score - second.score >= 0.055) return best;
  if (best.entry.cursor.line === center && second.entry.cursor.line === center &&
      best.count === 1 && best.distance < second.distance && best.score >= second.score) return best;
  return null;
}

// Stable word evidence and a short transcript tail live only for this connection.
export function wordTracker(script, similarity, startedAt) {
  const indexed = indexWords(script);
  let stable = null, draft = null, history = [], stableContext = 0;
  let furthest = null, progressedAt = startedAt;
  function reset(now) {
    stable = null;
    draft = null;
    history = [];
    stableContext = 0;
    furthest = null;
    progressedAt = now;
  }
  // A commit can span a sentence boundary even when the speaker never pauses.
  function boundary(index, text) {
    const lastWord = indexed[index]?.at(-1), next = indexed[index + 1];
    if (!lastWord || !next?.length) return null;
    const ending = lastWord.tails[1] ?? lastWord.key;
    const opening = next.slice(0, 2).map((entry) => entry.key).join('').slice(0, 6);
    const parts = Array.from(text.matchAll(wordPattern));
    let left = stable?.line === index ? history.join('') : '';
    for (let i = 1; i < parts.length; i++) {
      left += normalize(parts[i - 1][0]);
      if (!left.endsWith(ending)) continue;
      const cut = parts[i].index;
      const right = normalize(text.slice(cut)).slice(0, opening.length);
      if (right.length >= Math.min(3, opening.length) && opening.startsWith(right)) return cut;
    }
    return null;
  }
  function locate({ text, operation, partial, now, start, index }) {
    const input = Array.from(text.matchAll(wordPattern), (m) => normalize(m[0])).filter(Boolean);
    if (!input.length) {
      draft = null;
      return { cursor: stable };
    }
    const sameItem = draft?.operation === operation;
    const continuing = sameItem && text.startsWith(draft.text);
    const anchor = (continuing && draft.cursor) || stable;
    const origin = Math.max(index, stable?.line ?? index);
    const stalled = now - progressedAt;
    const reach = stalled >= 8000 ? indexed.length : stalled >= 3500 ? 12 : 4;
    const localEnd = origin + 4;
    const end = Math.min(indexed.length, Math.max(origin + reach, sameItem ? draft.cursor.line + 1 : 0));
    const window = {
      start, end, localEnd, center: anchor?.line ?? index,
      expected: anchor?.word ?? 0,
    };
    const joined = history.concat(input);
    let best = findWord(indexed, tails(joined), similarity, window);
    let trailing = 0;
    let previous = stable;
    // A delta may contain a complete word and the beginning of the next word.
    for (let back = 1; !best && back <= 2 && back < input.length; back++) {
      const earlier = findWord(indexed, tails(joined.slice(0, -back)), similarity, window);
      if (earlier && (earlier.count >= 2 || earlier.entry.cursor.line === window.center)) {
        best = earlier;
        trailing = back;
      }
    }
    // A chunk can contain two recognized words with a misheard word between them.
    // Recheck its end from the earlier word, within the already located sentence.
    if (!partial && stable && (!best || best.entry.cursor.line === stable.line)) {
      const line = indexed[stable.line], last = line.at(-1);
      if (input.length >= 2 && last.key === input.at(-1)) {
        const heardBeforeEnd = input.slice(-3, -1);
        const beforeEnd = line.slice(Math.max(stable.word, last.cursor.word - 2), last.cursor.word);
        const anchor = beforeEnd.findLast((w) => w.key !== last.key && heardBeforeEnd.includes(w.key));
        if (anchor) {
          previous = anchor.cursor;
          best = { entry: last, count: 2, ratio: 1 };
          trailing = 0;
        }
      }
    }
    if (!best) {
      if (!partial) {
        history = input.slice(-contextSize);
        draft = null;
      } else if (!continuing || input[draft.lastIndex] !== draft.lastToken) draft = null;
      return { cursor: draft?.cursor ?? stable };
    }
    const cursor = best.entry.cursor;
    const fromStable = previous?.line === cursor.line && previous.word < cursor.word;
    const finalWord = best.entry.key === input.at(-1);
    const nearWords = stableContext >= 2 && input.length >= 2 ? 3 : 2;
    const endWindow = best.entry.key.length >= 4
      ? Math.max(nearWords, Math.ceil(indexed[cursor.line].length / 3)) : nearWords;
    const nearEnd = fromStable && cursor.word - previous.word <= endWindow;
    const supportedEnd = trailing === 0 && cursor.word === indexed[cursor.line].length - 1 &&
      ((fromStable && (best.count >= 2 || (nearEnd && finalWord))) ||
       (best.count >= 3 && best.ratio >= 0.86 && input.length >= 3));
    if (!furthest || cursor.line > furthest.line ||
        (cursor.line === furthest.line && cursor.word > furthest.word)) {
      furthest = cursor;
      progressedAt = now;
    }
    if (partial) {
      const lastIndex = input.length - 1 - trailing;
      draft = { operation, text, cursor, lastIndex, lastToken: input[lastIndex] };
    } else {
      history = history.concat(input).slice(-contextSize);
      stable = cursor;
      stableContext = best.count;
      draft = null;
    }
    return { cursor, matched: true, supportedEnd, fromStable, remote: cursor.line >= localEnd };
  }
  return { locate, reset, boundary };
}
