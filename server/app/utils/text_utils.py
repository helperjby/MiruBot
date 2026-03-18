#text_utils.py
import re

def extract_urls(text: str) -> list:
    """텍스트에서 URL을 추출하는 함수"""
    url_pattern = r'https?://(?:[-\w.]|(?:%[\da-fA-F]{2}))+[^\s]*'
    urls = re.findall(url_pattern, text)
    return urls

def is_translation_request(text: str) -> bool:
    """텍스트가 번역 요청인지 확인하는 함수"""
    # '$번역 ' 키워드로 시작하는지 확인 (공백 포함)
    return text.strip().startswith('$번역 ')
