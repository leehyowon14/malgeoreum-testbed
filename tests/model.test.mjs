import test from 'node:test';
import assert from 'node:assert/strict';
import {
  section,
  sentence,
  newRun,
  setGroup,
  tick,
  togglePause,
  complete,
  changeControl,
  position,
  interval,
  correctPass,
  applyOmissions,
  restore,
  lockEnd,
  validate,
  estimates,
} from '../public/model.js';
import { orderedTranscripts, matchSentence } from '../public/voice.js';
import { writeProject, writeRun } from '../public/repository.js';
function plan() {
  return {
    id: 'plan',
    limit: 90000,
    title: '발표',
    sections: ['소개', '예시', '결론'].map((name, i) => {
      const s = section(name);
      s.sentences = ['문장 하나', '문장 둘', '문장 셋'].map(sentence);
      s.checkpoint = s.sentences.at(-1).id;
      s.target = (i + 1) * 30000;
      return s;
    }),
  };
}
test('문장 그룹은 연속된 선택만 허용하고 해제 시 원래 순서를 보존한다', () => {
  const s = plan().sections[0],
    ids = s.sentences.map((l) => l.id);
  assert.throws(() => setGroup(s, [ids[0], ids[2]]));
  setGroup(s, ids.slice(1));
  assert.equal(s.sentences[1].group, s.sentences[2].group);
  assert.throws(() => setGroup(s, ids.slice(0, 2)));
  setGroup(s, [ids[1]], true);
  assert.deepEqual(
    s.sentences.map((l) => l.id),
    ids,
  );
  assert.ok(s.sentences.every((l) => l.group === null));
});
test('발행 검증과 마지막 문장 및 제한 시간 고정', () => {
  const p = plan();
  validate(p);
  p.sections[1].target = 29000;
  assert.throws(() => validate(p));
  p.sections[1].target = 60000;
  p.limit = 95000;
  assert.throws(() => validate(p));
  lockEnd(p);
  validate(p);
});
test('다음 문장 중복, 위치 이동, 구세대 전사, 누락된 통과 및 보정', () => {
  const p = plan(),
    r = newRun(p, 'rehearsal', 0, 'manual');
  position(r, 2);
  tick(r, 34000);
  const op = {
    operation: 'a',
    generation: r.generation,
    sentenceId: p.sections[0].checkpoint,
    source: 'manual',
  };
  assert.equal(complete(r, op), true);
  assert.equal(complete(r, op), false);
  position(r, 2);
  assert.equal(complete(r, { ...op, operation: 'b' }), false);
  changeControl(r, 'auto');
  assert.equal(complete(r, { ...op, source: 'auto' }), false);
  position(r, 8);
  tick(r, 81000);
  complete(r, {
    operation: 'last',
    generation: r.generation,
    source: 'auto',
    sentenceId: p.sections[2].checkpoint,
    observed: 79000,
  });
  assert.equal(interval(r, 0), 34000);
  assert.equal(interval(r, 1), null);
  assert.equal(interval(r, 2), null);
  const original = r.events.find((e) => e.kind === 'pass');
  correctPass(r, p.sections[0].id, 32000);
  assert.equal(r.events.at(-1).correctsEventId, original.id);
  correctPass(r, p.sections[0].id, null);
  assert.equal(interval(r, 0), null);
});
test('리허설 일시정지와 음성 단절은 별도이며 실행 당시 계획을 고정한다', () => {
  const p = plan(),
    r = newRun(p, 'rehearsal', 1000, 'auto');
  p.limit = 1000;
  tick(r, 41000);
  togglePause(r);
  tick(r, 61000);
  assert.equal(r.active, 40000);
  togglePause(r);
  changeControl(r, 'lost');
  tick(r, 91000);
  assert.equal(r.total, 90000);
  assert.equal(r.active, 70000);
  assert.equal(r.plan.limit, 90000);
});
test('보충 묶음부터 생략하고 필수·현재 문장 보호, 복원 단위 유지', () => {
  const p = plan(),
    future = p.sections[1],
    protectedS = p.sections[2];
  setGroup(
    future,
    future.sentences.map((l) => l.id),
  );
  future.sentences.forEach((l) => (l.importance = 'supplementary'));
  setGroup(
    protectedS,
    protectedS.sentences.map((l) => l.id),
  );
  protectedS.sentences[2].importance = 'required';
  const r = newRun(p, 'live', 0, 'manual');
  r.index = 2;
  r.active = 45000;
  applyOmissions(r);
  assert.deepEqual(r.omitted, [future.sentences[0].group]);
  restore(r, r.omitted[0]);
  r.active = 89000;
  applyOmissions(r);
  assert.deepEqual(r.omitted, []);
  assert.deepEqual(r.passes, {});
  assert.equal(
    Object.values(estimates(p)).reduce((a, b) => a + b, 0),
    90000,
  );
});
test('기록 저장 재시도와 같은 계획에 대한 경쟁 쓰기', () => {
  const data = { projects: [], runs: [] },
    p = { id: 'p', plan: plan(), draft: null };
  writeProject(data, p, 0);
  assert.throws(() => writeProject(data, p, 0));
  writeProject(data, p, 1);
  const r = newRun(p.plan, 'live', 0, 'manual');
  writeRun(data, r);
  writeRun(data, r);
  assert.equal(data.projects[0].serial, 2);
  assert.equal(data.runs.length, 1);
});
test('완료 전사가 역순으로 도착해도 발화 순서로 처리하고 부분 결과는 통과하지 않는다', () => {
  const events = [],
    receive = orderedTranscripts((e) => events.push(e.operation));
  receive({
    type: 'conversation.item.input_audio_transcription.delta',
    item_id: 'a',
  });
  const commit = (id, prev) =>
    receive(
      {
        type: 'input_audio_buffer.committed',
        item_id: id,
        previous_item_id: prev,
      },
      1000,
    );
  const done = (id) =>
    receive({
      type: 'conversation.item.input_audio_transcription.completed',
      item_id: id,
      transcript: id,
    });
  commit('a', null);
  commit('b', 'a');
  done('b');
  assert.deepEqual(events, []);
  done('a');
  done('a');
  assert.deepEqual(events, ['a', 'b']);
  const script = ['시작합니다.', '다음으로 넘어갑니다.', '고맙습니다.'].map(
    sentence,
  );
  assert.equal(matchSentence(script, 0, '다음으로 넘어갑니다'), 1);
  assert.equal(matchSentence(script, 0, '질문입니다'), -1);
});
