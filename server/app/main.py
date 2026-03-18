import requests
import os
import random
from fastapi import FastAPI, HTTPException, Request
from fastapi.params import Query
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles # 중복 제거 후 추가
from app.models import MessageRequest, SummaryResponse, TranslateRequest, TranslationResponse
from app.services.web_service import (
    process_url_content, 
    get_exchange_rate_info,
    get_combined_stock_info
)
from app.services.translator_service import is_korean_text, translate_text
from app.utils.text_utils import extract_urls
from app.services.game_service import process_key_fortune
# --- ▲▲▲ 라이브러리 임포트 ▲▲▲ ---

app = FastAPI(title="URL 요약 및 번역 API", description="카카오톡 메신저봇R과 연동되는 API")

# --- ▼▼▼ Static "메뉴판" 마운트 ▼▼▼ ---
# 웹 경로 "/static"을 Docker 내부 경로 "/app/static_files"와 연결
app.mount(
    "/static",
    StaticFiles(directory="/app/static_files"), # Docker 내부 경로
    name="static"
)
# --- ▲▲▲ Static "메뉴판" 마운트 ▲▲▲ ---


@app.get("/")
def hello():
    return {"message": "URL 요약 및 번역 API가 실행 중입니다!"}


# --- ▼▼▼ [수정] 랜덤 이미지 API (카테고리 지원) ▼▼▼ ---
CATEGORY_MAP = {
    "말티즈": "maltese",
    "추억": "memories",   
    "윤호": "baby",       # crontab의 baby 폴더
    "미루": "miru",       # crontab의 miru 폴더
}

@app.get("/images/random/{category}")
async def get_random_image_by_category(
    category: str, 
    request: Request,
    count: int = Query(1, ge=1, le=8) 
):
    """
    한글 카테고리 요청 시 영문 디렉토리로 자동 변환하여 이미지를 반환합니다.
    (지원: 말티즈, 추억, 윤호, 미루)
    """
    print(f"[main.py] Received command: /images/random/{category}?count={count}")

    # 2. 한글 카테고리를 실제 영어 폴더명으로 변환
    real_folder_name = CATEGORY_MAP.get(category, category)
    
    # 3. 변환된 폴더명으로 경로 설정
    image_dir = f"/app/static_files/{real_folder_name}"
    print(f"[main.py] Target Directory: {image_dir}")

    try:
        # 4. 디렉토리 존재 여부 체크
        if not os.path.exists(image_dir):
             raise FileNotFoundError(f"Directory not found: {image_dir}")

        # 5. 파일 목록 읽기 (숨김 파일 제외)
        files = [f for f in os.listdir(image_dir) 
                 if os.path.isfile(os.path.join(image_dir, f)) and not f.startswith('.')]
        
        if not files:
            print(f"[main.py] ERROR: No files found in {image_dir}")
            raise HTTPException(status_code=404, detail=f"'{category}' 폴더에 이미지가 없습니다.")

        # 6. 요청 수량 조정 및 랜덤 추출
        if count > len(files):
            count = len(files)
        
        random_files = random.sample(files, count)
        
        # 7. URL 생성
        base_url = str(request.base_url).rstrip('/')
        image_urls = [
            f"{base_url}/static/{real_folder_name}/{file_name}" 
            for file_name in random_files
        ]
        
        return JSONResponse(content={"urls": image_urls})

    except FileNotFoundError:
        # 폴더가 없을 때 구체적인 힌트 제공
        print(f"[main.py] ERROR: Directory not found: {image_dir}")
        msg = f"서버에 '{real_folder_name}' 폴더가 없습니다. (crontab 동기화 확인 필요)"
        raise HTTPException(status_code=500, detail=msg)
    except Exception as e:
        print(f"[main.py] ERROR: {str(e)}")
        raise HTTPException(status_code=500, detail=f"서버 오류: {str(e)}")
# --- ▲▲▲ [수정] 랜덤 이미지 API (모든 카테고리 매핑 적용) ▲▲▲ ---
@app.get("/images/search/{category}")
async def search_image_smart(
    category: str, 
    request: Request,
    query: str = Query(..., min_length=1, description="검색어")
):
    image_dir = f"/app/static_files/{category}"
    
    if not os.path.exists(image_dir):
        return JSONResponse(content={"found": False, "message": "카테고리 폴더가 없습니다."}, status_code=404)

    try:
        # 1. 모든 파일 목록 가져오기 (확장자 제외한 이름 매핑 준비)
        all_files = [f for f in os.listdir(image_dir) 
                     if os.path.isfile(os.path.join(image_dir, f)) and not f.startswith('.')]
        
        if not all_files:
             return JSONResponse(content={"found": False, "message": "이미지가 하나도 없습니다."}, status_code=200)

        query_lower = query.lower()
        
        # --- [로직 1] 완전 일치 우선 검색 (확장자 제외하고 이름만 비교) ---
        # 예: "su" 검색 시 "su.jpg"가 있으면 즉시 반환
        exact_match = None
        for f in all_files:
            file_name_only = os.path.splitext(f)[0] # 확장자 제거 (su.jpg -> su)
            if file_name_only.lower() == query_lower:
                exact_match = f
                break
        
        if exact_match:
            image_url = f"{str(request.base_url).rstrip('/')}/static/{category}/{exact_match}"
            return JSONResponse(content={
                "found": True,
                "mode": "exact", # 로직 디버깅용
                "count": 1,
                "urls": [image_url],
                "file_names": [exact_match]
            })

        # --- [로직 2] 부분 일치 검색 ---
        # 예: "su" 검색 -> "suuuu.jpg", "super.jpg" 등 검색
        partial_matches = [f for f in all_files if query_lower in f.lower()]
        
        count = len(partial_matches)

        # A. 결과가 없을 때
        if count == 0:
            return JSONResponse(content={
                "found": False, 
                "count": 0, 
                "message": f"'{query}'에 대한 검색 결과가 없습니다."
            })

        # B. 결과가 1개일 때 -> 성공
        if count == 1:
            target_file = partial_matches[0]
            image_url = f"{str(request.base_url).rstrip('/')}/static/{category}/{target_file}"
            return JSONResponse(content={
                "found": True,
                "mode": "partial_single",
                "count": 1,
                "urls": [image_url],
                "file_names": [target_file]
            })

        # C. 결과가 여러 개일 때 -> 중복 리스트 반환 (이미지 URL 안 보냄)
        # 봇에서 "다음 중 누구를 찾으시나요?" 라고 물어볼 수 있게 파일명 리스트만 반환
        return JSONResponse(content={
            "found": True, # 찾긴 찾았음
            "mode": "partial_multiple", # 하지만 너무 많음
            "count": count,
            "urls": [], # URL 비움 (봇이 전송하지 않도록)
            "file_names": partial_matches, # 매칭된 이름 목록
            "message": f"총 {count}개의 결과가 있습니다."
        })

    except Exception as e:
        print(f"Search Error: {e}")
        return JSONResponse(content={"found": False, "message": "서버 내부 오류"}, status_code=500)

