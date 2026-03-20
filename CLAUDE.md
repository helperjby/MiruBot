# MiruBot 프로젝트

## 개요

메신저봇R 기반의 카카오톡 봇 프로젝트입니다.

## 메신저봇R 엔진

메신저봇R은 버전에 따라 두 가지 JavaScript 엔진을 지원합니다:

- **Graal JS** — 최신 버전에서 사용하는 엔진. 본 프로젝트의 기본 엔진입니다.
- **Rhino JS** — 구버전 엔진.

각 엔진의 API 및 특성은 아래 문서를 참고하세요:

- `bots/Graal JS.md` — Graal JS 엔진 레퍼런스
- `bots/Rhino JS.md` — Rhino JS 엔진 레퍼런스

## 코드 작성 가이드

- 봇 코드를 작성할 때 반드시 `bots/Example code(style Guide).js`를 참고하여 스타일과 패턴을 따릅니다.
- 본 프로젝트는 **Graal JS** 엔진을 사용합니다. Rhino JS 문법이 아닌 Graal JS 문법으로 작성하세요.

## 참고 문서

| 파일 | 용도 |
|------|------|
| `bots/migration.md` | Rhino JS → Graal JS 마이그레이션 가이드 |
| `bots/version_issue.md` | 메신저봇R 버전별 알려진 이슈 |
| `bots/faq.md` | 자주 발생하는 문의 및 해결 방법 |
