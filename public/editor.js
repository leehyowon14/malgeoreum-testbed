import { clock, levels, checkpoints, lines } from './model.js';
import { esc, btn, field, timeField, head, num, pair, choose } from './ui.js';
export function editorView(state) {
  const { page, draft: p, sectionIndex: i, selected } = state;
  const s = p.sections[i];

  const options = p.sections.map((s, j) => [
    String(j),
    num(j) + '　' + s.title,
  ]);
  const pickSection = choose('sectionIndex', '대본 구간', options, String(i));
  if (page === 'editor') {
    const cards = p.sections
      .map(
        (sec, j) =>
          '<article class="card"><div class="between"><h3>' +
          num(j) +
          '　' +
          esc(sec.title || '새 구간') +
          '</h3>' +
          btn('edit-section', '편집', 'link', j) +
          '</div>' +
          (j === i
            ? sec.sentences
                .map(
                  (l) =>
                    '<p class="script-line">' +
                    esc(l.text || '대본 문장을 입력하세요.') +
                    '</p>',
                )
                .join('')
            : '') +
          '</article>',
      )
      .join('');
    return [
      head('대본 편집', '목록') +
        field('title', '발표 제목', p.title, 'placeholder="발표 제목 입력"') +
        timeField('limit', '전체 제한 시간', p.limit) +
        '<div class="between"><strong class="small active-text">대본 구간</strong>' +
        btn('add-section', '＋ 구간 추가', 'link') +
        '</div>' +
        cards,
      btn('group-page', '문장 선택·묶기') +
        btn('targets', '다음: 구간별 목표 시간', 'btn primary'),
    ];
  }
  if (page === 'group') {
    const rows = s.sentences
      .map(
        (l) =>
          '<button class="select-line ' +
          (selected.includes(l.id) ? 'on' : '') +
          '" data-action="select-line" data-arg="' +
          l.id +
          '" aria-pressed="' +
          selected.includes(l.id) +
          '"><small>' +
          levels[l.importance] +
          (l.group
            ? ' · ' +
              s.sentences.filter((x) => x.group === l.group).length +
              '문장 묶음'
            : '') +
          '</small><br>' +
          esc(l.text) +
          '</button>',
      )
      .join('');
    return [
      head('문장 선택', '대본 편집') +
        pickSection +
        '<b>' +
        selected.length +
        '문장 선택</b>' +
        rows,
      '<div class="row">' +
        btn('group-set', '함께 묶기', 'btn', '', selected.length < 2) +
        btn(
          'group-clear',
          '묶음 해제',
          'btn',
          '',
          !selected.some((k) => s.sentences.find((l) => l.id === k)?.group),
        ) +
        '</div>' +
        btn('back', '완료', 'btn primary'),
    ];
  }
  if (page === 'targets') {
    const points = checkpoints(p),
      pointIndex = state.pointIndex,
      cp = points[pointIndex];
    const last = pointIndex === points.length - 1,
      script = lines(p);
    const options = script.map((l) => [l.id, l.text]);
    if (!script.some((l) => l.id === cp.checkpoint))
      options.unshift(['', '연결된 문장이 없어 다시 지정해야 합니다']);
    const card =
      '<div class="card"><h3>' +
      num(pointIndex) +
      '　' +
      esc(cp.title) +
      '</h3>' +
      field('cpTitle', '체크포인트 이름', cp.title) +
      choose('checkpoint', '문장 끝 위치', options, cp.checkpoint || '', last) +
      timeField('target', '발표 시작 후 목표 시간', cp.target, last) +
      (last
        ? '<p class="hint">발표 끝은 전체 제한 시간에 맞춰요.</p>'
        : btn('delete-point', '이 체크포인트 삭제', 'link')) +
      '</div>';
    const others = points
      .map((sec, j) =>
        j === pointIndex
          ? ''
          : '<button data-action="target-section" data-arg="' +
            j +
            '">' +
            pair(
              num(j) + '　' + sec.title + ' 끝',
              sec.target == null ? '시간 입력' : clock(sec.target, true),
            ) +
            '</button>',
      )
      .join('');
    return [
      head('구간별 목표 시간', '대본 편집') +
        '<p class="sub">각 구간을 발표 시작 후 몇 분 몇 초에 마칠지 정하세요.</p>' +
        card +
        btn('add-point', '＋ 체크포인트 추가', 'link') +
        (others
          ? pair('남은 체크포인트', '누적 목표') +
            '<div class="card">' +
            others +
            '</div>'
          : ''),
      btn('importance', '다음: 문장 중요도', 'btn primary'),
    ];
  }
  return [
    head('문장 중요도', '목표 시간') +
      '<p class="sub">시간이 부족하면 보충, 일반 순으로 줄여요.</p>' +
      pickSection +
      s.sentences
        .map(
          (l) =>
            '<article class="card"><small class="eyebrow">' +
            levels[l.importance] +
            '</small><p>' +
            esc(l.text) +
            '</p><div class="tabline">' +
            Object.entries(levels)
              .map(([key, label]) =>
                btn(
                  'level',
                  label,
                  'choice ' + (l.importance === key ? 'on' : ''),
                  l.id + '/' + key,
                ),
              )
              .join('') +
            '</div></article>',
        )
        .join(''),
    btn('publish', '설정 저장', 'btn primary'),
  ];
}
export function sectionForm(sec) {
  return (
    '<h2>구간 편집</h2>' +
    field('sectionTitle', '구간 이름', sec.title) +
    '<div class="list">' +
    sec.sentences
      .map(
        (l, i) =>
          '<label class="field">문장 ' +
          num(i) +
          '<textarea name="sentence" data-id="' +
          l.id +
          '" rows="2">' +
          esc(l.text) +
          '</textarea></label>' +
          (sec.sentences.length > 1
            ? btn('delete-sentence', '문장 ' + num(i) + ' 삭제', 'link', l.id)
            : ''),
      )
      .join('') +
    '</div>' +
    btn('add-sentence', '＋ 문장 추가') +
    '<div class="row">' +
    btn('cancel-sheet', '취소') +
    btn('apply-section', '적용', 'btn primary') +
    '</div>'
  );
}
