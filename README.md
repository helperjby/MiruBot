# MiruBot

카카오톡 메신저봇R 기반의 다기능 챗봇 + Raspberry Pi FastAPI 백엔드 시스템

## 구성

```
MiruBot/
├── bots/           # 메신저봇R 스크립트 (Android, GraalJS)
│   ├── API.js          # URL 요약 / 번역 / 이미지 전송
│   ├── 마비노기봇.js     # 마비노기 모바일 연동 (알림, 랭킹, 룬워드)
│   ├── 채팅봇.js        # 커뮤니티 (레벨, 추천, 닉네임 히스토리)
│   ├── 관리봇.js        # 봇 관리 / 모니터링 / 오너 전용 제어
│   ├── 라오킹봇.js      # 라이즈 오브 킹덤즈 일정 관리
│   └── 요약봇.js        # 채팅 로그 수집 / 요약 요청
├── server/         # Raspberry Pi FastAPI 백엔드 (Docker)
│   ├── app/
│   │   ├── main.py         # API 엔드포인트
│   │   ├── services/       # Gemini LLM, 웹 스크래핑, 번역, 게임
│   │   └── utils/          # 텍스트 유틸리티
│   ├── Dockerfile
│   └── docker-compose.yml
├── data/           # 게임 데이터 (룬, NPC, 인챈트)
├── docs/           # 개발 가이드 및 메모
└── notebooks/      # API 테스트용 Jupyter Notebook
```

## 주요 기능

### 봇 (카카오톡)
- **URL 요약** - 채팅에 공유된 링크를 Gemini AI로 자동 요약 (뉴스, YouTube, 커뮤니티 등)
- **번역** - 한/영 자동 감지 번역
- **이미지 전송** - OneDrive 동기화 이미지를 카카오톡으로 전송
- **게임 알림** - 마비노기 모바일 어비스/심층 구멍 실시간 알림
- **커뮤니티** - 레벨, 경험치, 칭호/등급 시스템(7단계), 누적/월간 랭킹, 추천/비추천, 닉네임 변경 이력
- **봇 관리** - 전원 제어, 원격 컴파일, 로그 조회, 메모리/업타임 모니터링, 방별 적용 관리 (오너 전용)
- **운세** - 마비노기 열쇠 운세 미니게임
- **일정 관리** - 라오킹 폐허/제단 일정, 생일 알림
- **채팅 요약** - 최근 N시간 대화 내용을 Gemini AI로 요약 (토큰 최적화 전처리 포함)

### 서버 (Raspberry Pi)

- **Gemini AI 요약** - 웹페이지/YouTube 콘텐츠 요약, 채팅 로그 요약
- **환율/증시** - 네이버 금융 실시간 데이터 조회
- **랜덤 이미지 API** - 카테고리별 이미지 제공
- **랭킹 프록시** - 외부 게임 랭킹 API 중계

## 기술 스택

| 구분 | 기술 |
|------|------|
| 봇 클라이언트 | 메신저봇R (Android) / GraalJS / Jsoup |
| 백엔드 | FastAPI / Python 3.11 / Docker |
| AI | Google Gemini 3.1 Flash Lite |
| 인프라 | Raspberry Pi / Docker Compose |
| 데이터 동기화 | OneDrive (crontab) |

## DB 관리

### 채팅 로그 DB

- SQLite (`server/data/chat.db`)
- 2025-01-01 이후 데이터만 보존 (이전 데이터 삭제됨)
- `user_hash`는 12자로 truncate하여 저장 (용량 최적화)

### 마이그레이션 스크립트

| 스크립트 | 용도 |
|----------|------|
| `server/scripts/optimize_db.py` | DB 데이터 정리 + hash truncate + VACUUM |
| `server/scripts/migrate_json_hashes.py` | 봇 JSON 파일의 hash 키 12자 변환 |
| `server/scripts/migrate_eml.py` | .eml 파일에서 채팅 이력 가져오기 |

```bash
# DB 최적화 (dry-run 먼저 확인 후 --execute)
cd server
sudo python3 scripts/optimize_db.py
sudo python3 scripts/optimize_db.py --execute

# 봇 JSON 파일 해시 마이그레이션
python3 scripts/migrate_json_hashes.py --bot-dir /path/to/sdcard/bot
python3 scripts/migrate_json_hashes.py --bot-dir /path/to/sdcard/bot --execute
```

## 로깅

### 로그 형식

메신저봇R은 각 봇의 로그를 `sdcard/msgbot/Bots/{봇이름}/log.json`에 JSON 배열로 저장합니다.

```json
{"a": "로그 메시지", "b": 1, "c": "2026/03/21 15:17:21"}
```

| 키 | 설명 |
| ---- | ------ |
| `a` | 로그 메시지 |
| `b` | 로그 레벨 (1=Info, 2=Debug, 3=Error) |
| `c` | 타임스탬프 |

### 로그 프리픽스 규칙

모든 봇은 `[봇이름]` 프리픽스를 사용하여 로그 출처를 식별합니다.

```text
[관리봇] 채팅봇 봇 켜기 (by 홍길동)
[API] /translate HTTP 오류: 500 - ...
[마비노기봇] onCommand 오류 (!랭킹): TypeError ...
```

### 로그 조회

관리봇의 `!로그` 명령어로 각 봇의 최근 로그를 조회할 수 있습니다.

```text
!로그              → 관리봇 최근 10건
!로그 채팅봇        → 채팅봇 최근 10건
!로그 요약봇 20     → 요약봇 최근 20건 (최대 30건)
```

출력 예시:

```text
--- 요약봇 최근 로그 (10건) ---
[D][15:17:21] [요약봇] 배치 flush 시작: 1건
[D][15:17:21] [요약봇] 배치 flush 완료: 1건 저장
[E][15:25:48] [요약봇] 통계 API 실패: HTTP 500
```

## 실행 방법

### 서버 (Raspberry Pi)

```bash
cd server
cp .env.example .env  # API 키 설정
docker compose up -d --build
```

필요한 환경 변수:
- `GEMINI_API_KEY` - Google Gemini API 키
- `YOUTUBE_API_KEY` - YouTube Data API v3 키

### 봇 (Android)

1. 메신저봇R 앱 설치
2. `bots/` 디렉토리의 스크립트를 앱에 등록
3. `FASTAPI_BASE_URL`을 서버 IP로 수정
4. 알림 접근 권한 허용 후 스크립트 활성화
