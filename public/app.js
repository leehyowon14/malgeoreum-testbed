import {
  id,
  clock,
  parseTime,
  emptyPlan,
  section,
  sentence,
  lines,
  checkpoints,
  editablePoints,
  addCheckpoint,
  recordPass,
  representative,
  setGroup,
  lockEnd,
  validate,
  newRun,
  estimates,
  interval,
  tick,
  togglePause,
  complete,
  restore,
  position,
  changeControl,
  event,
  correctPass,
} from './model.js';
import {
  configure,
  authenticate,
  logout,
  health,
  mockIssuer,
} from './services.js';
import { update, writeProject, writeRun } from './repository.js';
import { voiceConnection } from './voice.js';
import { tracker } from './tracking.js';
import {
  esc,
  btn,
  field,
  head,
  num,
  choose,
  timeField,
  groupKey,
} from './ui.js';
import { editorView, sectionForm } from './editor.js';
import { runView, resultView, timerText, impact, markedText } from './run-view.js';

const $ = (selector) => document.querySelector(selector);
const content = $('#content'),
  footer = $('#actions'),
  dialog = $('#dialog'),
  sheet = $('#sheet');
const state = {
  page: 'login',
  config: null,
  user: null,
  data: null,
  project: null,
  draft: null,
  dirty: false,
  sectionIndex: 0,
  pointIndex: 0,
  browsing: false,
  selected: [],
  sectionCopy: null,
  run: null,
  result: null,
  resultIndex: 0,
  adjustment: null,
  readyMode: null,
  failStore: false,
  grantFault: 'ok',
  mockStats: { requests: 0, grants: 0 },
  replayPaused: false,
  pending: false,
};
let voice,
  mockTranscript,
  delayedTranscript,
  lastMock,
  retryTimer,
  connectionVersion = 0,
  toastTimer,
  lastPage,
  saveQueue = Promise.resolve(),
  saving = false,
  sheetType = '';
let scope = '',
  noticeText = '',
  editSerial = 0,
  resultSerial = 0;
const editing = () =>
  ['editor', 'group', 'targets', 'importance'].includes(state.page);
