let session, config;
let blockedUntil = 0;
export async function configure() {
  const res = await fetch('/config', { cache: 'no-store' });
  if (!res.ok) throw Error('테스트베드 설정을 불러올 수 없습니다.');
  return (config = await res.json());
}
export async function authenticate(email, password, register) {
  const mock = config.mode === 'mock';
  const url = mock
    ? '/mock/' + (register ? 'signup' : 'login')
    : 'https://identitytoolkit.googleapis.com/v1/accounts:' +
      (register ? 'signUp' : 'signInWithPassword') +
      '?key=' +
      encodeURIComponent(config.firebaseKey);
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(
      mock ? { email, password } : { email, password, returnSecureToken: true },
    ),
    signal: AbortSignal.timeout(15000),
  });
  const body = await res.json();
  if (!res.ok)
    throw Error(
      body.message ||
        (body.error?.message === 'EMAIL_EXISTS'
          ? '이미 가입한 이메일입니다.'
          : '인증에 실패했습니다. 이메일과 비밀번호를 확인하세요.'),
    );
  if (!register)
    session = mock
      ? body
      : {
          uid: body.localId,
          email: body.email,
          token: body.idToken,
          refresh: body.refreshToken,
        };
  return session;
}
export function logout() {
  session = null;
  blockedUntil = 0;
}
async function token(force) {
  if (!session) throw Error('다시 로그인하세요.');
  if (!force) return session.token;
  const res = await fetch(
    'https://securetoken.googleapis.com/v1/token?key=' +
      encodeURIComponent(config.firebaseKey),
    {
      method: 'POST',
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: session.refresh,
      }),
      signal: AbortSignal.timeout(12000),
    },
  );
  if (!res.ok) throw Error('인증이 만료되었습니다. 다시 로그인하세요.');
  const body = await res.json();
  session.token = body.id_token;
  session.refresh = body.refresh_token;
  return session.token;
}
export async function issueSecret(getToken = token, request = fetch) {
  if (Date.now() < blockedUntil)
    throw Error(
      '발급 제한 중입니다. ' +
        Math.ceil((blockedUntil - Date.now()) / 1000) +
        '초 뒤 다시 시도하세요.',
    );
  for (const force of [false, true]) {
    const res = await request('/backend/v1/realtime/client-secrets', {
      method: 'POST',
      cache: 'no-store',
      headers: { Authorization: 'Bearer ' + (await getToken(force)) },
      signal: AbortSignal.timeout(15000),
    });
    if (res.status === 401 && !force) continue;
    if (res.status === 429) {
      const seconds = Math.max(1, Number(res.headers.get('retry-after')) || 1);
      blockedUntil = Date.now() + seconds * 1000;
      throw Error('발급 제한 중입니다. ' + seconds + '초 뒤 다시 시도하세요.');
    }
    if (res.status === 401)
      throw Error('인증이 만료되었습니다. 다시 로그인하세요.');
    if (res.status === 404)
      throw Error('서버에 음성 자격증명 발급 API가 아직 없습니다.');
    if (!res.ok) {
      const code = (await res.json().catch(() => ({}))).error?.code;
      const error = Error(
        code === 'temporarily_unavailable'
          ? '음성 서버가 일시적으로 응답하지 않습니다.'
          : '음성 인식을 사용할 수 없습니다.',
      );
      error.retryable = code === 'temporarily_unavailable';
      throw error;
    }
    const body = await res.json();
    if (
      typeof body.client_secret !== 'string' ||
      !body.client_secret ||
      !Number.isInteger(body.expires_at) ||
      body.expires_at <= Date.now() / 1000
    )
      throw Error('서버에서 유효한 단기 자격증명을 받지 못했습니다.');
    return body.client_secret;
  }
}
export async function health() {
  if (config.mode === 'mock') return 'Mock 정상';
  const res = await fetch('/backend/health', {
    cache: 'no-store',
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok || (await res.json()).status !== 'ok')
    throw Error('백엔드 상태를 확인할 수 없습니다.');
  return 'API 정상';
}

// Exercise the same client-side issuer contract without an external credential.
export function mockIssuer(fault, stats) {
  const getToken = async () =>
    fault === 'auth' ? 'invalid-test-token' : 'mock-user';
  return issueSecret(getToken, async (_path, options) => {
    stats.requests++;
    if (options.headers.Authorization !== 'Bearer mock-user')
      return Response.json(
        { error: { code: 'invalid_token' } },
        { status: 401 },
      );
    if (fault === 'rate')
      return Response.json(
        { error: { code: 'rate_limited' } },
        { status: 429, headers: { 'Retry-After': '5' } },
      );
    if (fault === 'quota' || fault === 'temporary')
      return Response.json(
        {
          error: {
            code:
              fault === 'quota'
                ? 'transcription_unavailable'
                : 'temporarily_unavailable',
          },
        },
        { status: 503 },
      );
    stats.grants++;
    return Response.json({
      client_secret: 'mock-only-' + stats.grants,
      expires_at: Math.floor(Date.now() / 1000) + 60,
    });
  });
}
