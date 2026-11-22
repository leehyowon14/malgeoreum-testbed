// Optional browser acceptance suite. Production and unit tests have no npm dependencies.
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { copyFile, mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || 'playwright'
);
const project = fileURLToPath(new URL('../', import.meta.url));
const dir = await mkdtemp(join(tmpdir(), 'malgeoreum-browser-'));
let server, browser;
try {
  await copyFile(join(project, 'server.mjs'), join(dir, 'server.mjs'));
  await symlink(join(project, 'public'), join(dir, 'public'));
  server = spawn(process.execPath, ['server.mjs'], {
    cwd: dir,
    env: { ...process.env, TESTBED_MODE: 'mock', HOST: '127.0.0.1', PORT: '0' },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const url = await new Promise((resolve, reject) => {
    server.once('exit', () => reject(Error('Mock server exited')));
    server.stdout.on('data', (chunk) => {
      const found = String(chunk).match(/http:\/\/127\.0\.0\.1:\d+/);
      if (found) resolve(found[0]);
    });
  });
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_BIN || undefined,
  });
  const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
    }),
    page = await context.newPage();
  page.setDefaultTimeout(5500);
  const errors = [],
    external = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await context.route('**/*', (route) => {
    if (new URL(route.request().url()).origin === url) return route.continue();
    external.push(route.request().url());
    return route.abort();
  });
  const action = (a, arg) =>
    page.locator(
      '[data-action="' +
        a +
        '"]' +
        (arg == null ? '' : '[data-arg="' + arg + '"]'),
    );
  const tap = (a, arg) => action(a, arg).first().click();
  const tool = async (a) => {
    await page.locator('#tools').click();
    await tap(a);
  };
  const field = (name) => page.locator('[name="' + name + '"]');
  const header = (text) =>
    page.getByRole('heading', { name: text, exact: true }).first().waitFor();
  const info = () => page.locator('#content').innerText();
  const read = async (uid) =>
    page.evaluate(async (uid) => {
      const db = await new Promise((resolve, reject) => {
        const q = indexedDB.open('malgeoreum-testbed-v1', 1);
        q.onsuccess = () => resolve(q.result);
        q.onerror = () => reject(q.error);
      });
      return await new Promise((resolve) => {
        const q = db
          .transaction('accounts')
          .objectStore('accounts')
          .get(JSON.stringify(['mock', '', uid]));
        q.onsuccess = () => {
          db.close();
          resolve(q.result);
        };
      });
    }, uid);
  await page.goto(url);
  await tap('signup');
  await field('email').fill('b@example.test');
  await field('password').fill('fixture123');
  await field('confirm').fill('fixture123');
  await page.getByRole('button', { name: '계정 만들기' }).click();
  await header('로그인');
  await field('password').fill('incorrect');
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  await page.locator('#auth-error').getByText(/확인/).waitFor();
  await field('password').fill('fixture123');
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  await header('나의 발표');
  assert.ok(!(await info()).includes('캠퍼스'));
  await tap('new');
  await field('title').fill('계정 B 발표');
  await tap('edit-section');
  await field('sentence').first().fill('첫 문장입니다.');
  await tap('add-sentence');
  await field('sentence').last().fill('두 번째입니다.');
  await tap('add-sentence');
  await field('sentence').last().fill('마지막입니다.');
  await tap('apply-section');
  await tap('group-page');
  await action('select-line').nth(0).click();
  await action('select-line').nth(1).click();
  await tap('group-set');
  await action('select-line').first().click();
  await tap('group-clear');
  await tap('back');
  await tap('targets');
  await tap('add-point');
  await field('cpTitle').fill('첫 지점');
  await tap('add-point');
  await tap('delete-point');
  await tap('importance');
  await action('level').nth(0).click();
  await tool('plan-fault');
  await tap('publish');
  assert.ok(await field('sectionIndex').isVisible());
  await tool('plan-fault');
  await tap('publish');
  await header('나의 발표');
  await tap('edit');
  await tap('edit-section');
  await action('delete-sentence').first().click();
  await tap('apply-section');
  await tap('targets');
  assert.ok(
    await field('checkpoint')
      .locator('option:checked')
      .innerText()
      .then((t) => t.includes('다시 지정')),
  );
  await tap('importance');
  assert.ok(await field('cpTitle').isVisible());
  await field('checkpoint').selectOption({ label: '두 번째입니다.' });
  await tap('importance');
  await tap('publish');
  await tap('logout');
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  await header('나의 발표');
  assert.ok(!(await info()).includes('계정 B 발표'));
  assert.ok((await info()).includes('캠퍼스'));
  console.log(
    'PASS 가입·인증 오류·UID 분리, 문장 묶기/해제·중요도, 체크포인트 추가/삭제/재지정',
  );
  await tap('records');
  await tap('adjust');
  await tap('use-observed');
  assert.equal(await field('adjustTime').inputValue(), '03:05');
  assert.ok((await info()).includes('1:05'));
  await tap('save-adjust');
  await tap('records');
  assert.ok((await info()).includes('2:45 / 3:15'));
  await tap('correct');
  await tap('invalidate');
  await page
    .locator('.result-row')
    .filter({ hasText: '합산' })
    .first()
    .waitFor();
  await tap('events');
  assert.ok((await page.locator('#sheet').innerText()).includes('변경'));
  await tap('cancel-sheet');
  await tap('back');
  console.log(
    'PASS 당시 계획 고정, 관측 배정 적용, 무효화·합산·원본 이벤트 조회',
  );
  await page.locator('#tools').click();
  await field('grantFault').selectOption('auth');
  await tap('cancel-sheet');
  await tap('rehearsal');
  await tap('start-auto');
  await page.locator('#sheet .form-error').waitFor();
  await tap('start-manual');
  await header('리허설');
  await tool('delay');
  await tap('pause');
  await tool('delay');
  await tap('pause');
  await tap('manual-pass');
  await tap('browse');
  await tap('browse');
  await tap('locate');
  await field('position').selectOption('7');
  await tap('set-position');
  await tap('next');
  await tool('fault');
  await page.getByText('기록 저장 대기 중', { exact: true }).waitFor();
  await tap('end');
  await tap('confirm-end');
  await header('종료 기록 저장 대기 중');
  await tap('confirm-end');
  await header('리허설 결과');
  const rehearsal = (await read('demo')).runs.find(
    (r) => r.plan.revision === 3 && r.mode === 'rehearsal',
  );
  assert.equal(rehearsal.status, 'completed');
  assert.equal(Object.keys(rehearsal.passes).length, 2);
  assert.ok(rehearsal.total - rehearsal.active >= 30000);
  assert.ok(rehearsal.events.some((e) => e.kind === 'position'));
  await tap('back');
  await page.locator('#tools').click();
  assert.ok(
    (await page.locator('#sheet').innerText()).includes('요청 2회 · 성공 0회'),
  );
  await field('grantFault').selectOption('ok');
  await tap('cancel-sheet');
  console.log(
    'PASS 발급 거부와 수동 시작, 시계·통과와 화면 탐색 분리, 저장 장애 및 종료 재시도',
  );
  await tap('live');
  await tap('start-auto');
  await tool('mock-pause');
  const marked = page.locator('.current .word-cursor');
  await page.locator('#tools').click();
  await field('testSpeech').fill('여러분');
  await tap('inject-partial');
  assert.equal(await marked.count(), 0);
  assert.equal(await page.locator('[data-heard-word]').count(), 0);
  await page.locator('#tools').click();
  await field('testSpeech').fill('여러분은');
  await tap('inject-partial');
  assert.equal(await marked.textContent(), '여러분은');
  await tool('inject-partial');
  assert.ok((await info()).includes('인식된 단어'));
  assert.equal(await marked.textContent(), await page.locator('[data-heard-word]').textContent());
  const before = await page.locator('.current').innerText();
  await tool('offscript');
  assert.ok((await info()).includes('위치 확인 중'));
  assert.equal(await marked.count(), 0);
  await tool('inject-final');
  assert.notEqual(await page.locator('.current').innerText(), before);
  const after = await page.locator('.current').innerText();
  await tool('duplicate');
  assert.equal(await page.locator('.current').innerText(), after);
  await tool('capture-late');
  await tool('disconnect');
  await page.getByText(/발화로 시작 위치 확인 중/).waitFor();
  await tool('deliver-late');
  assert.equal(await page.locator('.current').innerText(), after);
  await tool('session-end');
  await page.getByText(/발화로 시작 위치 확인 중/).waitFor();
  await tool('session-end');
  await header('수동 진행');
  await tap('reconnect');
  await tool('phone');
  await header('수동 진행');
  await tap('end');
  await tap('cancel-sheet');
  await header('수동 진행');
  await tap('end');
  await tap('confirm-end');
  await header('나의 발표');
  console.log(
    'PASS 부분·완료 전사, 보류·복귀, 중복·지연 차단, 재연결·정상 종료 반복·마이크 중단',
  );
  await tool('scenario');
  await action('restore').first().waitFor();
  await tap('restore');
  await tap('end');
  await tap('confirm-end');
  await header('나의 발표');
  await tap('records');
  await page
    .getByRole('button', { name: /^실전 ·/ })
    .first()
    .click();
  await header('실전 기록');
  await tap('events');
  assert.ok((await page.locator('#sheet').innerText()).includes('복원'));
  await tap('cancel-sheet');
  await tap('back');
  await tap('logout');
  await field('email').fill('b@example.test');
  await field('password').fill('fixture123');
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  await header('나의 발표');
  assert.ok((await info()).includes('계정 B 발표'));
  assert.ok(!(await info()).includes('캠퍼스'));
  await tap('rehearsal');
  await tap('start-manual');
  await tap('pause');
  await tap('restart');
  await tap('retry-restart');
  await tap('start-manual');
  for (let i = 0; i < 7; i++) await tool('delay');
  await page.locator('#timer-label').getByText('제한 시간 초과').waitFor();
  await tap('end');
  await tap('confirm-end');
  await header('리허설 결과');
  await tap('back');
  await tap('records');
  const attempts = page.locator('#sheet [data-action=record]');
  assert.equal(await attempts.count(), 2);
  assert.notEqual(
    await attempts.nth(0).getAttribute('data-arg'),
    await attempts.nth(1).getAttribute('data-arg'),
  );
  assert.match(await page.locator('#sheet').innerText(), /중단/);
  console.log(
    'PASS 계획 저장 재시도, 리허설 재시작과 이전 시도 보존, 시간 초과 뒤 수동 종료',
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  console.log(
    'PASS 실전 생략·복원과 기록 재조회, 재로그인 보존, 외부 호출 0건',
  );
} finally {
  await browser?.close();
  if (server && server.exitCode === null && server.signalCode === null) {
    const stopped = once(server, 'exit');
    server.kill();
    await stopped;
  }
  await rm(dir, { recursive: true, force: true });
}
