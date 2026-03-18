FROM python:3.11-slim-bookworm

WORKDIR /app

# 1. OS 보안 패치 및 불필요한 파일 정리
RUN apt-get update && apt-get upgrade -y && \
    apt-get install -y --no-install-recommends gcc python3-dev && \
    rm -rf /var/lib/apt/lists/*

# 2. pip 자체 보안 업데이트
RUN pip install --no-cache-dir --upgrade pip setuptools wheel

# 3. 라이브러리 설치 (중복 방지를 위해 venv 사용 안 함)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 4. 소스 코드 복사 (이때 기존의 venv 폴더가 복사되지 않도록 주의)
COPY . .

# 기존 venv 폴더가 있다면 삭제 (이미지 용량 및 보안 문제 해결)
RUN rm -rf venv app/venv

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080"]