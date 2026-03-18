# URL 요약 및 번역 API

카카오톡 메신저봇R과 연동되는 URL 요약 및 번역 API 서비스입니다.

## 버전 정보

- **v1.0.0**: 초기 릴리스 - URL 요약 및 기본 번역 기능
- **v1.1.0**: 언어 감지 기능 추가 - 번역 시 원본 언어 자동 감지 및 표시

## 기능

- URL 추출 및 처리
- 다양한 웹사이트 유형 감지 및 맞춤형 요약 생성
- Google Gemini AI를 활용한 콘텐츠 요약
- 번역 기능 지원
  - 언어 자동 감지 (langdetect 라이브러리 활용)
  - 구체적인 언어 표시 (예: "프랑스어 → 한국어", "러시아어 → 한국어")

## 지원 사이트

- DCInside
- FMKorea
- YouTube (트랜스크립트 기반)
- 네이버 (뉴스, 카페 등)
- 쇼핑몰 (쿠팡, 11번가, 스마트스토어 등)
- PDF 파일 (arXiv 논문 등)
- 일반 웹사이트

## 기술 스택

- FastAPI
- Docker
- LangChain
- Google Gemini API
- BeautifulSoup4

## 설치 및 실행

### 환경 변수 설정

`.env` 파일을 생성하고 다음 내용을 추가합니다:

```
GEMINI_API_KEY=your_api_key_here
```

### Docker를 이용한 실행

```bash
docker-compose up -d
```

### API 엔드포인트

- `GET /`: API 상태 확인
- `GET /test`: 서버 상태 테스트
- `POST /process-url`: URL 처리 및 요약

## 카카오톡 메신저봇 연동

`메신저봇.txt` 파일에 포함된 JavaScript 코드를 카카오톡 메신저봇R에 적용하여 사용할 수 있습니다.

## GitHub 저장소 및 버전 관리

이 프로젝트는 GitHub에서 버전 관리됩니다. 각 버전은 태그를 통해 관리되며, 주요 변경사항은 커밋 메시지와 README의 버전 정보에 기록됩니다.

### 버전 관리 규칙

- **주 버전(Major)**: 호환성이 깨지는 변경사항
- **부 버전(Minor)**: 기능 추가 및 개선
- **수 버전(Patch)**: 버그 수정

### 배포 방법

```bash
# 최신 코드 가져오기
git pull origin main

# Docker 이미지 빌드 및 실행
docker-compose up -d --build
```
