import test from 'node:test';
import assert from 'node:assert/strict';
import { issueSecret, logout } from '../public/services.js';
const valid = () =>
  Response.json({
    client_secret: 'fixture',
    expires_at: Math.floor(Date.now() / 1000) + 60,
  });
test('계약 경로와 빈 POST 본문, 401에서 한 번만 토큰 강제 갱신', async () => {
  const calls = [],
    refresh = [];
  const value = await issueSecret(
    async (force) => {
      refresh.push(force);
      return force ? 'fresh' : 'old';
    },
    async (path, opts) => {
      calls.push([path, opts]);
      return calls.length === 1 ? new Response(null, { status: 401 }) : valid();
    },
  );
  assert.equal(value, 'fixture');
  assert.deepEqual(refresh, [false, true]);
  assert.ok(
    calls.every(
      ([path, o]) =>
        path === '/backend/v1/realtime/client-secrets' &&
        o.method === 'POST' &&
        o.body === undefined,
    ),
  );
  assert.equal(calls[1][1].headers.Authorization, 'Bearer fresh');
});
test('429 Retry-After 동안 발급을 막고 503 및 만료된 발급값을 거부한다', async () => {
  let count = 0;
  const limited = async () => {
    count++;
    return new Response(null, {
      status: 429,
      headers: { 'Retry-After': '20' },
    });
  };
  await assert.rejects(
    issueSecret(async () => 'id', limited),
    /20초/,
  );
  await assert.rejects(
    issueSecret(async () => 'id', limited),
    /발급 제한/,
  );
  assert.equal(count, 1);
  logout();
  await assert.rejects(
    issueSecret(
      async () => 'id',
      async () =>
        Response.json(
          { error: { code: 'temporarily_unavailable' } },
          { status: 503 },
        ),
    ),
    /일시적/,
  );
  await assert.rejects(
    issueSecret(
      async () => 'id',
      async () => Response.json({ client_secret: 'old', expires_at: 10 }),
    ),
    /유효한/,
  );
});