@app.post("/process-url", response_model=SummaryResponse)
def process_url(request: MessageRequest):
    
    command = request.text.strip()
    
    # 1. 명령어 감지 (!환율)
    if command == "!환율":
        print("[main.py] 1. Received command: !환율")
        print("[main.py] 2. Calling get_exchange_rate_info...")
        info = get_exchange_rate_info()
        print("[main.py] 3. Returning exchange rate info.")
        return SummaryResponse(headline="현재 환율 정보", gemini_summary=info)

    # 2. !증시 명령어 감지
    elif command == "!증시":
        print("[main.py] 1. Received command: !증시")
        print("[main.py] 2. Calling get_combined_stock_info...")
        info = get_combined_stock_info()
        print("[main.py] 3. Returning combined stock info.")
        return SummaryResponse(headline="주요 증시 현황", gemini_summary=info)

    # 3. 기존 URL 요약 로직
    else:
        print(f"[main.py] 1. Received request: {request.text}")
        try:
            urls = extract_urls(request.text)
            if not urls:
                print("[main.py] 2. No valid URL found.")
                raise HTTPException(status_code=400, detail="입력된 텍스트에서 유효한 URL을 찾을 수 없습니다.")
            
            url = urls[0]
            print(f"[main.py] 2. Extracted URL: {url}")
            
            if "localhost" in url or "127.0.0.1" in url:
                print("[main.py] 3. Localhost URL blocked.")
                raise HTTPException(status_code=400, detail="내부 IP 또는 로컬 주소는 사용할 수 없습니다.")
            
            print("[main.py] 3. Calling process_url_content...")
            headline, summary = process_url_content(url)
            
            if headline is None or summary is None:
                print("[main.py] 4. process_url_content returned None. (Not found or failed)")
                raise HTTPException(status_code=404, detail="요약할 수 없는 URL이거나 처리 중 오류가 발생했습니다.")

            print("[main.py] 4. Summary generated successfully.")
            return SummaryResponse(headline=headline, gemini_summary=summary)
        
        except HTTPException as he:
            raise he
        except Exception as e:
            print(f"URL 처리 중 심각한 오류 발생: {str(e)}")
            raise HTTPException(status_code=500, detail=f"서버 내부 오류 발생: {str(e)}")

@app.post("/translate", response_model=TranslationResponse)
def handle_translation(request: MessageRequest):
    try:
        target_lang = "en" if is_korean_text(request.text) else "ko"
        translated = translate_text(request.text, target_lang)
        return {"translation": translated}
    except Exception as e:
        print(f"번역 처리 오류: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))
    
# 봇에서 호출하는 랭킹 검색 API
@app.get("/api/search/user/{nickname}")
async def proxy_ranking_search(nickname: str):
    target_url = f"https://mobingi.ngrok.io/api/search/user/{nickname}"
    try:
        response = requests.get(target_url, timeout=10)
        response.raise_for_status()
        return response.json()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Ranking API Error: {str(e)}")

# 봇에서 호출하는 상세 정보 API
@app.get("/api2/detail/{server}/{nickname}")
async def proxy_ranking_detail(server: str, nickname: str):
    target_url = f"https://mobingi.ngrok.io/api2/detail/{server}/{nickname}"
    try:
        response = requests.get(target_url, timeout=10)
        response.raise_for_status()
        return response.json()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Ranking Detail API Error: {str(e)}")
    
# [추가] 열쇠 운세 엔드포인트 (15분 쿨타임 적용)
@app.get("/game/fortune")
async def get_key_fortune(user_id: str):
    """
    마비노기 모바일 열쇠 운세
    Query Param: user_id (유저 닉네임)
    """
    try:
        result = process_key_fortune(user_id)
        return JSONResponse(content=result)
    except Exception as e:
        print(f"[main.py] Fortune Error: {str(e)}")
        # 에러 발생 시 500 에러 대신 200 OK로 보내되, 에러 메시지를 담아서 보냄 (봇이 죽지 않게)
        return JSONResponse(content={
            "status": "error",
            "message": f"서버 오류가 발생했습니다: {str(e)}"
        })