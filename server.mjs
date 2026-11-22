import http from 'node:http';
import {
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const publicRoot = fileURLToPath(new URL('./public', import.meta.url));
const accountDir = fileURLToPath(new URL('./.local', import.meta.url));
const accountsFile = resolve(accountDir, 'accounts.json');
const apiMode = process.env.TESTBED_MODE === 'api';
const backend = new URL(process.env.API_BASE_URL || 'http://127.0.0.1:8000');
const firebaseKey = process.env.FIREBASE_WEB_API_KEY || '';
if (apiMode && !firebaseKey)
  throw Error('API 모드에는 FIREBASE_WEB_API_KEY가 필요합니다.');
const types = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain',
};
function json(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(data));
}
async function mockAuth(req, res, register) {
  let size = 0;
  const parts = [];
  for await (const part of req) {
    size += part.length;
    if (size > 4096) return json(res, 413, { message: '입력이 너무 깁니다.' });
    parts.push(part);
  }
  const data = JSON.parse(Buffer.concat(parts));
  const email = String(data.email || '')
    .trim()
    .toLowerCase();
  const password = data.password;
  if (
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    typeof password !== 'string' ||
    password.length < 6
  )
    return json(res, 400, {
      message: '이메일과 6자 이상의 비밀번호를 입력하세요.',
    });
  const accounts = existsSync(accountsFile)
    ? JSON.parse(readFileSync(accountsFile, 'utf8'))
    : [];
  const demo = email === 'hello@example.com';
  const account = accounts.find((item) => item.email === email);
  if (register) {
    if (account || demo)
      return json(res, 409, { message: '이미 가입한 이메일입니다.' });
    const salt = randomBytes(16).toString('hex');
    const uid = randomUUID();
    accounts.push({
      uid,
      email,
      salt,
      hash: scryptSync(password, salt, 32).toString('hex'),
    });
    mkdirSync(accountDir, { recursive: true, mode: 0o700 });
    writeFileSync(accountsFile + '.tmp', JSON.stringify(accounts), {
      mode: 0o600,
    });
    renameSync(accountsFile + '.tmp', accountsFile);
    return json(res, 201, { uid, email });
  }
  const valid = demo
    ? password === 'demo1234'
    : account &&
      timingSafeEqual(
        scryptSync(password, account.salt, 32),
        Buffer.from(account.hash, 'hex'),
      );
  if (!valid)
    return json(res, 401, { message: '이메일 또는 비밀번호를 확인하세요.' });
  json(res, 200, { uid: demo ? 'demo' : account.uid, email });
}

const server = http.createServer(async (req, res) => {
  try {
    const path = decodeURIComponent(new URL(req.url, 'http://local').pathname);
    const origin = req.headers.origin;
    if (origin && new URL(origin).host !== req.headers.host)
      return json(res, 403, {});
    if (req.method === 'GET' && path === '/config') {
      return json(res, 200, {
        mode: apiMode ? 'api' : 'mock',
        firebaseKey: apiMode ? firebaseKey : '',
      });
    }
    if (
      !apiMode &&
      req.method === 'POST' &&
      ['/mock/login', '/mock/signup'].includes(path)
    ) {
      if (!req.headers['content-type']?.startsWith('application/json'))
        return json(res, 415, {});
      return await mockAuth(req, res, path.endsWith('/signup'));
    }
    const health = req.method === 'GET' && path === '/backend/health';
    const issue =
      req.method === 'POST' && path === '/backend/v1/realtime/client-secrets';
    if (apiMode && (health || issue)) {
      const headers = issue
        ? { Authorization: req.headers.authorization || '' }
        : {};
      const reply = await fetch(new URL(path.slice(8), backend), {
        method: req.method,
        headers,
        redirect: 'error',
        signal: AbortSignal.timeout(12000),
      });
      res.writeHead(reply.status, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        ...(reply.headers.has('retry-after')
          ? { 'Retry-After': reply.headers.get('retry-after') }
          : {}),
      });
      return res.end(Buffer.from(await reply.arrayBuffer()));
    }
    const file = resolve(
      publicRoot,
      '.' + (path === '/' ? '/index.html' : path),
    );
    if (
      req.method !== 'GET' ||
      !file.startsWith(publicRoot + sep) ||
      !types[extname(file)] ||
      !existsSync(file)
    )
      return json(res, 404, {});
    res.writeHead(200, {
      'Content-Type':
        types[extname(file)] +
        (extname(file) === '.ttf' ? '' : '; charset=utf-8'),
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(readFileSync(file));
  } catch (error) {
    if (!res.headersSent)
      json(res, error instanceof SyntaxError ? 400 : 502, {
        message: '요청 처리에 실패했습니다.',
      });
    else res.end();
  }
});
const host = process.env.HOST || '127.0.0.1';
server.listen(Number(process.env.PORT || 4173), host, () =>
  console.log(
    '말걸음 · ' +
      (apiMode ? 'API' : 'Mock') +
      ' · http://' +
      host +
      ':' +
      server.address().port,
  ),
);
