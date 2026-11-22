import test from 'node:test';
import assert from 'node:assert/strict';
import { section, sentence, newRun } from '../public/model.js';
import { tracker } from '../public/tracking.js';
import { orderedTranscripts, speechCommitter } from '../public/voice.js';
import { markedText } from '../public/run-view.js';

function rehearsal(texts) {
  const sections = texts.map((text) => {
    const s = section('구간');
    s.sentences = [sentence(text)];
    s.checkpoint = s.sentences[0].id;
    return s;
  });
  const run = newRun({ sections, limit: 120000 }, 'rehearsal', 0, 'searching');
  const receive = tracker(run);
  const say = (operation, text, partial = false) =>
    receive({ operation, text, partial, observed: run.active });
  return { run, say, sections };
}

test('부분 전사는 원문의 단어를 표시하고 수정할 수 있으며 확정 전에는 통과하지 않는다', () => {
  const text = '작은 <학교>에서 오늘 모임을 시작합니다.';
  const { run, say } = rehearsal([text]);
  say('a', '작', true);
  assert.equal(run.wordCursor, null);
  say('a', '작은 학', true);
  assert.equal(run.wordCursor.word, 0);
  say('a', '작은 학교', true);
  assert.equal(text.slice(run.wordCursor.start, run.wordCursor.end), '학교');
  assert.match(markedText(text, run.wordCursor), /&lt;<mark[^>]*>학교<\/mark>&gt;/);
  say('a', '동물원', true);
  assert.equal(run.wordCursor, null);
  say('a', text, true);
  assert.equal(run.wordCursor.word, 5);
  assert.deepEqual(run.passes, {});
  assert.deepEqual(run.read, []);
  say('a', '');
  assert.equal(run.wordCursor, null);
  assert.deepEqual(run.read, []);
});

test('완료 전사 사이에서 갈라진 단어와 한국어 띄어쓰기를 이어 한 문장을 한 번 확인한다', () => {
  const { run, say, sections } = rehearsal(['오늘은 서울대학교에서 음성 인식 결과를 비교합니다.']);
  say('a', '오늘은 서울');
  say('b', '대 학교에서 음성인식');
  assert.deepEqual([run.wordCursor.line, run.wordCursor.word], [0, 3]);
  assert.equal(run.index, 0);
  say('c', '결과를 비교합니다');
  say('c', '결과를 비교합니다');
  assert.deepEqual(run.read, [sections[0].checkpoint]);
  assert.equal(Object.keys(run.passes).length, 1);
});

test('접두어나 비슷한 철자만 도착하면 단어를 앞질러 표시하지 않는다', () => {
  const { run, say } = rehearsal(['도서관에서 도서관까지 함께 걸어갑니다.']);
  for (const fragment of ['도', '도서관', '도서관에', '도서관에사']) {
    say('a', fragment, true);
    assert.equal(run.wordCursor, null);
    assert.equal(run.candidate, null);
  }
  say('a', '도서관에서 도서', true);
  assert.equal(run.wordCursor.word, 0);
  say('a', '도서관에서 도서관까지', true);
  assert.equal(run.wordCursor.word, 1);
  assert.deepEqual(run.read, []);
});

test('같은 발화에서 단어가 더 길게 수정되면 기존 밑줄을 거둔다', () => {
  const { run, say } = rehearsal(['서울 여행을 시작합니다.']);
  say('a', '서울', true);
  assert.equal(run.wordCursor.word, 0);
  say('a', '서울역', true);
  assert.equal(run.wordCursor, null);
  assert.equal(run.candidate, null);
});

test('반복어는 주변 문맥을 따르고 한두 문장 건너뛰어도 발화한 문장만 확인한다', () => {
  const { run, say, sections } = rehearsal([
    '오늘 발표의 순서를 소개합니다.', '우리는 같은 값을 확인합니다.',
    '다음 실험에서도 같은 값을 확인합니다.', '마지막 표에서 같은 값을 비교합니다.',
  ]);
  say('a', '오늘 발표의 순서를 소개합니다.');
  say('b', '같은', true);
  assert.ok(!run.wordCursor || run.wordCursor.line === 1);
  say('b', '마지막 표에서 같은 값을', true);
  assert.deepEqual([run.wordCursor.line, run.wordCursor.word], [3, 3]);
  assert.equal(run.index, 1);
  say('b', '마지막 표에서 같은 값을');
  say('c', '비교합니다');
  assert.deepEqual(run.read, [sections[0].checkpoint, sections[3].checkpoint]);
  assert.equal(Object.keys(run.passes).length, 2);
});

test('완료 한 건 안에서 문장을 넘으면 앞 문장을 기록하고 다음 문장의 단어를 표시한다', () => {
  const { run, say, sections } = rehearsal([
    '첫 구간에는 동네 학교가 있습니다.', '다음 마을에는 작은 도서관이 보입니다.',
  ]);
  run.active = 1000;
  say('a', '첫 구간에는 동네 학교가');
  run.active = 3000;
  say('b', '있습니다. 다음 마을에는 작은');
  assert.deepEqual(run.read, [sections[0].checkpoint]);
  assert.equal(run.passes[sections[0].id].source, 'estimated');
  assert.deepEqual([run.wordCursor.line, run.wordCursor.word], [1, 2]);
  say('b', '있습니다. 다음 마을에는 작은');
  say('c', '도서관이 보입니다.');
  assert.deepEqual(run.read, sections.map((s) => s.checkpoint));
});

