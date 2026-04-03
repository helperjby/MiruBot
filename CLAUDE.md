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
