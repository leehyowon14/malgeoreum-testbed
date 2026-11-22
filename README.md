# 말걸음 모바일 웹 테스트베드

기획 v03과 Figma의 S-01~S-08 흐름을 브라우저에서 실행한다. Node.js 22 이상이면 패키지 설치 없이 실행할 수 있다.

[기획 v03 기능별 재현 방법과 검증 범위](requirements-coverage.md)에서 FR-01~20의 화면 조작과 실제 환경 확인 항목을 볼 수 있다.

## Mock 실행

이 디렉터리에서 실행한다.

```sh
npm start
```

[테스트베드 열기](http://127.0.0.1:4173). 로그인 화면에는 데모 계정 `hello@example.com`과 비밀번호 `demo1234`가 입력되어 있다. 데모 계정에는 5분 발표와 초안, 샘플 리허설 결과가 있다. 새로 가입한 계정은 빈 목록으로 시작한다.

휴대폰으로 확인할 때에는 같은 Wi-Fi에서 `HOST=0.0.0.0 npm start`를 실행하고 `http://<컴퓨터의 LAN IP>:4173`을 연다. 포트는 `PORT`로 변경할 수 있다. Mock 모드는 기기 마이크, Firebase, 외부 전사 서비스를 호출하지 않는다.

## 확인할 흐름

| 시작 위치 | 조작과 확인 사항 |
| --- | --- |
| 나의 발표 → 새 발표 만들기 | 제목·시간 입력 → 구간 편집에서 문장 입력·추가 → 구간별 누적 목표 → 문장 중요도 → 설정 저장. 편집 중 목록으로 돌아갈 때 초안을 저장할 수 있다. |
| 대본 편집 → 문장 선택·묶기 | 같은 구간의 연속 문장 두 개 이상을 묶거나 기존 묶음을 해제한다. 문장 순서와 원문을 유지한다. |
| 나의 발표 → 기록 보기 | 예시의 전체 5:48에서 일시정지 0:20을 제외한 5:28을 확인한다. 두 번째 체크포인트에서 ‘목표 시간 수정 → 구간 소요 시간 적용’을 누르면 누적 목표가 2:45에서 3:05로 바뀐다. 저장 후 원래 기록과 새 계획을 각각 열어 비교할 수 있다. |
| 리허설 → 음성 없이 수동으로 시작 | 다음 문장으로 통과를 확인하고, 위치 지정으로 건너뛴 뒤 일시정지·재개하거나 종료한다. 결과에는 관측하지 않은 통과와 인접 구간이 ‘미확인’으로 남는다. |
| 실전 → 모의 음성으로 시작 | 약 4.5초마다 현재 문장의 모의 전사가 도착한다. 상단 ‘테스트 도구’에서 문장 인식, 대본 밖 발화, 30초 경과, 연결 단절, 저장 장애를 재현한다. 연결이 끊겨도 시계가 계속 흐르며 수동으로 전환할 수 있다. |
| 나의 발표 → 테스트 도구 → 실전 지연 · 생략과 복원 재현 | 데모 발표를 두 번째 체크포인트가 30초 늦은 상태에서 연다. 회색 보충 문장을 눌러 두 문장이 함께 복원되는지 확인한다. ‘다음 문장’은 현재 문장을 완료하고 ‘여기부터 이어가기’는 통과 없이 위치만 바꾼다. |

브라우저에서 발표·초안·실행은 모드와 계정별 IndexedDB에 저장한다. 로그인 상태와 원음·전사 전문은 영구 저장하지 않는다. 새로고침 후 로그인하면 저장된 기록을 조회할 수 있다. Mock 가입 정보는 개발 서버의 `.local/accounts.json`에 salt와 비밀번호 검증값으로 보관한다. 다른 브라우저나 포트로 열면 브라우저의 발표 저장소가 달라진다.

## 백엔드 연결

FastAPI 백엔드를 먼저 실행한다. 이 저장소 최상위에 `.env` 파일을 만들고 `TESTBED_MODE=api`, `API_BASE_URL=http://127.0.0.1:8000`, 같은 Firebase 프로젝트의 `FIREBASE_WEB_API_KEY`를 설정한다. 별도 터미널에서 아래 명령으로 테스트베드를 시작한다. [백엔드 설정](https://github.com/leehyowon14/malgeoreum-backend#readme) · [OpenAPI 명세](https://github.com/leehyowon14/malgeoreum-backend/blob/main/docs/openapi.json)

```sh
node --env-file=.env server.mjs
```

1. Firebase 테스트 계정으로 로그인한다. Mock과 API 모드의 계정·발표는 분리된다. 새 발표를 저장하면 수동 실행부터 확인할 수 있다.
2. ‘테스트 도구 → 서버 상태 확인’에서 실제 `GET /health` 응답을 확인한다.
3. 리허설이나 실전에서 ‘마이크 허용하고 시작’을 선택한다. 브라우저 권한을 얻으면 Firebase ID 토큰으로 본문 없는 `POST /v1/realtime/client-secrets`를 호출한다. 개발 서버는 명세의 두 경로만 프록시한다. `API_BASE_URL`은 백엔드의 원점 주소이다.
4. 발급된 `client_secret`으로 WebRTC 연결을 열고 마이크 오디오를 전사 제공자에게 직접 보낸다. 모의 전사는 API 모드에서 꺼진다. 기기 마이크를 쓰는 실제 연결에는 HTTPS 또는 같은 기기의 localhost가 필요하다. 휴대폰에서 LAN IP로 연 HTTP 페이지에서는 수동 진행과 Mock 시험을 사용할 수 있다.
5. 401이면 토큰을 한 번 갱신하며 429이면 Retry-After 동안 발급을 막는다. 발급 실패·권한 거부 후에는 수동 시작을 선택할 수 있다. 수동 시작은 발급 요청을 보내지 않는다. 서버용 OpenAI 키는 백엔드에서 관리한다.

프로젝트 `malgeoreum`에서 실제 이메일 가입·로그인 후 이 프록시를 통한 단기 키 발급을 확인했다. 별도 브라우저 시험에서 합성 한국어 음성의 WebRTC 전사 완료도 확인했다. Android 물리 마이크 검증은 남아 있다.

리허설과 실전에서는 부분 전사에 대본 어절 전체가 들어오는 즉시 해당 단어에 밑줄이 생긴다. 첫 음절만 도착한 동안에는 마지막으로 인식된 단어에 머문다. 오인식이 있어도 다음에 인식된 단어로 이어가며, 위치를 오래 잃으면 더 먼 문장까지 찾는다. [한국어 음성으로 측정한 단어 표시와 문장 복귀](word-cursor-rehearsal.md)

이 테스트베드에서는 문장 경계에서 예상 부족 시간이 15초를 넘으면 보충부터 생략하고, 직접 복원한 묶음은 그 실행 동안 보호한다. 모의 발화 간격과 실제 음성의 발화 종료 감지값은 테스트용 기준이다.

## 코드와 검사

| 파일 | 역할 |
| --- | --- |
| `server.mjs` | 정적 웹 서버, Mock 계정, 설정과 백엔드 프록시 |
| `public/services.js` | Firebase 인증·토큰 갱신, 상태 확인과 발급 요청 |
| `public/voice.js` | Mock 전사 재생, WebRTC 연결·종료와 발화 순서 복원 |
| `public/tracking.js` | 부분 전사 후보, 완료 판정, 보류·복귀와 구세대 응답 차단 |
| `public/word-tracking.js` | 대본 어절 위치, 전사 조각 간 문맥 연결, 시간에 따른 탐색 범위 조정 |
| `public/repository.js` | 계정별 저장 및 예시 데이터, 동시 수정 감지 |
| `public/model.js` | 계획 검증, 실행 시계, 문장 묶음, 생략·복원 및 통과 기록 |
| `public/app.js`, `editor.js`, `run-view.js` | 화면 전환, 편집, 실행과 결과 |
 
```sh
npm test
```

테스트는 발급 성공·실패, 체크포인트 중복 방지, 누락된 관측과 구간 계산, 발화 순서, 생략·복원 및 버전 보존을 외부 호출 없이 확인한다.

[기획 v03 요구사항별 재현 방법](requirements-coverage.md) · [Figma 화면](https://www.figma.com/design/6ROk0dkV93LxAfQojY5bW1/2026-모프?node-id=0-1) · [백엔드 계약](https://github.com/leehyowon14/malgeoreum-backend/blob/main/docs/contract-v1.md) · [Firebase 인증 REST API](https://firebase.google.com/docs/reference/rest/auth) · [WebRTC](https://developers.openai.com/api/docs/guides/realtime-webrtc) · [실시간 전사](https://developers.openai.com/api/docs/guides/realtime-transcription)