test('마지막 단어가 틀려도 완료 전사에서 확인한 앞 단어 위치를 유지한다', () => {
  const { run, say } = rehearsal(['인터넷에는 여러 자료와 자세한 설명이 담겨 있습니다.']);
  say('a', '인터넷에는 여러 자료와');
  say('b', '자세한 설명이 다른소리');
  assert.equal(run.wordCursor.word, 4);
  assert.equal(run.index, 0);
  say('c', '있습니다.');
  assert.equal(run.index, 1);
  say('empty', '');
  assert.equal(run.control, 'auto');
});

test('잘못 들은 어절은 건너고 같은 완료 전사에서 실제로 받은 끝말로 문장을 확인한다', () => {
  const { run, say } = rehearsal(['먼 지역에서는 사람과 사람 간의 이야기 요소를 모두 갖추고 있다.']);
  say('a', '먼 지역에서는 사람과 사람 간의');
  const text = '요서를 모두 같이고 있다.';
  say('b', '요서를 모두 같이고', true);
  assert.equal(run.wordCursor.word, 7);
  assert.equal(run.index, 0);
  say('b', text);
  assert.equal(run.index, 1);
  assert.equal(run.read.length, 1);
});

test('보류 시간이 길면 탐색을 넓히고 먼 위치는 구별되는 연속 단어로만 찾는다', () => {
  const texts = Array.from({ length: 18 }, (_, i) => '자료 ' + i + '번 내용을 살펴봅니다.');
  texts[7] = '수변 생태계 지도 자료를 펼칩니다.';
  texts[16] = '해저 지각 변동 자료를 비교합니다.';
  for (const [index, delay] of [[7, 3600], [16, 8100]]) {
    const { run, say, sections } = rehearsal(texts);
    say('outside', '잠깐 창문을 열겠습니다');
    say('early', texts[index], true);
    assert.equal(run.wordCursor, null);
    run.active = delay;
    say('common', '자료를', true);
    assert.ok(!run.wordCursor || run.wordCursor.line < 4);
    say('later', texts[index], true);
    assert.equal(run.wordCursor?.line, index);
    assert.equal(run.index, 0);
    say('later', texts[index]);
    assert.deepEqual(run.read, [sections[index].checkpoint]);
    assert.equal(Object.keys(run.passes).length, 1);
  }
});

test('같은 단어에 오래 머물면 무관한 발화를 먼저 보내지 않아도 먼 위치를 찾는다', () => {
  const texts = Array.from({ length: 15 }, (_, i) => '현재 자료 ' + i + '번을 소개합니다.');
  texts[14] = '고래 이동 경로 지도를 펼칩니다.';
  const { run, say } = rehearsal(texts);
  say('a', '현재');
  run.active = 5000;
  say('b', '현재');
  run.active = 9000;
  say('c', '지도를', true);
  assert.ok(!run.wordCursor || run.wordCursor.line === 0);
  say('c', '고래 이동 경로 지도를', true);
  assert.equal(run.wordCursor?.line, 14);
  assert.deepEqual(run.read, []);
});

test('겹친 발화의 부분 전사는 앞 발화 확정 뒤 이어지고 오래된 조각은 버린다', () => {
  const seen = [];
  const wire = orderedTranscripts((e) => seen.push('완료 ' + e.text), (e) => seen.push(e.text));
  const delta = (item_id, delta) => wire({ type: 'conversation.item.input_audio_transcription.delta', item_id, delta });
  const commit = (item_id, previous_item_id) => wire({ type: 'input_audio_buffer.committed', item_id, previous_item_id });
  const done = (item_id, transcript) => wire({ type: 'conversation.item.input_audio_transcription.completed', item_id, transcript });
  delta('a', '첫');
  commit('a', null);
  delta('b', '둘');
  commit('b', 'a');
  delta('b', '째');
  assert.deepEqual(seen, ['첫']);
  done('a', '첫째');
  delta('a', '늦음');
  done('b', '둘째');
  assert.deepEqual(seen, ['첫', '완료 첫째', '둘째', '완료 둘째']);
});

test('앞쪽 단어가 바뀐 최종 전문이 같은 발화의 임시 커서를 대체한다', () => {
  const texts = ['여기서는 실내 온도를 측정합니다.', '여기서는 실외 습도를 측정합니다.'];
  const { run, sections } = rehearsal(texts);
  const receive = tracker(run);
  const wire = orderedTranscripts(receive, receive);
  wire({ type: 'conversation.item.input_audio_transcription.delta', item_id: 'room',
    delta: '여기서는 실내 온도를' });
  assert.equal(run.wordCursor.line, 0);
  assert.deepEqual(run.read, []);
  wire({ type: 'input_audio_buffer.committed', item_id: 'room', previous_item_id: null }, 0);
  wire({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'room',
    transcript: texts[1] });
  assert.deepEqual(run.read, [sections[1].checkpoint]);
  assert.deepEqual(Object.keys(run.passes), [sections[1].id]);
});

test('발화 확정은 침묵과 짧은 잡음을 제외하고 쉼과 연속 발화의 시간 상한을 따른다', () => {
  function commits(voice, duration) {
    const shouldCommit = speechCommitter(), times = [];
    for (let t = 0; t <= duration; t += 50) if (shouldCommit(voice(t), t)) times.push(t);
    return times;
  }
  assert.deepEqual(commits((t) => t === 500, 3000), []);
  assert.deepEqual(commits((t) => t <= 200, 1600), [550]);
  assert.deepEqual(commits((t) => t <= 2700, 3500), [2900]);
  assert.deepEqual(commits(() => true, 10000), [4200, 8450]);
});
