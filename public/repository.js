import { id, newRun, event, sentence, section, emptyPlan } from './model.js';

function demoData() {
  const texts = [
    [
      '문제 제기',
      80,
      [
        '여러분은 오늘 일회용 컵을 몇 개 사용하셨나요?',
        '우리가 무심코 버리는 컵은 캠퍼스에서 매일 수백 개씩 쌓입니다.',
        '작은 습관의 변화가 지속 가능한 캠퍼스를 만듭니다.',
      ],
    ],
    [
      '실천 방법',
      165,
      [
        '이제 일상에서 실천할 수 있는 방법을 살펴보겠습니다.',
        '첫 번째 실천은 개인 컵을 사용하는 것입니다.',
        '두 번째 실천은 필요한 만큼만 소비하는 것입니다.',
        '함께 실천할 때 우리의 습관은 더 오래 이어집니다.',
        '매일 반복하는 작은 선택이 큰 변화를 만듭니다.',
      ],
    ],
    [
      '기대 효과',
      250,
      [
        '작은 습관이 모이면 캠퍼스의 내일이 달라집니다.',
        '예를 들어, 우리 학과에서도 개인 컵 사용 캠페인을 진행했습니다.',
        '한 달 동안 참여 학생이 꾸준히 늘었습니다.',
        '개인 컵 사용은 버려지는 컵을 줄이는 첫걸음입니다.',
      ],
    ],
    [
      '발표 끝',
      300,
      [
        '필요한 만큼 소비하는 습관도 함께 이어갈 수 있습니다.',
        '오늘부터 한 가지 실천을 시작해 보시기 바랍니다.',
      ],
    ],
  ];
  const plan = {
    id: id(),
    revision: 2,
    title: '작은 실천이 만드는 지속 가능한 캠퍼스',
    limit: 300000,
    sections: texts.map(([title, seconds, body]) => {
      const s = section(title);
      s.sentences = body.map(sentence);
      s.sentences.at(-1).importance = 'required';
      s.checkpoint = s.sentences.at(-1).id;
      s.target = seconds * 1000;
      return s;
    }),
  };
  const group = id();
  plan.sections[2].sentences
    .slice(1, 3)
    .forEach((l) => Object.assign(l, { importance: 'supplementary', group }));
  const project = { id: id(), serial: 1, plan, draft: null };
  const run = newRun(plan, 'rehearsal', 0, 'auto');
  Object.assign(run, {
    projectId: project.id,
    status: 'completed',
    active: 328000,
    total: 348000,
    pausedMs: 20000,
    startedAt: new Date(2026, 10, 17, 14, 32).getTime(),
  });
  [90000, 195000, 272000, 328000].forEach((at, i) => {
    const source = i === 2 ? 'manual' : 'auto';
    const s = plan.sections[i];
    run.passes[s.id] = { at, source };
    event(run, 'pass', {
      checkpointId: s.id,
      sentenceId: s.checkpoint,
      source,
      observedActiveMs: at,
      elapsedMs: at + (i ? 20000 : 0),
      activeMs: at,
    });
  });
  const draft = emptyPlan();
  draft.title = '모바일 서비스 아이디어';
  draft.sections[0].sentences[0].text =
    '우리 팀이 준비한 모바일 서비스를 소개합니다.';
  return {
    projects: [project, { id: id(), serial: 1, plan: null, draft }],
    runs: [run],
  };
}
const blank = () => ({ projects: [], runs: [] });
let opened;
function db() {
  return (opened ||= new Promise((resolve, reject) => {
    const req = indexedDB.open('malgeoreum-testbed-v1', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('accounts');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      opened = null;
      reject(req.error);
    };
  }));
}
// A read and its mutation share one IndexedDB transaction, including across tabs.
export async function update(scope, fn, seed = false) {
  const database = await db();
  return new Promise((resolve, reject) => {
    const tx = database.transaction('accounts', 'readwrite');
    const store = tx.objectStore('accounts');
    const read = store.get(scope);
    let result, cause;
    read.onsuccess = () => {
      try {
        result = read.result ?? (seed ? demoData() : blank());
        fn?.(result);
        if (fn || !read.result) store.put(result, scope);
      } catch (error) {
        cause = error;
        tx.abort();
      }
    };
    tx.oncomplete = () => resolve(result);
    tx.onabort = () =>
      reject(cause || Error('기기 저장 공간을 확인한 뒤 다시 시도하세요.'));
  });
}
export function writeProject(data, project, expected) {
  const index = data.projects.findIndex((p) => p.id === project.id);
  if ((data.projects[index]?.serial ?? 0) !== expected)
    throw Error(
      '다른 창에서 계획을 수정했습니다. 목록에서 최신 계획을 다시 여세요.',
    );
  const saved = { ...structuredClone(project), serial: expected + 1 };
  const old = data.projects[index];
  const versions = [...(old?.versions ?? [])];
  for (const plan of [old?.plan, saved.plan]) {
    if (plan && !versions.some((v) => v.id === plan.id))
      versions.push(structuredClone(plan));
  }
  saved.versions = versions;
  if (index < 0) data.projects.unshift(saved);
  else data.projects[index] = saved;
}
export function writeRun(data, run) {
  const i = data.runs.findIndex((r) => r.id === run.id);
  const saved = structuredClone(run);
  if (i < 0) data.runs.unshift(saved);
  else data.runs[i] = saved;
}
