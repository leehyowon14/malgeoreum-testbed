export const id = () =>
  Array.from(crypto.getRandomValues(new Uint32Array(4)), (n) =>
    n.toString(16).padStart(8, '0'),
  ).join('');
export const levels = {
  required: '필수',
  normal: '일반',
  supplementary: '보충',
};
export const clock = (ms, pad = false) => {
  const sec = Math.max(0, Math.floor(ms / 1000));
  return (
    String(Math.floor(sec / 60)).padStart(pad ? 2 : 1, '0') +
    ':' +
    String(sec % 60).padStart(2, '0')
  );
};
export const parseTime = (text) => {
  const match = String(text)
    .trim()
    .match(/^(\d{1,3})\s*(?::|분\s*)\s*([0-5]?\d)\s*초?$/);
  return match ? (+match[1] * 60 + +match[2]) * 1000 : null;
};
export const sentence = (text = '') => ({
  id: id(),
  text,
  importance: 'normal',
  group: null,
});
export function section(title = '') {
  const line = sentence();
  return {
    id: id(),
    title,
    sentences: [line],
    checkpoint: line.id,
    target: null,
  };
}
export const emptyPlan = () => ({
  title: '',
  limit: 180000,
  sections: [section('도입')],
});
export const lines = (plan) => plan.sections.flatMap((s) => s.sentences);
// Older plans stored one checkpoint on each section. Keep those IDs for saved passes.
export const checkpoints = (plan) => plan.checkpoints ?? plan.sections;
export function editablePoints(plan) {
  return (plan.checkpoints ??= plan.sections.map(
    ({ id, title, checkpoint, target }) => ({ id, title, checkpoint, target }),
  ));
}
export function lockEnd(plan) {
  const last = checkpoints(plan).at(-1);
  last.target = plan.limit;
  last.checkpoint = lines(plan).at(-1).id;
}
export function addCheckpoint(plan) {
  const points = editablePoints(plan);
  const script = lines(plan);
  const unused = script.findIndex(
    (line) => !points.some((cp) => cp.checkpoint === line.id),
  );
  if (unused < 0) throw Error('체크포인트를 추가할 빈 문장 끝이 없습니다.');
  const before = points.findIndex(
    (cp) => script.findIndex((line) => line.id === cp.checkpoint) > unused,
  );
  if (before < 0) throw Error('먼저 발표 끝 위치를 확인하세요.');
  const from = points[before - 1]?.target ?? 0;
  const to = points[before].target;
  const middle = Math.floor((from + to) / 2000) * 1000;
  points.splice(before, 0, {
    id: id(),
    title: '새 체크포인트',
    checkpoint: script[unused].id,
    target: middle > from && middle < to ? middle : null,
  });
  return before;
}
export function validate(plan, targets = true) {
  if (!plan.title.trim()) throw Error('발표 제목을 입력하세요.');
  if (!Number.isInteger(plan.limit) || plan.limit <= 0)
    throw Error('전체 제한 시간을 분:초 형식으로 입력하세요.');
  if (
    !plan.sections.length ||
    plan.sections.some(
      (s) =>
        !s.title.trim() ||
        !s.sentences.length ||
        s.sentences.some((l) => !l.text.trim()),
    )
  )
    throw Error('모든 구간에 이름과 대본 문장을 입력하세요.');
  if (!targets) return;
  let prevIndex = -1,
    previous = 0;
  const script = lines(plan),
    points = checkpoints(plan);
  for (const cp of points) {
    const index = script.findIndex((l) => l.id === cp.checkpoint);
    if (!cp.title.trim()) throw Error('체크포인트 이름을 입력하세요.');
    if (index < 0) throw Error(cp.title + '의 문장 끝을 다시 지정하세요.');
    if (index <= prevIndex)
      throw Error(cp.title + '의 위치는 앞 체크포인트보다 뒤에 있어야 합니다.');
    if (
      !Number.isInteger(cp.target) ||
      cp.target <= previous ||
      cp.target > plan.limit
    )
      throw Error(
        cp.title +
          '의 누적 목표는 앞 목표보다 늦고 전체 제한 시간 이내여야 합니다.',
      );
    prevIndex = index;
    previous = cp.target;
  }
  if (previous !== plan.limit || prevIndex !== script.length - 1)
    throw Error('마지막 목표를 대본 끝과 전체 제한 시간에 맞추세요.');
}
export function setGroup(section, selected, release = false) {
  const chosen = section.sentences.filter((l) => selected.includes(l.id));
  if (release) {
    const groups = new Set(chosen.map((l) => l.group).filter(Boolean));
    if (!groups.size) throw Error('해제할 묶음의 문장을 선택하세요.');
    section.sentences.forEach((l) => {
      if (groups.has(l.group)) l.group = null;
    });
    return;
  }
  const start = section.sentences.indexOf(chosen[0]);
  if (
    chosen.length < 2 ||
    chosen.some((l, i) => section.sentences[start + i] !== l || l.group)
  )
    throw Error(
      '같은 구간에서 아직 묶이지 않은 연속 문장 두 개 이상을 선택하세요.',
    );
  const group = id();
  chosen.forEach((l) => {
    l.group = group;
  });
}
export function newRun(plan, mode, now, control) {
  return {
    id: id(),
    plan: structuredClone(plan),
    mode,
    control,
    connection: control === 'manual' ? 'stopped' : 'receiving',
    status: 'running',
    startedAt: Date.now(),
    start: now,
    total: 0,
    active: 0,
    pausedAt: null,
    pausedMs: 0,
    index: 0,
    generation: 1,
    seen: [],
    read: [],
    unconfirmedSkips: [],
    passes: {},
    events: [],
    omitted: [],
    restored: [],
    offset: 0,
    estimating: null,
  };
}
export function tick(run, now) {
  if (run.status !== 'running') return;
  run.total = Math.max(0, Math.round(now + run.offset - run.start));
  run.active = (run.pausedAt ?? run.total) - run.pausedMs;
}
export function event(run, kind, extra = {}) {
  run.events.push({
    id: id(),
    sequence: run.events.length + 1,
    kind,
    generation: run.generation,
    elapsedMs: run.total,
    activeMs: run.active,
    ...extra,
  });
}
export function changeControl(run, control) {
  run.generation++;
  run.control = control;
  run.connection = {
    manual: 'stopped',
    connecting: 'reconnecting',
    lost: 'unavailable',
    searching: 'receiving',
    auto: 'receiving',
    hold: 'receiving',
  }[control];
  event(run, 'control', { control, connection: run.connection });
}
export function togglePause(run) {
  if (run.mode !== 'rehearsal') return;
  run.generation++;
  if (run.pausedAt === null) {
    run.pausedAt = run.total;
    event(run, 'pause');
  } else {
    run.pausedMs += run.total - run.pausedAt;
    run.pausedAt = null;
    event(run, 'resume');
  }
}
export function trustedTime(run, i) {
  if (i < 0) return 0;
  const points = checkpoints(run.plan),
    pass = run.passes[points[i].id];
  if (!pass || pass.source === 'estimated') return null;
  // A backwards or disputed pair needs review before contributing to pace.
  const conflict = points.some((cp, j) => {
    const other = run.passes[cp.id];
    return (
      other &&
      other.source !== 'estimated' &&
      ((j < i && other.at > pass.at) || (j > i && other.at < pass.at))
    );
  });
  return conflict ? null : pass.at;
}
export function interval(run, i) {
  const end = trustedTime(run, i),
    start = trustedTime(run, i - 1);
  return end === null || start === null ? null : end - start;
}
export function aggregate(run, i) {
  const end = trustedTime(run, i);
  if (end === null || i === 0 || trustedTime(run, i - 1) !== null) return null;
  let j = i - 2;
  while (j >= 0 && trustedTime(run, j) === null) j--;
  return { start: j, ms: end - trustedTime(run, j) };
}
export function representative(r, plan) {
  return (
    r.plan.id === plan.id &&
    r.mode === 'rehearsal' &&
    r.status === 'completed' &&
    !r.pausedMs &&
    r.pausedAt == null &&
    !r.events.some((e) => e.kind === 'pause')
  );
}
export function estimates(plan, rehearsal) {
  const script = lines(plan);
  let start = 0;
  const durations = {};
  const points = checkpoints(plan);
  points.forEach((s, i) => {
    const end = script.findIndex((l) => l.id === s.checkpoint) + 1;
    const span = script.slice(start, end);
    const ms =
      (rehearsal && rehearsal.plan.id === plan.id
        ? interval(rehearsal, i)
        : null) ?? s.target - (points[i - 1]?.target ?? 0);
    const length = span.reduce((n, l) => n + l.text.length, 0);
    span.forEach((l) => {
      durations[l.id] = (ms * l.text.length) / length;
    });
    start = end;
  });
  return durations;
}
const unit = (l) => l.group || l.id;
export function applyOmissions(run) {
  if (
    run.mode !== 'live' ||
    run.pausedAt !== null ||
    !['auto', 'manual'].includes(run.control)
  )
    return;
  const script = lines(run.plan);
  const future = script.slice(run.index);
  const durations = run.estimating || estimates(run.plan);
  let deficit =
    future.reduce(
      (n, l) => n + (run.omitted.includes(unit(l)) ? 0 : durations[l.id]),
      0,
    ) -
    (run.plan.limit - run.active);
  run.overrun = Math.max(0, deficit);
  if (deficit <= 15000) return;
  const protectedUnits = new Set([
    ...script.slice(0, run.index + 1).map(unit),
    ...(run.read || [])
      .map((id) => script.find((l) => l.id === id))
      .filter(Boolean)
      .map(unit),
    ...run.restored,
    ...run.omitted,
  ]);
  const candidates = new Map();
  for (const l of future) {
    const key = unit(l);
    if (protectedUnits.has(key)) continue;
    const group = candidates.get(key) || { key, rank: 0, ms: 0 };
    group.rank = Math.max(
      group.rank,
      ['supplementary', 'normal', 'required'].indexOf(l.importance),
    );
    group.ms += durations[l.id];
    candidates.set(key, group);
  }
  for (const group of [...candidates.values()].sort(
    (a, b) => a.rank - b.rank,
  )) {
    if (deficit <= 0 || group.rank === 2) break;
    run.omitted.push(group.key);
    event(run, 'omit', { group: group.key, estimatedMs: Math.round(group.ms) });
    deficit -= group.ms;
  }
  run.overrun = Math.max(0, deficit);
}
export function restore(run, key, spoken = false) {
  if (
    !run.omitted.includes(key) ||
    (!spoken &&
      !run.unconfirmedSkips?.includes(key) &&
      !lines(run.plan)
        .slice(run.index)
        .some((l) => unit(l) === key))
  )
    return;
  run.omitted = run.omitted.filter((k) => k !== key);
  run.restored.push(key);
  if (!spoken && run.unconfirmedSkips?.includes(key)) {
    const index = lines(run.plan).findIndex((l) => unit(l) === key);
    run.index = index;
    run.unconfirmedSkips = run.unconfirmedSkips.filter((k) => k !== key);
  }
  event(run, 'restore', { group: key, source: spoken ? 'spoken' : 'manual' });
  applyOmissions(run);
}
export function position(run, index) {
  const line = lines(run.plan)[index];
  if (!line || run.omitted.includes(unit(line))) return;
  run.generation++;
  run.unconfirmedSkips = [];
  const from = run.index;
  run.index = index;
  event(run, 'position', {
    sentenceId: line.id,
    from,
    to: index,
    source: 'manual',
  });
}
export function recordPass(run, cp, source, observed, operation = id()) {
  if (!cp || run.passes[cp.id]) return false;
  const at = Math.max(0, Math.min(run.active, observed ?? run.active));
  const evidence = source === 'auto' && observed == null ? 'estimated' : source;
  run.passes[cp.id] = { at, source: evidence };
  event(run, 'pass', {
    checkpointId: cp.id,
    sentenceId: cp.checkpoint,
    operationId: operation,
    source: evidence,
    observedActiveMs: at,
  });
  return true;
}
export function complete(
  run,
  { operation, generation, sentenceId, source, observed },
) {
  const script = lines(run.plan);
  if (
    run.status !== 'running' ||
    run.pausedAt !== null ||
    run.generation !== generation ||
    run.seen.includes(operation) ||
    !script[run.index] ||
    script[run.index].id !== sentenceId ||
    run.control !== source
  )
    return false;
  run.seen.push(operation);
  (run.read ??= []).push(sentenceId);
  recordPass(
    run,
    checkpoints(run.plan).find((cp) => cp.checkpoint === sentenceId),
    source,
    observed,
    operation,
  );
  for (const key of run.unconfirmedSkips ?? []) {
    if (run.omitted.includes(key))
      event(run, 'skip', { group: key, source: 'omission' });
  }
  run.unconfirmedSkips = [];
  run.index++;
  while (
    run.index < script.length &&
    run.omitted.includes(unit(script[run.index]))
  ) {
    const skipped = unit(script[run.index]);
    if (source === 'manual')
      event(run, 'skip', { group: skipped, source: 'omission' });
    else run.unconfirmedSkips.push(skipped);
    do {
      run.index++;
    } while (run.index < script.length && unit(script[run.index]) === skipped);
  }
  if (source === 'manual') run.historicalPace = false;
  if (!run.historicalPace) applyOmissions(run);
  return true;
}
export function correctPass(run, sectionId, at) {
  const pass = run.passes[sectionId];
  if (
    !pass ||
    (at !== null && (!Number.isInteger(at) || at < 0 || at > run.active))
  )
    throw Error('실행 시간 범위 안에서 보정하세요.');
  const prior = run.events.findLast(
    (e) => e.checkpointId === sectionId && ['pass', 'correct'].includes(e.kind),
  );
  event(run, at === null ? 'invalidate' : 'correct', {
    checkpointId: sectionId,
    correctsEventId: prior?.id,
    observedActiveMs: at,
  });
  if (at === null) delete run.passes[sectionId];
  else run.passes[sectionId] = { at, source: 'corrected' };
}
