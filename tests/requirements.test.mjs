import test from 'node:test';
import assert from 'node:assert/strict';
import {
  section,
  sentence,
  checkpoints,
  editablePoints,
  addCheckpoint,
  validate,
  lockEnd,
  newRun,
  complete,
  changeControl,
  interval,
  aggregate,
  estimates,
  representative,
  restore,
  applyOmissions,
} from '../public/model.js';
import { tracker } from '../public/tracking.js';
import { orderedTranscripts } from '../public/voice.js';
import { mockIssuer, logout } from '../public/services.js';

function fixture() {
  const s = section('대본');
  s.sentences = [
    '도입입니다',
    '첫 번째 주제입니다',
    '두 번째 주제입니다',
    '마지막 문장입니다',
  ].map(sentence);
  s.checkpoint = s.sentences.at(-1).id;
  s.target = 120000;
  return { id: 'p1', title: '발표', revision: 1, sections: [s], limit: 120000 };
}
test('FR-03~06 독립 체크포인트 추가·이름·삭제·연결 소실과 과거 버전', () => {
  const plan = fixture(),
    original = newRun(plan, 'live', 0, 'manual'),
    cps = editablePoints(plan);
  const i = addCheckpoint(plan);
  cps[i].title = '도입 끝';
  validate(plan);
  assert.equal(checkpoints(original.plan).length, 1);
  addCheckpoint(plan);
  validate(plan);
  cps[1].checkpoint = cps[0].checkpoint;
  assert.throws(() => validate(plan), /위치/);
  cps.splice(1, 1);
  plan.sections[0].sentences.shift();
  lockEnd(plan);
  assert.throws(() => validate(plan), /다시 지정/);
  cps[0].checkpoint = plan.sections[0].sentences[0].id;
  validate(plan);
});
test('FR-05·08·09 미확인 구간을 합산하고 추정 또는 역순 관측과 일시정지를 추천에서 제외', () => {
  const p = fixture();
  addCheckpoint(p);
  addCheckpoint(p);
  const r = newRun(p, 'rehearsal', 0, 'auto'),
    [a, b, c] = checkpoints(p);
  r.status = 'completed';
  r.passes[a.id] = { at: 15000, source: 'auto' };
  r.passes[c.id] = { at: 100000, source: 'manual' };
  assert.equal(interval(r, 2), null);
  assert.deepEqual(aggregate(r, 2), { start: 0, ms: 85000 });
  r.passes[b.id] = { at: 20000, source: 'estimated' };
  assert.equal(interval(r, 1), null);
  r.passes[b.id] = { at: 14000, source: 'corrected' };
  assert.equal(interval(r, 1), null);
  assert.equal(representative(r, p), true);
  r.pausedMs = 20000;
  assert.equal(representative(r, p), false);
});
test('FR-10·11·14 부분 수정, 질문, 복귀, 중복 및 구세대 응답', () => {
  const r = newRun(fixture(), 'rehearsal', 0, 'searching'),
    receive = tracker(r);
  const script = r.plan.sections[0].sentences;
  receive({ operation: 'a', text: '도입', partial: true });
  assert.equal(r.candidate, null);
  receive({ operation: 'a', text: script[0].text, partial: true });
  assert.equal(r.candidate, script[0].id);
  assert.equal(r.index, 0);
  receive({ operation: 'b', text: '질문' });
  assert.equal(r.control, 'hold');
  receive({ operation: 'c', text: script[0].text, observed: 10 });
  assert.equal(r.index, 1);
  receive({ operation: 'c', text: script[1].text, observed: 10 });
  assert.equal(r.index, 1);
  receive({ operation: 'old', text: script[1].text, observed: 5 });
  assert.equal(r.index, 1);
  changeControl(r, 'manual');
  receive({ operation: 'late', text: script[1].text });
  assert.equal(r.index, 1);
  const deltas = [];
  const wire = orderedTranscripts(
    () => {},
    (p) => deltas.push(p.text),
  );
  const msg = {
    item_id: 'u',
    type: 'conversation.item.input_audio_transcription.delta',
    delta: '안',
    event_id: '1',
  };
  wire(msg);
  wire(msg);
  wire({ ...msg, delta: '녕', event_id: '2' });
  assert.deepEqual(deltas, ['안', '안녕']);
});
test('FR-11 반복 문구만으로 이동하지 않고 다른 발화 문맥으로 복귀한다', () => {
  const p = fixture();
  p.sections[0].sentences[1].text = '도입입니다';
  const r = newRun(p, 'live', 0, 'searching'),
    receive = tracker(r);
  receive({ operation: 'a', text: '도입입니다' });
  assert.equal(r.control, 'hold');
  assert.equal(r.index, 0);
  receive({ operation: 'b', text: '두 번째 주제입니다' });
  assert.equal(r.index, 3);
});