function toast(message) {
  $('#notice').textContent = message;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    $('#notice').textContent = '';
  }, 3600);
}
function problem(error) {
  const message = error?.message || '처리하지 못했습니다. 다시 시도하세요.';
  if (dialog.open) {
    let tag = sheet.querySelector('.form-error');
    if (!tag) {
      tag = document.createElement('p');
      tag.className = 'form-error';
      tag.setAttribute('role', 'alert');
      sheet.prepend(tag);
    }
    tag.textContent = message;
  } else if ($('#auth-error')) $('#auth-error').textContent = message;
  else toast(message);
}
function openSheet(type, html) {
  sheetType = type;
  sheet.innerHTML = html;
  dialog.setAttribute(
    'aria-label',
    sheet.querySelector('h2')?.textContent || '선택',
  );
  if (!dialog.open) dialog.showModal();
  dialog.scrollTop = 0;
}
function closeSheet() {
  if (dialog.open) dialog.close();
  sheetType = '';
}
function stopVoice() {
  clearTimeout(retryTimer);
  if (state.run) {
    state.run.candidate = null;
    state.run.wordCursor = null;
  }
  mockTranscript = null;
  connectionVersion++;
  voice?.stop();
  voice = null;
}
function dismiss() {
  if (sheetType === 'section')
    state.sectionIndex = Math.min(
      state.sectionIndex,
      state.draft.sections.length - 1,
    );
  if (sheetType === 'connecting') {
    stopVoice();
    if (state.page === 'run') {
      changeControl(state.run, 'manual');
      saveProgress();
      render();
    }
  }
  closeSheet();
}
dialog.addEventListener('cancel', (e) => {
  e.preventDefault();
  dismiss();
});
function go(page) {
  $('#notice').textContent = '';
  closeSheet();
  state.page = page;
  render();
}
function currentProject() {
  return state.data.projects.find((p) => p.id === state.project?.id);
}
function historyRuns(allModes = false) {
  return state.data.runs
    .filter(
      (r) =>
        r.projectId === state.project?.id &&
        (allModes || r.mode === 'rehearsal'),
    )
    .sort((a, b) => b.startedAt - a.startedAt);
}
function viewResult(r) {
  state.result = structuredClone(r);
  state.resultIndex = Math.min(1, checkpoints(r.plan).length - 1);
  state.adjustment = null;
  resultSerial = currentProject().serial;
  go('result');
}
function render() {
  const oldScroll = lastPage === state.page ? content.scrollTop : 0;
  const p = state.page;
  let body = '',
    actions = '';
  if (p === 'login' || p === 'signup') {
    const login = p === 'login',
      demo = login && state.config?.mode === 'mock';
    const form =
      '<form id="auth" class="stack">' +
      (login ? '<h2>로그인</h2>' : '') +
      field(
        'email',
        '이메일',
        demo ? 'hello@example.com' : '',
        'type="email" autocomplete="username" placeholder="hello@example.com" required',
      ) +
      field(
        'password',
        '비밀번호',
        demo ? 'demo1234' : '',
        'type="password" autocomplete="' +
          (login ? 'current-password' : 'new-password') +
          '" placeholder="비밀번호 입력" minlength="6" required',
      ) +
      (!login
        ? field(
            'confirm',
            '비밀번호 확인',
            '',
            'type="password" autocomplete="new-password" placeholder="비밀번호 다시 입력" required',
          )
        : '') +
      '<p id="auth-error" role="alert" class="form-error"></p>' +
      (login
        ? '<div class="list auth-actions"><button class="btn primary" type="submit">로그인</button>' +
          btn('signup', '회원가입') +
          '</div>'
        : '') +
      '</form>';
    body = login
      ? '<div class="brand"><h1>말걸음</h1><p>대본 준비부터 리허설, 실전까지.</p></div>' +
        form
      : head('회원가입') +
        form +
        '<p class="hint">자료는 이 기기에 저장돼요.</p>';
    if (!login)
      actions =
        '<button class="btn primary" type="submit" form="auth">계정 만들기</button>' +
        btn('login', '로그인으로 돌아가기');
  } else if (p === 'list') {
    body =
      head('나의 발표') +
      state.data.projects
        .map((project) => {
          const plan = project.plan || project.draft;
          const duration =
            plan.limit % 60000 === 0
              ? plan.limit / 60000 + '분'
              : clock(plan.limit || 0);
          const badge =
            (project.plan ? '제한 시간 ' : '작성 중 · ') +
            (plan.limit ? duration : '시간 미정');
          const title = esc(plan.title || '제목 없는 발표');
          if (!project.plan)
            return (
              '<button class="card summary" data-action="edit" data-arg="' +
              project.id +
              '"><span class="eyebrow">' +
              badge +
              '</span><span class="summary-title">' +
              title +
              '</span></button>'
            );
          const hasRecords = state.data.runs.some(
            (r) => r.projectId === project.id,
          );
          return (
            '<article class="card summary"><span class="eyebrow">' +
            badge +
            (project.draft ? ' · 수정 중' : '') +
            '</span><h3 class="summary-title">' +
            title +
            '</h3><div class="chips">' +
            btn('edit', '편집', 'chip', project.id) +
            btn('rehearsal', '리허설', 'chip', project.id) +
            btn('live', '실전', 'chip', project.id) +
            btn('records', '기록 보기', 'chip', project.id, !hasRecords) +
            '</div></article>'
          );
        })
        .join('') +
      btn('new', '새 발표 만들기');
    actions = btn('logout', '내 계정　·　로그아웃', 'account');
  } else if (editing()) [body, actions] = editorView(state);
  else if (p === 'run' && state.run.status !== 'running') {
    body =
      head('종료 기록 저장') +
      '<p>이번 실행 기록을 기기에 저장하고 있어요.</p>';
    if (state.pending)
      actions = btn('end', '종료 기록 다시 저장', 'btn primary');
  } else if (p === 'run') {
    [body, actions] = runView(state.run, state.browsing);
    if (state.pending)
      body =
        '<div class="card"><b>기록 저장 대기 중</b>' +
        btn('retry-save', '저장 다시 시도', 'link') +
        '</div>' +
        body;
    if (noticeText) body += '<p class="hint">' + esc(noticeText) + '</p>';
  } else if (p === 'result')
    [body, actions] = resultView(
      state.result,
      state.resultIndex,
      state.adjustment,
    );
  content.className =
    'content ' + (p === 'login' ? 'login' : p === 'run' ? 'run' : '');
  content.innerHTML = body;
  footer.innerHTML = actions;
  content.scrollTop = oldScroll;
  lastPage = p;
}
async function readData(fn) {
  const owner = scope;
  const result = await update(
    owner,
    fn,
    state.config.mode === 'mock' && state.user.uid === 'demo',
  );
  if (scope === owner) state.data = result;
}
function editProject(project) {
  state.project = project;
  editSerial = project.serial;
  state.draft = structuredClone(project.draft || project.plan);
  editablePoints(state.draft);
  state.dirty = false;
  state.selected = [];
  state.sectionIndex = 0;
  go('editor');
}
async function persistPlan(publish) {
  const project = { ...state.project, draft: structuredClone(state.draft) };
  if (publish) {
    validate(state.draft);
    project.plan = {
      ...structuredClone(state.draft),
      id: id(),
      revision: (project.plan?.revision || 0) + 1,
    };
    project.draft = null;
  }
  if (state.failStore)
    throw Error('계획 저장에 실패했습니다. 편집 내용은 열려 있어요.');
  await readData((data) => writeProject(data, project, editSerial));
  state.dirty = false;
  go('list');
  toast(publish ? '발표 계획을 저장했어요.' : '초안을 저장했어요.');
}
function editSection(i, isNew = false) {
  state.sectionIndex = i;
  state.sectionCopy = isNew
    ? section()
    : structuredClone(state.draft.sections[i]);
  openSheet('section', sectionForm(state.sectionCopy));
}
function prepare(mode) {
  const plan = currentProject()?.plan;
  if (!plan) throw Error('먼저 발표 계획을 저장하세요.');
  validate(plan);
  state.readyMode = mode;
  const mock = state.config.mode === 'mock';
  openSheet(
    'ready',
    '<h2>마이크 사용</h2><p><b>' +
      esc(plan.title) +
      '</b> · 계획 ' +
      plan.revision +
      ' · 제한 ' +
      clock(plan.limit) +
      '</p><p>' +
      (mock
        ? '모의 전사로 대본 위치를 따라갑니다. 기기 마이크는 사용하지 않아요.'
        : '말하는 위치를 따라가기 위해 음성을 외부 인식 서비스로 전송해요.') +
      '</p>' +
      btn(
        'start-auto',
        mock ? '모의 음성으로 시작' : '마이크 허용하고 시작',
        'btn primary',
      ) +
      btn('start-manual', '음성 없이 수동으로 시작') +
      btn('cancel-sheet', '취소'),
  );
}
function makeRun(control) {
  const p = currentProject().plan;
  const run = newRun(p, state.readyMode, performance.now(), control);
  run.projectId = state.project.id;
  run.estimating = estimates(
    p,
    historyRuns().find((r) => representative(r, p)),
  );
  state.run = run;
  state.browsing = false;
  state.pending = false;
  noticeText = '';
  run.retries = 0;
  run.sessionEnds = 0;
  return run;
}
function saveProgress() {
  const run = state.run;
  if (!run) return Promise.resolve(true);
  const copy = structuredClone(run),
    owner = scope;
  delete copy.wordCursor;
  delete copy.candidate;
  const unavailable = state.failStore;
  // Queue ordered snapshots so a delayed write cannot replace a newer pass or completion.
  saveQueue = saveQueue.then(async () => {
    try {
      if (unavailable) throw Error('모의 저장 실패');
      const data = await update(owner, (d) => writeRun(d, copy));
      if (owner === scope) state.data = data;
      if (run === state.run && state.pending) {
        state.pending = false;
        render();
      }
      return true;
    } catch {
      if (run === state.run && !state.pending) {
        state.pending = true;
        render();
      }
      return false;
    }
  });
  return saveQueue;
}
function finishSentence(source, operation, sentenceId, observed) {
  const r = state.run;
  if (!r) return;
  tick(r, performance.now());
  if (
    complete(r, {
      operation,
      generation: r.generation,
      sentenceId,
      source,
      observed,
    })
  ) {
    saveProgress();
    render();
    if (!state.browsing) content.scrollTop = 0;
  }
}
function mockSample() {
  const r = state.run;
  if (
    !r ||
    state.page !== 'run' ||
    !['auto', 'searching', 'hold'].includes(r.control) ||
    r.pausedAt !== null
  )
    return;
  const l = lines(r.plan)[r.index];
  if (l && mockTranscript) {
    tick(r, performance.now());
    mockTranscript({ operation: id(), text: l.text, observed: r.active });
  }
}
function connectionLost(message, reason) {
  const r = state.run;
  if (!r || r.control === 'manual' || r.status !== 'running') return;
  stopVoice();
  changeControl(r, 'lost');
  noticeText = message;
  if (reason === 'session') r.sessionEnds++;
  const temporary =
    reason === 'temporary' || (reason === 'session' && r.sessionEnds === 1);
  if (temporary && r.retries < 3) {
    const wait = 1000 * 2 ** r.retries++;
    const ticket = connectionVersion;
    noticeText = message + ' ' + wait / 1000 + '초 뒤 다시 연결합니다.';
    retryTimer = setTimeout(() => {
      if (
        ticket === connectionVersion &&
        r === state.run &&
        r.pausedAt === null
      )
        connect(false, true);
    }, wait);
  } else {
    changeControl(r, 'manual');
    r.connection = 'unavailable';
    event(r, 'connection', { connection: r.connection, reason });
    noticeText = message + ' 수동으로 계속할 수 있어요.';
  }
  saveProgress();
  render();
}
async function connect(initial, background = false) {
  stopVoice();
  const ticket = connectionVersion,
    previousRun = state.run;
  if (!initial && previousRun) {
    if (!background) {
      previousRun.retries = 0;
      previousRun.sessionEnds = 0;
    }
    changeControl(previousRun, 'connecting');
    if (background) render();
  }
  let accept;
  if (initial || !background)
    openSheet(
      'connecting',
      '<h2>음성 연결 중</h2><p>연결을 준비하고 있어요.</p>' +
        btn('cancel-sheet', '취소'),
    );
  const active = () =>
    ticket === connectionVersion &&
    !!accept &&
    state.page === 'run' &&
    state.run?.pausedAt === null;
  const onTranscript = (payload) => {
    if (!active()) return;
    const r = state.run;
    tick(r, performance.now());
    const prior = r.control, candidate = r.candidate, cursor = r.wordCursor;
    const oldLine = cursor?.line ?? r.index;
    const completed = accept(payload);
    if (completed) {
      r.retries = 0;
      saveProgress();
    } else if (prior !== r.control) {
      event(r, 'tracking', { control: r.control });
      saveProgress();
    }
    const line = r.wordCursor?.line ?? r.index;
    if (completed || prior !== r.control || candidate !== r.candidate || line !== oldLine) {
      render();
    } else if (cursor !== r.wordCursor) {
      const row = content.querySelector('[data-line="' + line + '"]');
      if (row) row.innerHTML = markedText(row.textContent, r.wordCursor);
      const heard = content.querySelector('[data-heard-word]');
      if (heard && row && r.wordCursor) heard.textContent = row.textContent.slice(r.wordCursor.start, r.wordCursor.end);
    } else return;
    if (state.browsing) return;
    if (line !== oldLine) content.scrollTop = 0;
    const mark = content.querySelector('.word-cursor');
    if (mark) {
      const bounds = content.getBoundingClientRect(), word = mark.getBoundingClientRect();
      if (word.bottom > bounds.bottom) content.scrollTop += word.bottom - bounds.bottom + 12;
      else if (word.top < bounds.top) content.scrollTop += word.top - bounds.top - 12;
    }
  };
  const connection = voiceConnection(state.config.mode, {
    grantMock: async () => {
      if (state.grantFault === 'permission')
        throw Error('마이크 권한을 허용한 뒤 다시 시작하세요.');
      await mockIssuer(state.grantFault, state.mockStats);
    },
    sample: () => {
      if (active() && !state.replayPaused) mockSample();
    },
    now: () => {
      if (!state.run) return 0;
      tick(state.run, performance.now());
      return state.run.active;
    },
    result: onTranscript,
    lost: (message, reason = 'temporary') => {
      if (ticket !== connectionVersion) return;
      if (!initial || accept) {
        if (sheetType === 'connecting') closeSheet();
        connectionLost(message, reason);
      } else {
        stopVoice();
        prepare(state.readyMode);
        problem(Error(message));
      }
    },
  });
  voice = connection;
  try {
    await connection.start();
    if (ticket !== connectionVersion) return;
    if (initial) makeRun('searching');
    else changeControl(state.run, 'searching');
    noticeText = '';
    accept = tracker(state.run);
    if (state.config.mode === 'mock') {
      mockTranscript = (payload) => {
        if (!payload.partial) lastMock = () => onTranscript(payload);
        onTranscript(payload);
      };
    }
    if (!background) go('run');
    else render();
    saveProgress();
  } catch (error) {
    if (ticket !== connectionVersion) return;
    stopVoice();
    if (initial) {
      prepare(state.readyMode);
      problem(error);
    } else {
      if (sheetType === 'connecting') closeSheet();
      const transient =
        error.retryable ||
        error.name === 'TimeoutError' ||
        error.name === 'TypeError' ||
        error.name === 'NetworkError';
      connectionLost(error.message, transient ? 'temporary' : 'configuration');
    }
  }
}
async function endRun(restart = false) {
  if (saving) return;
  saving = true;
  try {
    const r = state.run;
    if (r.status === 'running') {
      tick(r, performance.now());
      stopVoice();
      r.generation++;
      r.status = restart ? 'interrupted' : 'completed';
      event(r, 'end', { status: r.status });
    }
    if (!(await saveProgress())) {
      if (state.config.mode === 'mock') state.failStore = false;
      render();
      openSheet(
        'end-failed',
        '<h2>종료 기록 저장 대기 중</h2><p>이번 실행 기록을 보관한 뒤 이동해요.</p>' +
          btn(
            restart ? 'retry-restart' : 'confirm-end',
            '저장 다시 시도',
            'btn primary',
          ),
      );
      return;
    }
    state.run = null;
    closeSheet();
    if (restart) {
      go('list');
      prepare('rehearsal');
    } else if (r.mode === 'rehearsal') viewResult(r);
    else {
      go('list');
      toast('발표 기록을 저장했어요.');
    }
  } finally {
    saving = false;
  }
}
function endSheet() {
  const r = state.run;
  if (r.status !== 'running') return endRun(r.status === 'interrupted');
  tick(r, performance.now());
  openSheet(
    'end',
    '<h2>' +
      (r.mode === 'live' ? '발표 종료' : '연습 종료') +
      '</h2><p>경과 ' +
      clock(r.total) +
      ' / 제한 ' +
      clock(r.plan.limit) +
      '</p>' +
      btn(
        'confirm-end',
        r.mode === 'live'
          ? '발표 종료하고 기록 저장'
          : '연습 종료하고 결과 보기',
        'btn primary',
      ) +
      btn(
        'cancel-sheet',
        r.mode === 'live' ? '계속 발표하기' : '계속 연습하기',
      ),
  );
}
function back() {
  if (dialog.open) return dismiss();
  switch (state.page) {
    case 'signup':
      go('login');
      break;
    case 'list':
      return;
    case 'group':
    case 'targets':
      go('editor');
      break;
    case 'importance':
      go('targets');
      break;
    case 'editor':
      if (!state.dirty) go('list');
      else
        openSheet(
          'leave',
          '<h2>편집한 내용을 저장할까요?</h2>' +
            btn('save-draft', '초안 저장', 'btn primary') +
            btn('discard', '변경 취소') +
            btn('cancel-sheet', '편집 계속'),
        );
      break;
    case 'run':
      endSheet();
      break;
    case 'result':
      if (state.adjustment) {
        state.adjustment = null;
        render();
      } else go('list');
      break;
  }
}
function showTools() {
  const mock = state.config.mode === 'mock',
    r = state.run;
  let options = btn('health', '서버 상태 확인');
  if (mock && state.user?.uid === 'demo' && state.page === 'list')
    options += btn('scenario', '실전 지연 · 생략과 복원 재현');
  if (mock && state.user)
    options +=
      choose(
        'grantFault',
        '다음 음성 연결 시험',
        [
          ['ok', '정상 발급'],
          ['permission', '마이크 권한 거부'],
          ['auth', '인증 거부 (401)'],
          ['rate', '발급 제한 (429)'],
          ['quota', '할당량 소진 (503)'],
          ['temporary', '일시 장애 (503)'],
        ],
        state.grantFault,
      ) +
      '<p class="hint">모의 발급 요청 ' +
      state.mockStats.requests +
      '회 · 성공 ' +
      state.mockStats.grants +
      '회</p>';
  if (mock && (editing() || state.adjustment))
    options += btn(
      'plan-fault',
      state.failStore ? '계획 저장 장애 해제' : '계획 저장 장애 발생',
    );
  if (mock && r && state.page === 'run')
    options +=
      '<div class="row">' +
      btn('sample', '문장 인식') +
      btn('delay', '30초 경과') +
      '</div>' +
      btn(
        'mock-pause',
        state.replayPaused ? '모의 자동 재생 켜기' : '모의 자동 재생 멈추기',
      ) +
      field('testSpeech', '시험 발화', lines(r.plan)[r.index]?.text ?? '') +
      '<div class="row">' +
      btn('inject-partial', '부분 전사') +
      btn('inject-final', '완료 전사') +
      '</div>' +
      btn('estimate', '발화 시각 없는 완료 전사') +
      btn('capture-late', '현재 응답 보관') +
      btn('deliver-late', '보관한 응답 전달', 'btn', '', !delayedTranscript) +
      btn('duplicate', '직전 응답 재전달', 'btn', '', !lastMock) +
      btn('no-response', '발화 전송 후 응답 정지') +
      btn('language', '지원하지 않는 언어 오류') +
      btn('session-end', '음성 세션 정상 종료') +
      btn('phone', '전화로 마이크 중단') +
      btn('offscript', '대본 밖 발화 재생') +
      btn('disconnect', '음성 연결 끊기') +
      btn('fault', state.failStore ? '저장 장애 해제' : '저장 장애 발생');
  if (r && state.page === 'run')
    options +=
      '<p class="hint">' +
      esc(
        {
          stopped: '사용자 중지',
          receiving: '수신 중',
          unavailable: '사용 불가',
          reconnecting: '재연결 중',
        }[r.connection],
      ) +
      ' · ' +
      esc(
        {
          manual: '수동',
          searching: '탐색',
          auto: '추적',
          hold: '보류',
          lost: '보류',
          connecting: '탐색',
        }[r.control],
      ) +
      ' · 통과 ' +
      Object.keys(r.passes).length +
      '건 · 실행 이벤트 ' +
      r.events.length +
      '건</p>';
  openSheet(
    'tools',
    '<h2>테스트 도구</h2><p class="hint">' +
      (mock
        ? 'Mock 모드 · 로컬 예시 데이터'
        : 'API 모드 · Firebase 인증과 실시간 음성') +
      '</p>' +
      options +
      btn('cancel-sheet', '닫기'),
  );
}

