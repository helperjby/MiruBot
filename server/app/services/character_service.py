# app/services/character_service.py

from fastapi import APIRouter, HTTPException
import glob
import os

# 1. 봇 스크립트의 FASTAPI_BASE_URL과 일치해야 함
FASTAPI_BASE_URL = "http://192.168.0.133:8080"
IMAGE_DIR = "./images" # 1단계에서 만든 폴더 경로

router = APIRouter()

@router.get("/character/{name}")
def get_character_image(name: str):
    
    # (kakaobot v2.txt의 FileStream.read 한계를 Python glob으로 해결) 
    search_path = os.path.join(IMAGE_DIR, f"*{name}*.jpg")
    matches_files = glob.glob(search_path)
    
    matches_names = [os.path.basename(f).replace('.jpg', '') for f in matches_files]

    if len(matches_files) == 1:
        # 3. 1개 일치: 이미지 URL 반환
        file_name = os.path.basename(matches_files[0])
        return {
            "image_url": f"{FASTAPI_BASE_URL}/static/images/{file_name}"
        }
    elif len(matches_files) > 1:
        # 4. 2개 이상 일치: 목록 반환
        return {
            "matches": matches_names
        }
    else:
        # 5. 0개 일치: 오류 반환
        return {
            "error": "Not Found"
        }