# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 개요

메신저봇R(Android) 기반 카카오톡 봇 + 라즈베리파이 FastAPI 백엔드로 구성된 프로젝트.
봇(JavaScript, Graal JS)이 서버(Python)와 HTTP/JSON으로 통신하는 구조.

## 아키텍처

```
[카카오톡] ↔ [MessengerBot R (Android)]
                   ↕ HTTP/JSON
            [FastAPI (Raspberry Pi :8080)]
                   ↕
              [SQLite DB]
```

- **봇 (bots/)**: Graal JS 엔진으로 실행. Android 앱(MessengerBot R)에서 카카오톡 알림을 읽고 자동 응답.
- **서버 (server/)**: FastAPI + uvicorn. Docker로 배포. 스크래핑, AI 요약, 번역, 게임 API 등 담당.
- **DB**: SQLite (server/data/chat.db). WAL 모드, thread-local 연결.

## 빌드 & 배포

```bash
# 도커 빌드 및 재시작
cd server && docker compose down && docker compose up -d --build

# 로그 확인
docker logs server-web-1 --tail 30

# 서버 로컬 실행 (개발용)
cd server && uvicorn app.main:app --host 0.0.0.0 --port 8080 --reload
```

테스트 프레임워크, CI/CD, 린터는 없음. 수동 검증 후 배포.

## 봇 코드 작성 가이드

- **엔진**: Graal JS (ES6+). Rhino JS 문법 사용 금지.
- **스타일**: `bots/Example code(style Guide).js` 패턴을 따름.
- **API 레퍼런스**: `bots/Graal JS.md` (메시지 객체, Replier, SessionManager 등)
- **HTTP**: `org.jsoup.Jsoup`으로 서버와 통신 (GET/POST/DELETE)
- **스레딩**: API 호출은 반드시 `new java.lang.Thread(fn).start()` 안에서 실행 (UI 블로킹 방지)
- **명령어**: `bot.setCommandPrefix("!")` + `Event.COMMAND` 리스너
- **자동 감지**: `Event.MESSAGE` 리스너 (쿨다운 필수)
- **카카오톡 더보기**: `"\u200b".repeat(500)`으로 긴 메시지 접기 처리

### cmd 객체 주요 속성

| 속성 | 설명 |
|------|------|
| `cmd.command` | 명령어 이름 (프리픽스 제외) |
| `cmd.args` | 인자 배열 (공백 분리) |
| `cmd.channelId` | 채팅방 고유 ID |
| `cmd.reply(msg)` | 해당 채팅방에 응답 |
| `cmd.room` | 채팅방 이름 |

### 봇 로컬 데이터 파일

- 경로 규칙: `sdcard/msgbot/Bots/<봇이름>/<파일명>` — 봇 디렉토리 바로 아래에 평탄하게 둔다 (`gameinfo/`·`data/` 같은 서브폴더로 묶지 않음).
- 저장소 측 산출물도 동일하게 평탄(`bots/<봇이름>/<파일명>`)하게 두어 안드로이드로 그대로 복사.
- 읽기 패턴: `BufferedReader(InputStreamReader(FileInputStream, "UTF-8"))` 로 한 줄씩 읽어 `JSON.parse`. 파일 크기가 큰 정적 번들은 모듈 스코프 변수에 **1회만 캐시**하고 이후 호출은 캐시 반환. 최초 로드는 `new Thread()` 안에서 수행.
- 쓰기 패턴: `FileOutputStream` + `String(JSON.stringify(...)).getBytes("UTF-8")`. `try/finally` 로 close 보장.
- 예시: [bots/거상봇.js](bots/거상봇.js) 의 `loadMemos`(쓰기 가능한 사용자 데이터), `loadQuestData`(읽기 전용 정적 번들).

### 정적 데이터 번들 패턴 (참조성 게임 정보)

외부 사이트의 참조성 데이터(퀘스트, 시스템 수치표 등)는 다음 흐름으로 처리.

1. `server/scripts/parse_*.py` 에 일회성 파서 작성 (`requests` + `beautifulsoup4`). 출처 사이트 부하를 위해 요청 간 딜레이.
2. 산출물은 단일 JSON 번들로 `bots/<봇이름>/<카테고리>.json` 에 저장 (저장소에 커밋).
3. 사용자가 안드로이드 기기 `sdcard/msgbot/Bots/<봇이름>/<카테고리>.json` 으로 수동 복사.
4. 봇은 명령어 호출 시 로컬 번들만 읽어 응답 (네트워크 호출 없음).
5. 데이터 갱신은 1~3 단계를 다시 수행.

스키마는 명령어 디스패치를 단순화하도록 `categories` (목록), `aliases` (축약명 → 정식명), `<항목>` 별 상세 필드를 한 파일에 모은다. 예: [bots/거상봇/quests.json](bots/거상봇/quests.json), 파서 [server/scripts/parse_gersangjjang.py](server/scripts/parse_gersangjjang.py).

## 서버 구조

| 파일 | 역할 |
|------|------|
| `server/app/main.py` | FastAPI 라우트 + 백그라운드 루프 (startup) |
| `server/app/database.py` | SQLite 연결 + 테이블/마이그레이션 관리 |
| `server/app/models.py` | Pydantic 요청/응답 모델 |
| `server/app/services/` | 비즈니스 로직 (스크래핑, AI, 검색 등) |

### 주요 패턴

- **백그라운드 스크래핑**: `asyncio.create_task` + `asyncio.to_thread`로 동기 함수를 비동기 루프에서 실행
- **데이터 소비**: 서버가 버퍼에 누적 → 봇이 API 호출로 1회 소비 후 비움 (`get_new_entries()` 패턴)
- **DB 마이그레이션**: `init_db()`에서 `ALTER TABLE ... ADD COLUMN` + `try/except OperationalError`로 처리. ALTER는 CREATE INDEX보다 먼저 실행해야 함.

## 환경변수 (server/.env)

| 변수 | 용도 |
|------|------|
| `GEMINI_API_KEY` | Google Gemini AI |
| `YOUTUBE_API_KEY` | YouTube Data API |
| `CHAT_DB_PATH` | SQLite 경로 (기본: /app/data/chat.db) |
| `GERSANG_SERVER_ID` | 거상 서버 ID (기본: "7") |

## 참고 문서

| 파일 | 용도 |
|------|------|
| `bots/Graal JS.md` | Graal JS 엔진 API 레퍼런스 |
| `bots/Example code(style Guide).js` | 봇 코드 스타일 가이드 |
| `bots/migration.md` | Rhino → Graal 마이그레이션 |
| `bots/version_issue.md` | 메신저봇R 버전별 이슈 |
| `bots/<봇이름>.md` | 각 봇의 명령어, 기능, 변경 이력 |
| `gersang_handoff.md` | 거상봇 v2.0 설계 문서 |
