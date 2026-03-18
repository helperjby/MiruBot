#!/bin/bash

# 스크립트 실행 중 오류 발생 시 중단
set -e

# 현재 버전 정보
VERSION="1.1.0"
COMMIT_MSG="언어 감지 기능 추가 및 응답 포맷 개선"

echo "===== URL 요약 및 번역 API 배포 스크립트 ====="
echo "버전: $VERSION"
echo "커밋 메시지: $COMMIT_MSG"
echo "=============================================="

# 1. Git 변경사항 커밋
echo "1. Git 변경사항 커밋 중..."
git add .
git commit -m "$COMMIT_MSG"
git tag -a "v$VERSION" -m "버전 $VERSION: $COMMIT_MSG"

# 2. GitHub에 푸시
echo "2. GitHub에 푸시 중..."
git push origin main
git push origin "v$VERSION"

# 3. Docker 이미지 빌드 및 실행
echo "3. Docker 이미지 빌드 및 실행 중..."
docker-compose up -d --build

echo "===== 배포 완료 ====="
echo "버전 $VERSION이 성공적으로 배포되었습니다."
echo "GitHub 태그: v$VERSION"
echo "Docker 컨테이너가 실행 중입니다."
