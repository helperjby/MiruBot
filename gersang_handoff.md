# 거상봇 v2.0 — 육의전 스크래핑 및 알람 기능 핸드오프

## 변경 개요

거상봇에 육의전(마켓플레이스) 데이터 스크래핑, DB 저장, 검색, 채팅방 단위 알람 기능을 추가.
기존 사통팔달 기능은 유지하면서 육의전 기능을 병렬로 동작시킴.

## 변경 파일

| 파일 | 변경 내용 |
|------|-----------|
| `server/app/database.py` | `yukeuijeon_items`, `yukeuijeon_alarms` 테이블 추가 |
| `server/app/services/yukeuijeon_service.py` | **신규** — 스크래핑, DB CRUD, 알람 매칭, 배치 수집 |
| `server/app/services/gersang_service.py` | KST 타임존 적용 (`datetime.now(KST)`) |
| `server/app/models.py` | `YukeuijeonAlarmRequest` Pydantic 모델 추가 |
| `server/app/main.py` | 육의전 API 5개 + `yukeuijeon_scrape_loop` 백그라운드 루프 |
| `bots/거상봇.js` | v1.1→v2.0: 명령어 4개, 알림 폴링, HTTP 유틸 리팩터링 |

## 아키텍처

```
[카카오톡 채팅방]
    ↕ (MessengerBot R)
[거상봇.js (Android)]
    ↕ (HTTP/JSON)
[FastAPI 서버 (Raspberry Pi :8080)]
    ├─ 사통팔달 백그라운드 루프 (5분 간격, 인메모리)
    └─ 육의전 백그라운드 루프 (5분 간격, SQLite 저장)
         ├─ 초기: 800페이지 배치 수집 (50페이지/배치, 30초 대기)
         └─ 이후: 최신 5페이지 주기적 수집
```

## DB 스키마

### yukeuijeon_items
| 컬럼 | 타입 | 설명 |
|------|------|------|
| item_name | TEXT | 띄어쓰기 제거된 이름 (검색용) |
| item_name_raw | TEXT | 원본 이름 (표시용) |
| quantity | INTEGER | 수량 |
| price | INTEGER | 가격 (숫자만) |
| seller | TEXT | 판매자 닉네임 |
| registered_at | TEXT | 등록 시점 (상대시간→KST 절대시간 변환) |
| scraped_at | TEXT | 스크래핑 시점 |
| **UNIQUE** | | (item_name, quantity, price, seller) |

### yukeuijeon_alarms
| 컬럼 | 타입 | 설명 |
|------|------|------|
| channel_id | TEXT | 채팅방 ID |
| keyword | TEXT | 띄어쓰기 제거된 키워드 (매칭용) |
| keyword_raw | TEXT | 원본 키워드 (표시용) |
| **UNIQUE** | | (channel_id, keyword) |

## API 엔드포인트

| Method | Path | 설명 |
|--------|------|------|
| GET | `/gersang/yukeuijeon/search?keyword=X` | 아이템 부분일치 검색 (최대 20건) |
| POST | `/gersang/yukeuijeon/alarm` | 알람 등록 `{channel_id, keyword}` |
| DELETE | `/gersang/yukeuijeon/alarm` | 알람 해제 `{channel_id, keyword}` |
| GET | `/gersang/yukeuijeon/alarms?channel_id=X` | 알람 목록 조회 |
| GET | `/gersang/yukeuijeon/notifications` | 알림 소비 (1회성, 가져간 뒤 비워짐) |

## 봇 명령어

| 명령어 | 설명 |
|--------|------|
| `!육의전 <이름>` | DB에서 아이템 검색, 최대 10건 표시 |
| `!알람등록 <이름>` | 채팅방 단위 알람 등록 |
| `!알람해제 <이름>` | 알람 해제 |
| `!알람목록` | 현재 채팅방의 알람 리스트 |

## 알람 동작 흐름

1. 서버가 5분마다 육의전 최신 5페이지 스크래핑
2. 신규 아이템 감지 시 등록된 알람 키워드와 부분일치 매칭
3. 매칭 결과를 `_pending_notifications` 버퍼에 누적
4. 채팅방에 채팅 발생 시 봇이 `/notifications` 폴링 (5분 쿨다운)
5. 동일 키워드 알림을 합쳐서 **한 건의 메시지**로 발송
6. 상세 내용은 `\u200b` zero-width space로 접기 처리

### 알림 메시지 형식
```
알람 설정한 설삼이(가) 육의전에 등록됐습니다.(총 3건)
[더보기]
샤코묘아, 160,000원, 1152개, 2026-04-02 12:07
공급!, 165,000원, 80개, 2026-04-02 12:05
테스트상인, 170,000원, 50개, 2026-04-02 12:00
```

## 스크래핑 대상 HTML 구조

- URL: `https://geota.co.kr/gersang/yukeuijeon?serverId=7&page=N&orderDirection=desc&category=item&searchType=archived`
- 행 셀렉터: `div.group.flex.min-h-14`
- 컬럼: `div.flex-1` × 5 (이름, 수량, 가격, 닉네임, 등록일)
- 페이지당 10개 아이템
- 시간은 상대시간 ("방금 전", "X분 전", "X시간 전", "X일 전")

## 데이터 관리

- **중복 방지**: `INSERT OR IGNORE` + 복합 유니크 제약
- **만료 정리**: 매 사이클마다 `scraped_at` 기준 3일 초과 데이터 삭제
- **초기 수집**: 서버 시작 시 1회, 800페이지를 50페이지 배치로 나누어 수집 (배치 간 30초 대기)
- **타임존**: 사통팔달·육의전 모두 `datetime.now(KST)` 사용

## 배포 참고

- Docker 컨테이너 재시작 시 초기 대량 스크래핑이 다시 실행됨 (약 10분 소요)
- 초기 스크래핑 중에도 사통팔달은 정상 동작 (별도 asyncio task)
- SQLite DB 파일: `/app/data/chat.db` (Docker 볼륨 `./data:/app/data`)
