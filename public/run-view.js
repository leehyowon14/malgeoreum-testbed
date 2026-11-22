import {
  clock,
  lines,
  interval,
  checkpoints,
  aggregate,
  trustedTime,
} from './model.js';
import {
  esc,
  btn,
  timeField,
  head,
  num,
  pair,
  choose,
  groupKey,
} from './ui.js';
const label = {
  auto: '자동 관측',
  manual: '수동 확인',
  corrected: '보정',
  estimated: '수신 시각 추정',
};
export function timerText(r) {
  const ms = r.plan.limit - r.active;
  return [
    (ms < 0 ? '+' : '') + clock(Math.abs(ms), true),
    ms < 0 ? '제한 시간 초과' : '남은 시간',
  ];
}
export function markedText(text, cursor) {
  if (!cursor) return esc(text);
  return esc(text.slice(0, cursor.start)) +
    '<mark class="word-cursor" data-word="' + cursor.word + '">' +
    esc(text.slice(cursor.start, cursor.end)) + '</mark>' + esc(text.slice(cursor.end));
}
export function runView(r, browsing = false) {
  const script = lines(r.plan);
  const position = r.wordCursor?.line ?? r.index;
  const current = script[position];
  const section = r.plan.sections.find((s) =>
    s.sentences.some((l) => l.id === current?.id),
  );
  const manual = r.control === 'manual',
    paused = r.pausedAt !== null;
  const rehearsal = r.mode === 'rehearsal';
  const name = rehearsal ? '리허설' : manual ? '수동 진행' : '실전';
  const points = checkpoints(r.plan);
  const confirmed = points
    .filter((p, i) => trustedTime(r, i) !== null)
    .sort((a, b) => r.passes[a.id].at - r.passes[b.id].at)
    .at(-1);
  const delta = confirmed
    ? Math.round((r.passes[confirmed.id].at - confirmed.target) / 1000)
    : 0;
  const pace = confirmed
    ? confirmed.title +
      ' / ' +
      (delta === 0
        ? '목표 시간에 통과'
        : '목표보다 ' + Math.abs(delta) + '초 ' + (delta > 0 ? '지연' : '빠름'))
    : '첫 체크포인트까지 진행 중';
  const [time, caption] = timerText(r);
  const body = [];
  let previous = position - 1;
  while (previous >= 0 && r.omitted.includes(groupKey(script[previous])))
    previous--;
  for (let i = browsing ? 0 : Math.max(0, previous); i < script.length; i++) {
    if (
      !browsing &&
      i < r.index &&
      r.omitted.includes(groupKey(script[i])) &&
      !r.unconfirmedSkips?.includes(groupKey(script[i]))
    )
      continue;
    const l = script[i],
      key = groupKey(l);
    if (r.omitted.includes(key)) {
      const group = [l];
      while (i + 1 < script.length && groupKey(script[i + 1]) === key)
        group.push(script[++i]);
      body.push(
        '<button class="omitted" data-action="restore" data-arg="' +
          key +
          '" aria-label="' +
          esc('생략된 ' + group.length + '문장 복원') +
          '"' +
          (i < r.index && !r.unconfirmedSkips?.includes(key)
            ? ' disabled'
            : '') +
          '><small>생략됨 · ' +
          group.length +
          '문장</small>' +
          group
            .map((x, j) => {
              const line = i - group.length + 1 + j;
              return '<span class="utterance" data-line="' + line + '">' +
                markedText(x.text, line === position ? r.wordCursor : null) + '</span>';
            })
            .join('') +
          '</button>',
      );
    } else
      body.push(
        '<p data-line="' + i + '" class="utterance ' +
          (i === position ? 'current' : i < position ? 'previous' : '') +
          '">' +
          markedText(l.text, i === position ? r.wordCursor : null) +
          '</p>',
      );
  }
  let actions = '';
  if (paused)
    actions =
      btn('pause', '이어서 연습하기', 'btn primary') +
      btn('restart', '처음부터 연습') +
      btn('end', '연습 종료');
  else {
    if (manual)
      actions += btn('next', '다음 문장', 'btn primary', current?.id, !current);
    const control = manual
      ? btn('reconnect', '자동 추적 다시 시작')
      : btn('manual', '수동 진행');
    actions += rehearsal
      ? '<div class="row">' +
        btn('pause', '일시정지') +
        btn('end', '연습 종료', 'btn primary') +
        '</div>'
      : '<div class="row">' + control + btn('end', '발표 종료') + '</div>';
    if (rehearsal)
      actions +=
        '<div class="between">' +
        (manual
          ? btn('reconnect', '자동 추적 다시 시작', 'link')
          : btn('manual', '수동 진행', 'link')) +
        btn('locate', '위치 지정', 'link') +
        '</div>';
    else if (manual) actions += btn('locate', '여기부터 이어가기', 'link');
    if (!manual && r.control === 'lost')
      actions += btn('reconnect', '연결 다시 시도');
  }
  const uncertain = ['hold', 'searching', 'lost', 'connecting'].includes(
    r.control,
  );
  const feedback = {
    lost: '음성 연결이 끊겼어요.',
    connecting: '음성 연결을 복구하고 있어요.',
    hold: '대본 위치 확인 중',
    searching: '발화로 시작 위치 확인 중',
  }[r.control];
  const observed = confirmed
    ? '마지막 확인 · ' +
      confirmed.title +
      ' ' +
      clock(r.passes[confirmed.id].at)
    : '아직 확인한 체크포인트가 없어요.';
  if (!paused) {
    const cp = points.find(
      (cp) =>
        !r.passes[cp.id] &&
        script.findIndex((l) => l.id === cp.checkpoint) >= r.index,
    );
    actions +=
      '<div class="between">' +
      btn('browse', browsing ? '현재 위치로 보기' : '전체 대본 보기', 'link') +
      (rehearsal && cp
        ? btn('manual-pass', cp.title + ' 통과 확인', 'link', cp.id)
        : '') +
      '</div>';
  }
  return [
    '<div class="heading"><h1>' +
      name +
      (paused ? ' (일시정지됨)' : '') +
      '</h1></div><div class="timer"><strong id="remaining">' +
      time +
      '</strong><span id="timer-label">' +
      caption +
      '</span></div>' +
      '<p class="hint">' +
      esc(
        feedback
          ? feedback + ' · ' + observed
          : r.historicalPace
            ? observed
            : manual && confirmed
              ? observed + ' · ' + pace
              : pace,
      ) +
      '</p>' +
      (current
        ? '<p class="hint">' +
          num(r.plan.sections.indexOf(section)) +
          '　' +
          esc(section.title) +
          '</p>'
        : '<b>마지막 문장을 확인했어요.</b>') +
      (r.candidate && r.wordCursor && !manual
        ? '<p class="hint">인식된 단어 · <span data-heard-word>' +
          esc(current.text.slice(r.wordCursor.start, r.wordCursor.end)) + '</span></p>'
        : '') +
      (r.overrun > 15000 && !uncertain && !r.historicalPace
        ? '<p class="hint">예상 초과 ' + clock(r.overrun) + '</p>'
        : '') +
      '<div class="script">' +
      body.join('') +
      '</div>',
    actions,
  ];
}
export function resultView(r, i, adjustment) {
  const sections = checkpoints(r.plan),
    s = sections[i],
    observed =
      adjustment && adjustment.checkpoint !== s.checkpoint
        ? null
        : interval(r, i),
    prev = sections[i - 1]?.target || 0;
  if (adjustment) {
    const goal = adjustment.target,
      next = sections[i + 1];
    return [
      head('목표 시간 수정', '결과') +
        '<article class="card"><h3>' +
        num(i) +
        '　' +
        esc(s.title) +
        '</h3>' +
        choose(
          'adjustLine',
          '체크포인트 위치',
          lines(r.plan).map((l) => [l.id, l.text]),
          adjustment.checkpoint,
          !next,
        ) +
        '<p class="hint">기존 위치 · ' +
        esc(lines(r.plan).find((l) => l.id === s.checkpoint)?.text) +
        '</p>' +
        '</article><div class="card">' +
        pair('앞 체크포인트 계획', clock(prev, true)) +
        pair(
          '이번 구간 소요 시간',
          observed === null ? '미확인' : clock(observed, true),
        ) +
        (observed !== null && next
          ? btn('use-observed', '구간 소요 시간 적용', 'link')
          : '') +
        '</div>' +
        timeField('adjustTime', '수정할 누적 목표', goal, !next) +
        '<div class="card" id="impact">' +
        impact(r, i, goal) +
        '</div><p class="hint">다음 발표부터 적용해요.</p>',
      btn('save-adjust', '새 계획으로 저장', 'btn primary') +
        btn('back', '변경 취소'),
    ];
  }
  const diff = Math.round((r.active - r.plan.limit) / 1000);
  const rows = sections
    .map((s, j) => {
      const pass = r.passes[s.id],
        span = interval(r, j);
      const gap = aggregate(r, j),
        unit = lines(r.plan).find((l) => l.id === s.checkpoint);
      const skipped =
        unit &&
        r.events.some((e) => e.kind === 'skip' && e.group === groupKey(unit));
      const d = pass ? Math.round((pass.at - s.target) / 1000) : 0;
      return (
        '<button class="result-row ' +
        (j === i ? 'selected' : '') +
        '" data-action="result-row" data-arg="' +
        j +
        '">' +
        pair(
          num(j) + '　' + s.title,
          clock(s.target) + ' / ' + (pass ? clock(pass.at) : '미확인'),
        ) +
        '<small>' +
        (pass
          ? '누적 ' +
            (d >= 0 ? '+' : '') +
            d +
            '초 · 구간 ' +
            (span === null ? '미확인' : clock(span)) +
            ' · ' +
            label[pass.source]
          : skipped
            ? '축약 경로로 생략 · 통과 시각 없음'
            : '통과 시각 미확인') +
        (pass && trustedTime(r, j) === null ? ' · 검토 필요' : '') +
        ' · 배정 ' +
        clock(s.target - (sections[j - 1]?.target || 0)) +
        (span == null
          ? ''
          : ' (' +
            (span - s.target + (sections[j - 1]?.target ?? 0) >= 0 ? '+' : '') +
            Math.round(
              (span - s.target + (sections[j - 1]?.target ?? 0)) / 1000,
            ) +
            '초)') +
        (gap
          ? ' · ' +
            (gap.start < 0 ? '시작' : esc(sections[gap.start].title)) +
            '부터 합산 ' +
            clock(gap.ms)
          : '') +
        '</small></button>'
      );
    })
    .join('');
  const when = new Intl.DateTimeFormat('ko-KR', {
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(r.startedAt);
  return [
    head(r.mode === 'live' ? '실전 기록' : '리허설 결과', '목록') +
      '<p class="hint">' +
      esc(when) +
      ' · ' +
      (r.status === 'completed' ? '완료' : '중단') +
      (r.total > r.active ? ' · 일시정지 포함' : '') +
      '</p><article class="card"><strong class="result-time">' +
      clock(r.active, true) +
      '</strong><b class="small active-text">목표 ' +
      clock(r.plan.limit) +
      (diff === 0
        ? '에 맞췄어요'
        : '보다 ' + Math.abs(diff) + '초 ' + (diff > 0 ? '초과' : '빠름')) +
      '</b><p class="hint">일시정지 ' +
      clock(r.total - r.active) +
      ' 제외 / 전체 경과 ' +
      clock(r.total) +
      '</p></article>' +
      pair('체크포인트', '목표 / 실제') +
      '<div class="card">' +
      rows +
      '</div>' +
      '<article class="card"><b>' +
      esc(s.title) +
      ' · 문장 위치</b>' +
      (() => {
        const script = lines(r.plan),
          at = script.findIndex((l) => l.id === s.checkpoint);
        return script
          .slice(Math.max(0, at - 1), at + 2)
          .map(
            (l) =>
              '<p class="' +
              (l.id === s.checkpoint ? 'active-text' : 'hint') +
              '">' +
              esc(l.text) +
              '</p>',
          )
          .join('');
      })() +
      '</article>' +
      (r.passes[s.id] ? btn('correct', '선택한 통과 기록 보정', 'link') : '') +
      btn('events', '실행 기록과 보정 이력', 'link'),
    r.mode === 'live'
      ? btn('back', '목록으로 돌아가기')
      : btn(
          'adjust',
          num(i) + ' ' + s.title + ' · 목표 시간 수정',
          'btn primary',
        ) + btn('again', '다시 연습하기'),
  ];
}
export function impact(r, i, value) {
  const sections = checkpoints(r.plan),
    prev = sections[i - 1]?.target || 0,
    old = sections[i].target,
    next = sections[i + 1]?.target;
  const display = (ms) => (ms > 0 ? clock(ms) : '목표 확인');
  return (
    pair(
      '현재 구간 배정',
      clock(old - prev) + ' → ' + (value == null ? '—' : display(value - prev)),
    ) +
    (next
      ? pair(
          '다음 구간 배정',
          clock(next - old) +
            ' → ' +
            (value == null ? '—' : display(next - value)),
        )
      : '') +
    pair('전체 제한 시간', clock(r.plan.limit) + ' 유지')
  );
}