const handlers = {
  login: () => go('login'),
  signup: () => go('signup'),
  back,
  'cancel-sheet': dismiss,
  logout: async () => {
    stopVoice();
    await saveQueue;
    logout();
    scope = '';
    lastMock = null;
    delayedTranscript = null;
    state.grantFault = 'ok';
    state.mockStats = { requests: 0, grants: 0 };
    state.replayPaused = false;
    Object.assign(state, {
      user: null,
      data: null,
      project: null,
      draft: null,
      result: null,
      run: null,
      failStore: false,
    });
    go('login');
  },
  new: () =>
    editProject({ id: id(), serial: 0, draft: emptyPlan(), plan: null }),
  edit: (key) => editProject(state.data.projects.find((p) => p.id === key)),
  'add-section': () => editSection(state.draft.sections.length, true),
  'edit-section': (key) => editSection(Number(key)),
  'add-sentence': () => {
    state.sectionCopy.sentences.push(sentence());
    openSheet('section', sectionForm(state.sectionCopy));
    sheet
      .querySelectorAll('textarea')
      [state.sectionCopy.sentences.length - 1].focus();
  },
  'delete-sentence': (key) => {
    const s = state.sectionCopy;
    const group = s.sentences.find((l) => l.id === key).group;
    s.sentences = s.sentences.filter((l) => l.id !== key);
    if (group && s.sentences.filter((l) => l.group === group).length === 1)
      s.sentences.find((l) => l.group === group).group = null;

    openSheet('section', sectionForm(s));
  },
  'apply-section': () => {
    const s = state.sectionCopy;
    if (!s.title.trim() || s.sentences.some((l) => !l.text.trim()))
      throw Error('구간 이름과 각 문장을 입력하세요.');
    const p = state.draft,
      i = state.sectionIndex;
    if (i === p.sections.length) {
      const points = editablePoints(p);
      const prev = points.at(-1);
      prev.target = null;
      points.push({
        id: id(),
        title: s.title,
        checkpoint: s.sentences.at(-1).id,
        target: p.limit,
      });
    }
    p.sections[i] = s;
    const validIds = new Set(lines(p).map((l) => l.id));
    for (const cp of editablePoints(p).slice(0, -1))
      if (!validIds.has(cp.checkpoint)) cp.checkpoint = '';
    lockEnd(p);
    state.dirty = true;
    closeSheet();
    render();
  },
  'group-page': () => {
    state.selected = [];
    go('group');
  },
  'select-line': (key) => {
    state.selected = state.selected.includes(key)
      ? state.selected.filter((x) => x !== key)
      : [...state.selected, key];
    render();
  },
  'group-set': () => groupChange(false),
  'group-clear': () => groupChange(true),
  targets: () => {
    validate(state.draft, false);
    lockEnd(state.draft);
    state.pointIndex = 0;
    go('targets');
  },
  'add-point': () => {
    state.pointIndex = addCheckpoint(state.draft);
    state.dirty = true;
    render();
  },
  'delete-point': () => {
    const points = editablePoints(state.draft);
    if (state.pointIndex >= points.length - 1) return;
    points.splice(state.pointIndex, 1);
    state.dirty = true;
    render();
  },
  'target-section': (key) => {
    state.pointIndex = Number(key);
    render();
  },
  importance: () => {
    validate(state.draft);
    state.sectionIndex = 0;
    go('importance');
  },
  level: (key) => {
    const [line, level] = key.split('/');
    lines(state.draft).find((l) => l.id === line).importance = level;
    state.dirty = true;
    render();
  },
  publish: () => persistPlan(true),
  'save-draft': () => persistPlan(false),
  discard: () => go('list'),
  rehearsal: (key) => startFromList(key, 'rehearsal'),
  live: (key) => startFromList(key, 'live'),
  'start-auto': () => connect(true),
  'start-manual': () => {
    stopVoice();
    makeRun('manual');
    go('run');
    saveProgress();
  },
  manual: () => {
    stopVoice();
    changeControl(state.run, 'manual');
    noticeText = '';
    saveProgress();
    render();
  },
  reconnect: () => connect(false),
  next: (key, press) => {
    if (
      press &&
      (press.run !== state.run.id || press.gen !== state.run.generation)
    )
      return;
    finishSentence('manual', press?.id ?? id(), key, press?.at);
  },
  restore: (key) => {
    restore(state.run, key);
    saveProgress();
    render();
  },
  pause: async () => {
    const r = state.run;
    tick(r, performance.now());
    togglePause(r);
    if (r.pausedAt !== null) {
      stopVoice();
      r.connection = 'stopped';
    } else if (
      ['auto', 'searching', 'hold', 'connecting', 'lost'].includes(r.control)
    )
      return connect(false);
    saveProgress();
    render();
  },
  restart: () =>
    openSheet(
      'restart',
      '<h2>처음부터 연습할까요?</h2><p>현재 연습은 중단 기록으로 저장돼요.</p>' +
        btn('retry-restart', '새 연습 시작', 'btn primary') +
        btn('cancel-sheet', '취소'),
    ),
  'retry-restart': () => endRun(true),
  browse: () => {
    state.browsing = !state.browsing;
    render();
    const current = content.querySelector('.current');
    if (state.browsing) current?.scrollIntoView({ block: 'center' });
    else content.scrollTop = 0;
  },
  'manual-pass': (key, press) => {
    const r = state.run;
    if (
      r.mode !== 'rehearsal' ||
      r.status !== 'running' ||
      r.pausedAt !== null ||
      (press && (press.run !== r.id || press.gen !== r.generation))
    )
      return;
    tick(r, performance.now());
    const cp = checkpoints(r.plan).find((c) => c.id === key);
    if (recordPass(r, cp, 'manual', press?.at ?? r.active, press?.id)) {
      saveProgress();
      render();
    }
  },
  events: () => {
    const r = state.result;
    const names = {
      pass: '통과',
      correct: '보정',
      invalidate: '무효화',
      position: '수동 위치 지정',
      'recognized-position': '음성 위치 확인',
      skip: '생략 확정',
      omit: '생략 계획',
      restore: '복원',
      control: '추적 전환',
      pause: '일시정지',
      resume: '재개',
      end: '종료',
    };
    const evidence = {
      auto: '자동 관측',
      manual: '수동 확인',
      estimated: '수신 시각 추정',
      corrected: '보정',
      omission: '축약 경로',
      spoken: '실제 발화',
    };
    openSheet(
      'events',
      '<h2>실행 기록과 보정 이력</h2><p class="hint">계획 ' +
        r.plan.revision +
        ' · 실행 ' +
        esc(r.id) +
        '</p>' +
        r.events
          .map((e) => {
            const cp = checkpoints(r.plan).find((c) => c.id === e.checkpointId),
              origin = r.events.find((x) => x.id === e.correctsEventId);
            return (
              '<div class="card"><b>#' +
              e.sequence +
              ' ' +
              esc(names[e.kind] || e.kind) +
              ' ' +
              esc(cp?.title) +
              '</b><small>전체 ' +
              clock(e.elapsedMs) +
              ' · 일시정지 제외 ' +
              clock(e.activeMs) +
              (e.observedActiveMs != null
                ? ' · 통과 ' + clock(e.observedActiveMs)
                : '') +
              (e.source ? ' · ' + esc(evidence[e.source] ?? e.source) : '') +
              (origin ? ' · #' + origin.sequence + ' 변경' : '') +
              '</small></div>'
            );
          })
          .join('') +
        btn('cancel-sheet', '닫기'),
    );
  },
  locate: () =>
    openSheet(
      'locate',
      '<h2>위치 지정</h2>' +
        choose(
          'position',
          '여기부터 이어가기',
          lines(state.run.plan)
            .map((l, i) => [String(i), l.text])
            .filter(
              ([i]) =>
                !state.run.omitted.includes(
                  groupKey(lines(state.run.plan)[+i]),
                ),
            ),
          String(state.run.index),
        ) +
        btn('set-position', '이 문장부터 이어가기', 'btn primary') +
        btn('cancel-sheet', '취소'),
    ),
  'set-position': () => {
    stopVoice();
    changeControl(state.run, 'manual');
    position(state.run, Number(sheet.querySelector('select').value));
    closeSheet();
    saveProgress();
    render();
    if (!state.browsing) content.scrollTop = 0;
  },
  end: endSheet,
  'confirm-end': () => endRun(),
  records: (key) => {
    state.project = state.data.projects.find((p) => p.id === key);
    const records = historyRuns(true);
    if (records.length === 1) return viewResult(records[0]);
    openSheet(
      'records',
      '<h2>리허설 기록</h2>' +
        records
          .map((r) =>
            btn(
              'record',
              (r.mode === 'live' ? '실전 · ' : '리허설 · ') +
                new Date(r.startedAt).toLocaleString('ko-KR') +
                ' · ' +
                clock(r.active) +
                ' · ' +
                (r.status === 'completed' ? '완료' : '중단'),
              'btn',
              r.id,
            ),
          )
          .join('') +
        btn('cancel-sheet', '닫기'),
    );
  },
  record: (key) => viewResult(historyRuns(true).find((r) => r.id === key)),
  'result-row': (key) => {
    state.resultIndex = Number(key);
    render();
  },
  adjust: () => {
    const r = state.result,
      i = state.resultIndex,
      s = checkpoints(r.plan)[i];
    if (currentProject().plan.id !== r.plan.id)
      throw Error(
        '이 기록 이후 계획이 변경됐습니다. 목록에서 최신 계획을 편집하세요.',
      );
    state.adjustment = { target: s.target, checkpoint: s.checkpoint };
    render();
    content.scrollTop = 0;
  },
  'use-observed': () => {
    const i = state.resultIndex;
    if (
      interval(state.result, i) === null ||
      state.adjustment.checkpoint !==
        checkpoints(state.result.plan)[i].checkpoint
    )
      throw Error('같은 위치의 확인된 관측이 필요합니다.');
    state.adjustment.target =
      (checkpoints(state.result.plan)[i - 1]?.target || 0) +
      interval(state.result, i);
    render();
  },
  'save-adjust': async () => {
    const project = structuredClone(currentProject());
    if (
      project.plan.id !== state.result.plan.id ||
      project.serial !== resultSerial
    )
      throw Error('목록에서 최신 계획을 확인하세요.');
    const s = editablePoints(project.plan)[state.resultIndex];
    Object.assign(s, state.adjustment);
    validate(project.plan);
    project.plan.revision++;
    project.plan.id = id();
    if (state.failStore)
      throw Error('새 계획을 저장하지 못했습니다. 다시 시도하세요.');
    await readData((data) => writeProject(data, project, resultSerial));
    state.adjustment = null;
    go('list');
    toast('다음 실행에 사용할 계획을 저장했어요.');
  },
  again: () => prepare('rehearsal'),
  correct: () => {
    const s = checkpoints(state.result.plan)[state.resultIndex],
      pass = state.result.passes[s.id];
    openSheet(
      'correct',
      '<h2>통과 기록 보정</h2>' +
        timeField('correctTime', '일시정지 제외 통과 시각', pass.at) +
        btn('commit-correction', '보정 저장', 'btn primary') +
        btn('invalidate', '통과 무효화') +
        btn('cancel-sheet', '취소'),
    );
  },
  'commit-correction': () => revisePass(false),
  invalidate: () => revisePass(true),
  'plan-fault': () => {
    state.failStore = !state.failStore;
    closeSheet();
    toast(
      state.failStore
        ? '계획 저장 장애를 재현합니다.'
        : '계획 저장 장애를 해제했어요.',
    );
  },
  'mock-pause': () => {
    state.replayPaused = !state.replayPaused;
    closeSheet();
  },
  'inject-partial': () => mockInput('partial'),
  'inject-final': () => mockInput('final'),
  'capture-late': () => mockInput('delay'),
  estimate: () => mockInput('estimate'),
  'deliver-late': () => {
    closeSheet();
    delayedTranscript?.();
    delayedTranscript = null;
  },
  duplicate: () => {
    closeSheet();
    lastMock?.();
  },
  'session-end': () => {
    closeSheet();
    connectionLost('음성 세션이 종료됐습니다.', 'session');
  },
  'no-response': () => {
    closeSheet();
    connectionLost('보낸 음성에 대한 응답이 지연됐습니다.', 'temporary');
  },
  language: () => {
    closeSheet();
    connectionLost('지원하지 않는 언어입니다.', 'configuration');
  },
  phone: () => {
    closeSheet();
    connectionLost('마이크가 중단됐습니다.', 'microphone');
  },
  health: async () => {
    const result = await health();
    if (sheetType === 'tools')
      sheet.querySelector('.hint').textContent = result;
  },
  offscript: () => {
    closeSheet();
    if (!mockTranscript) return toast('자동 추적 중에 재생할 수 있어요.');
    mockTranscript({ operation: id(), text: '대본 밖에서 들어온 질문입니다.' });
  },
  sample: () => {
    closeSheet();
    if (!['auto', 'searching', 'hold'].includes(state.run.control))
      return toast('자동 추적 중에 재생할 수 있어요.');
    mockSample();
  },
  delay: () => {
    state.run.offset += 30000;
    tick(state.run, performance.now());
    closeSheet();
    render();
    saveProgress();
  },
  disconnect: () => {
    closeSheet();
    connectionLost('음성 연결이 끊어졌습니다.', 'temporary');
  },
  fault: () => {
    state.failStore = !state.failStore;
    closeSheet();
    saveProgress();
    toast(
      state.failStore ? '저장 장애를 재현합니다.' : '저장 장애를 해제했어요.',
    );
  },
  'retry-save': async () => {
    if (state.config.mode === 'mock') state.failStore = false;
    if (state.run.status !== 'running')
      return endRun(state.run.status === 'interrupted');
    if (await saveProgress()) toast('기록을 저장했어요.');
  },
  scenario: () => {
    const project = state.data.projects.find(
      (p) =>
        p.plan?.sections.length === 4 &&
        p.plan.sections[2].sentences.some((l) => l.group),
    );
    if (!project) throw Error('이 시나리오에는 캠퍼스 예시 계획이 필요합니다.');
    state.project = project;
    state.readyMode = 'live';
    const r = makeRun('manual');
    const script = lines(r.plan);
    const points = checkpoints(r.plan);
    if (points.length < 2) throw Error('예시 체크포인트가 필요합니다.');
    const end = script.findIndex((l) => l.id === points[1].checkpoint);
    // Reproduce the two confirmed checkpoint times from the design's delayed run.
    const [first, second] = points;
    const firstAt = first.target + 10000;
    r.offset = firstAt;
    tick(r, r.start);
    r.passes[first.id] = { at: firstAt, source: 'auto' };
    event(r, 'pass', {
      checkpointId: first.id,
      sentenceId: first.checkpoint,
      source: 'auto',
      observedActiveMs: firstAt,
    });
    r.index = end;
    r.offset = second.target + 30000;
    tick(r, r.start);
    complete(r, {
      operation: id(),
      generation: r.generation,
      sentenceId: script[end].id,
      source: 'manual',
    });
    r.offset += 3000;
    tick(r, r.start);
    go('run');
    saveProgress();
  },
};
function groupChange(release) {
  setGroup(state.draft.sections[state.sectionIndex], state.selected, release);
  state.selected = [];
  state.dirty = true;
  render();
}
function mockInput(kind) {
  if (!mockTranscript) throw Error('자동 추적을 시작하세요.');
  const text = sheet.querySelector('[name=testSpeech]').value.trim();
  if (!text) throw Error('시험할 발화를 입력하세요.');
  const r = state.run;
  tick(r, performance.now());
  const deliver = mockTranscript,
    payload = {
      operation: id(),
      text,
      partial: kind === 'partial',
      observed: kind === 'estimate' ? undefined : r.active,
    };
  if (kind === 'delay') delayedTranscript = () => deliver(payload);
  closeSheet();
  if (kind !== 'delay') deliver(payload);
}
function startFromList(key, mode) {
  state.project = state.data.projects.find((p) => p.id === key);
  prepare(mode);
}
async function revisePass(remove) {
  const at = remove ? null : parseTime(sheet.querySelector('input').value);
  if (!remove && at === null)
    throw Error('통과 시각을 분:초 형식으로 입력하세요.');
  const old = state.result,
    sectionId = checkpoints(old.plan)[state.resultIndex].id;
  await readData((data) => {
    const r = data.runs.find((r) => r.id === old.id);
    if (!r || r.events.length !== old.events.length)
      throw Error('기록이 바뀌었습니다. 최신 기록을 다시 여세요.');
    correctPass(r, sectionId, at);
  });
  state.result = structuredClone(state.data.runs.find((r) => r.id === old.id));
  closeSheet();
  render();
}
const presses = new WeakMap();
document.addEventListener('pointerdown', (e) => {
  const b = e.target.closest('button[data-action]');
  if (state.run && ['next', 'manual-pass'].includes(b?.dataset.action)) {
    tick(state.run, performance.now());
    presses.set(b, {
      id: id(),
      at: state.run.active,
      run: state.run.id,
      gen: state.run.generation,
    });
  }
});
document.addEventListener('click', async (e) => {
  const b = e.target.closest('button[data-action]');
  if (!b || b.disabled || b.dataset.busy) return;
  b.dataset.busy = '1';
  try {
    await handlers[b.dataset.action](
      b.dataset.arg,
      e.detail ? presses.get(b) : undefined,
    );
    presses.delete(b);
  } catch (error) {
    problem(error);
  } finally {
    delete b.dataset.busy;
  }
});
document.addEventListener('input', (e) => {
  const el = e.target,
    k = el.name,
    v = el.value;
  if (sheetType === 'section' && dialog.open) {
    if (k === 'sectionTitle') state.sectionCopy.title = v;
    if (k === 'sentence')
      state.sectionCopy.sentences.find((l) => l.id === el.dataset.id).text = v;
  } else if (
    editing() &&
    ['title', 'limit', 'target', 'checkpoint', 'cpTitle'].includes(k)
  ) {
    const p = state.draft,
      s = editablePoints(p)[state.pointIndex];
    if (k === 'title') p.title = v;
    if (k === 'limit') {
      p.limit = parseTime(v);
      lockEnd(p);
    }
    if (k === 'cpTitle') s.title = v;
    if (k === 'target') s.target = parseTime(v);
    if (k === 'checkpoint') s.checkpoint = v;
    state.dirty = true;
  } else if (k === 'adjustTime' && state.adjustment) {
    state.adjustment.target = parseTime(v);
    $('#impact').innerHTML = impact(
      state.result,
      state.resultIndex,
      state.adjustment.target,
    );
  } else if (k === 'adjustLine' && state.adjustment) {
    state.adjustment.checkpoint = v;
    render();
  }
});
document.addEventListener('change', (e) => {
  if (e.target.name === 'grantFault') state.grantFault = e.target.value;
  if (e.target.name === 'sectionIndex') {
    state.sectionIndex = Number(e.target.value);
    state.selected = [];
    render();
  }
});
document.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (e.target.id !== 'auth' || e.target.dataset.busy) return;
  const form = e.target;
  form.dataset.busy = '1';
  try {
    const data = new FormData(form),
      signup = state.page === 'signup';
    if (signup && data.get('confirm') !== data.get('password'))
      throw Error('비밀번호 확인이 일치하지 않습니다.');
    const user = await authenticate(
      data.get('email').trim(),
      data.get('password'),
      signup,
    );
    if (signup) {
      go('login');
      $('#auth [name=email]').value = data.get('email');
      $('#auth [name=password]').value = '';
      toast('계정을 만들었어요. 로그인하세요.');
      return;
    }
    state.user = { uid: user.uid, email: user.email };
    scope = JSON.stringify([
      state.config.mode,
      state.config.firebaseKey,
      user.uid,
    ]);
    await readData();
    go('list');
  } catch (error) {
    problem(error);
  } finally {
    delete form.dataset.busy;
  }
});
$('#tools').addEventListener('click', () => {
  if (state.config) showTools();
});
history.replaceState({ entry: true }, '');
history.pushState({ app: true }, '');
window.addEventListener('popstate', () => {
  if (!dialog.open && ['login', 'list'].includes(state.page)) {
    history.back();
    return;
  }
  history.pushState({ app: true }, '');
  back();
});
setInterval(() => {
  const r = state.run;
  if (!r || state.page !== 'run' || r.status !== 'running') return;
  tick(r, performance.now());
  const [value, label] = timerText(r),
    timer = $('#remaining');
  if (timer) {
    timer.textContent = value;
    timer.classList.toggle('late', r.active > r.plan.limit);
    $('#timer-label').textContent = label;
  }
}, 200);
try {
  state.config = await configure();
  render();
} catch (error) {
  content.innerHTML =
    '<h1>말걸음</h1><p>' +
    esc(error.message) +
    '</p><button class="btn" id="reload">다시 시도</button>';
  $('#reload').onclick = () => location.reload();
}