test('FR-11 단어가 일부 달라도 현재 문장을 확인하고, 부분 전사와 중복 완료는 통과를 만들지 않는다', () => {
  const p = fixture();
  p.sections[0].sentences[0].text = '우리가 무심코 버리는 컵은 캠퍼스에서 매일 수백 개씩 쌓입니다.';
  const added = addCheckpoint(p);
  const cp = checkpoints(p)[added];
  const r = newRun(p, 'rehearsal', 0, 'auto');
  const receive = tracker(r);
  const turn = {
    operation: 'cups',
    text: '우리가 무심코 버린 컵은 캠퍼스에 매일 수백 개씩 쌓입니다.',
    observed: 4200,
  };
  r.active = 4200;
  receive({ ...turn, partial: true });
  assert.equal(r.index, 0);
  assert.deepEqual(r.passes, {});
  receive(turn);
  assert.equal(r.index, 1);
  assert.deepEqual(r.passes[cp.id], { at: 4200, source: 'auto' });
  receive(turn);
  assert.equal(r.events.filter(e => e.kind === 'pass').length, 1);
});

test('FR-11 비슷한 후보·미완성 문장은 보류하고, 연속된 두 발화로 앞쪽 위치를 다시 찾는다', () => {
  const p = fixture();
  const script = p.sections[0].sentences;
  script[0].text = '올해 캠퍼스에서 일회용 컵 사용량이 크게 줄었습니다.';
  script[1].text = '올해 캠퍼스에서 다회용 컵 사용량이 크게 줄었습니다.';
  script[2].text = '학생들이 제안한 분리수거 개선안을 소개하겠습니다.';
  script[3].text = '마지막으로 설문 조사에 참여한 학생들에게 감사드립니다.';
  const r = newRun(p, 'live', 0, 'auto');
  const receive = tracker(r);
  receive({ operation: 'unclear', text: '올해 캠퍼스에서 공용 컵 사용량이 크게 줄었습니다.' });
  assert.equal(r.control, 'hold');
  assert.equal(r.index, 0);
  receive({ operation: 'prefix', text: '올해 캠퍼스에서 일회용 컵 사용량이 크게' });
  assert.equal(r.index, 0);
  const next = { operation: 'third', text: '학생들이 제시한 분리수거 개선안을 소개하겠습니다.' };
  receive(next);
  receive(next);
  assert.equal(r.index, 0);
  assert.deepEqual(r.passes, {});
  receive({ operation: 'last', text: '마지막으로 설문 조사에 참여한 학생분들께 감사드립니다.' });
  assert.equal(r.control, 'auto');
  assert.deepEqual(r.read, [script[3].id]);
  assert.equal(r.index, 4);
});
test('FR-16·17 생략 대상 실제 발화와 후속 문장으로 확인한 생략을 구분한다', () => {
  function delayed() {
    const p = fixture(),
      script = p.sections[0].sentences;
    const run = newRun(p, 'live', 0, 'auto');
    run.estimating = estimates(p);
    run.active = 51000;
    script.forEach(
      (l, i) =>
        (run.plan.sections[0].sentences[i].importance =
          i === 1 ? 'supplementary' : 'required'),
    );
    applyOmissions(run);
    assert.deepEqual(run.omitted, [script[1].id]);
    return run;
  }
  const r = delayed(),
    speech = tracker(r),
    script = r.plan.sections[0].sentences;
  speech({ operation: 'one', text: script[0].text, observed: r.active });
  assert.equal(r.index, 2);
  assert.equal(
    r.events.some((e) => e.kind === 'skip'),
    false,
  );
  speech({ operation: 'two', text: script[1].text, observed: r.active });
  assert.ok(r.read.includes(script[1].id));
  assert.equal(
    r.events.some((e) => e.kind === 'skip'),
    false,
  );
  const other = delayed(),
    follow = tracker(other),
    otherScript = other.plan.sections[0].sentences;
  follow({ operation: 'one', text: otherScript[0].text });
  follow({ operation: 'three', text: otherScript[2].text });
  assert.equal(other.events.filter((e) => e.kind === 'skip').length, 1);
  assert.deepEqual(other.passes, {});
  const restored = delayed();
  restore(restored, restored.omitted[0]);
  assert.deepEqual(restored.omitted, []);
  assert.ok(restored.overrun > 0);
});
test('FR-19·20 Mock 인증 거부는 모의 공급자 발급 0회, 새 연결은 새 요청', async () => {
  logout();
  const stats = { requests: 0, grants: 0 };
  await assert.rejects(mockIssuer('auth', stats));
  assert.equal(stats.requests, 2);
  assert.equal(stats.grants, 0);
  await mockIssuer('ok', stats);
  await mockIssuer('ok', stats);
  assert.equal(stats.grants, 2);
});
