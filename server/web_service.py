import os
from dotenv import load_dotenv
from app.services.gemini_service import GeminiLLM 
from googleapiclient.discovery import build 
from youtube_transcript_api import YouTubeTranscriptApi 
from youtube_transcript_api.formatters import TextFormatter 
from urllib.parse import urlparse, parse_qs
import requests
import xml.etree.ElementTree as ET
from bs4 import BeautifulSoup
import re # 정규표현식 모듈
#import cloudscraper

# .env 파일 로드
load_dotenv()

# 제외 도메인 리스트
EXCLUDED_DOMAINS = (
    "x.com", 
    "teamblind.com", 
    "facebook.com", 
    "instagram.com", 
    "twitter.com", 
    "threads.net", 
    "nexon.com", 
    "smartstore.naver.com", 
    "brand.naver.com"
)

# 최소 콘텐츠 길이 (이것보다 짧으면 요약하지 않음)
MIN_CONTENT_LENGTH = 100
# 웹 요청 타임아웃 (초)
WEB_REQUEST_TIMEOUT = 15

# --- [추가] 로그 보안 마스킹 함수 ---
def sanitize_log(text: str) -> str:
    """
    로그에 찍힐 텍스트에서 Gemini API Key(AIza...)를 '***HIDDEN***'으로 가립니다.
    """
    if not text:
        return ""
    # key=AIza... 패턴을 찾아서 치환
    return re.sub(r'key=AIza[a-zA-Z0-9_-]+', 'key=***HIDDEN***', str(text))

def extract_youtube_video_id(url: str) -> str:
    """
    다양한 형태의 YouTube URL에서 11자리 Video ID를 추출합니다.
    (단, shorts 링크는 의도적으로 제외합니다.)
    """
    # 1. 쇼츠 링크 명시적 차단 (봇이 무시하도록 None 반환)
    if "/shorts/" in url.lower():
        print("[web_service.py] Shorts URL detected. Ignoring.")
        return None
    
    # 2. 정규식에서 shorts 부분을 제거 (live, embed, watch 등 일반 영상만 허용)
    match = re.search(r"(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?|live)\/|.*[?&]v=)|youtu\.be\/)([a-zA-Z0-9_-]{11})", url)
    
    if match:
        return match.group(1)
        
    return None

def get_domain_type(url: str) -> str:
    parsed = urlparse(url)
    domain = parsed.netloc.lower()

    if any(excluded_domain in domain for excluded_domain in EXCLUDED_DOMAINS):
        return "excluded"
    
    if "arxiv.org" in domain:
        return "arxiv"
    if "dcinside" in domain:
        return "dc"
    if "fmkorea" in domain:
        return "fm"
    if "youtube" in domain or "youtu.be" in domain:
        return "youtube"
    if any(x in domain for x in ["coupang","11st","gmarket","auction","amazon"]):
        return "product"
    if url.lower().endswith(".pdf"):
        return "pdf"

    if "naver" in domain:
        if any(x in url for x in ["news.naver.com", "n.news.naver.com", "m.news.naver.com"]):
            return "naver_news"
        if "cafe.naver.com" in domain or "m.cafe.naver.com" in domain:
            return "naver_cafe"
        return "naver_other"

    return "generic"

def fetch_arxiv_abstract(url: str) -> str:
    paper_id = url.rstrip(".pdf").split("/")[-1]
    api_url = f"http://export.arxiv.org/api/query?id_list={paper_id}"
    resp = requests.get(api_url, timeout=10)
    resp.raise_for_status()
    
    root = ET.fromstring(resp.text)
    summary_el = root.find(".//{http://www.w3.org/2005/Atom}summary")
    
    if summary_el is None:
        raise ValueError("arXiv abstract를 찾을 수 없습니다.")
        
    raw_abstract = summary_el.text.strip()
    if not raw_abstract:
        raise ValueError("arXiv abstract가 비어있습니다.")
        
    # 💡 1. 전처리 (Token Diet)
    # arXiv 특유의 불필요한 줄바꿈과 다중 공백을 하나의 띄어쓰기로 깔끔하게 압축합니다.
    content = re.sub(r'\s+', ' ', raw_abstract).strip()

    return content


def fetch_youtube_transcript(url: str) -> str:
    """
    youtube-transcript-api를 사용해 스크립트를 가져옵니다.
    (전처리 및 황금 비율 샘플링을 통해 비용과 요약 품질의 밸런스를 맞춥니다.)
    """
    video_id = extract_youtube_video_id(url)
    
    if not video_id:
        raise ValueError("잘못된 YouTube URL이거나 지원하지 않는 형식(Shorts 등)입니다. (transcript)")

    ytt_api = YouTubeTranscriptApi() 
    transcript_list = ytt_api.list(video_id)
    transcript_obj = transcript_list.find_transcript(['ko', 'en'])
    fetched = transcript_obj.fetch()
    
    formatter = TextFormatter()
    raw_content = formatter.format_transcript(fetched)
    
    if not raw_content.strip():
        raise ValueError("스크립트 내용은 있으나 비어있습니다.")

    # 1. 전처리 (Token Diet)
    content = re.sub(r'\s+', ' ', raw_content).strip()

    # 2. 황금 비율 샘플링 (비용과 품질의 타협점)
    # 30,000자로 넉넉하게 늘려 약 5~6원 정도의 비용이 발생하도록 세팅합니다.
    MAX_LEN = 30000 
    
    if len(content) > MAX_LEN:
        total_len = len(content)
        
        # 앞(도입) 20% / 중간(핵심) 60% / 뒤(결론) 20% 비율로 추출
        intro_len = int(MAX_LEN * 0.2)
        mid_len = int(MAX_LEN * 0.6)
        outro_len = int(MAX_LEN * 0.2)
        
        part1 = content[:intro_len]
        part2 = content[(total_len // 2) - (mid_len // 2) : (total_len // 2) + (mid_len // 2)]
        part3 = content[-outro_len:]
        
        content = f"{part1}\n\n...[영상 중반부 생략]...\n\n{part2}\n\n...[영상 후반부 생략]...\n\n{part3}"
        
    return f"영상 스크립트:\n{content}"


def fetch_youtube_metadata(url: str) -> str:
    """
    YouTube Data API v3를 사용해 영상의 제목과 설명을 가져옵니다.
    """
    api_key = os.getenv("YOUTUBE_API_KEY")
    if not api_key:
        raise ValueError("YOUTUBE_API_KEY 환경 변수가 설정되지 않았습니다.")

    video_id = extract_youtube_video_id(url)
    
    if not video_id:
        raise ValueError("잘못된 YouTube URL이거나 지원하지 않는 형식(Shorts 등)입니다. (metadata)")

    try:
        youtube = build('youtube', 'v3', developerKey=api_key)
        
        request = youtube.videos().list(
            part="snippet", 
            id=video_id
        )
        response = request.execute()

        if not response.get("items"):
            raise ValueError(f"비디오 ID '{video_id}'에 대한 정보를 찾을 수 없습니다.")

        snippet = response["items"][0]["snippet"]
        title = snippet.get("title", "제목 없음")
        description = snippet.get("description", "설명 없음")

        return f"영상 제목: {title}\n\n영상 설명:\n{description}"

    except Exception as e:
        # 기존에 만드신 sanitize_log 함수 활용
        print(f"YouTube Data API 오류: {sanitize_log(e)}")
        raise e


# --- [수정] !환율 기능 (에러 발생 시 None 반환) ---
def get_exchange_rate_info() -> str:
    url = "https://finance.naver.com/marketindex/?tabSel=exchange"
    print(f"[web_service.py] Fetching exchange rates...")
    
    try:
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
        }
        response = requests.get(url, headers=headers, timeout=WEB_REQUEST_TIMEOUT)
        response.raise_for_status()

        soup = BeautifulSoup(response.text, "html.parser")
        main_content = soup.select_one("div.market_data")
        
        if not main_content:
            print("[web_service.py] Exchange rate scraping failed: 'div.market_data' not found.")
            return None  # [수정] 에러 메시지 대신 None 반환

        content = main_content.get_text(separator="\n", strip=True)

        if not content.strip():
            return None # [수정] None 반환

        llm = GeminiLLM()
        prompt = generate_exchange_rate_prompt(content)
        
        print("[web_service.py] Calling Gemini LLM for exchange rate extraction...")
        raw_output = llm._call(prompt)
        
        print("[web_service.py] Exchange rate info processed successfully.")
        return raw_output

    except Exception as e:
        # [수정] 로그 보안 처리 및 None 반환
        print(f"[web_service.py] 환율 스크래핑 실패: {sanitize_log(e)}")
        return None 


def generate_exchange_rate_prompt(content: str) -> str:
    return f"""
당신은 금융 HTML 텍스트에서 데이터를 추출하는 전문가입니다.
아래 제공된 HTML 텍스트에서 '미국', '일본', '중국', '유럽연합'의 환율과 '업데이트 시간'을 찾아, 요청된 <template> 형식으로만 응답하세요.

- '일본' 환율은 (100엔)을 꼭 포함해야 합니다.
- markdown 문법, 지시문, 템플릿 외의 설명은 절대 포함하지 마세요.

🇺🇸 USD: {{환율}} 원
🇯🇵 JPY: {{환율}} 원(100엔)
🇨🇳 CNY: {{환율}} 원
🇪🇺 EUR: {{환율}} 원
업데이트: {{HH:MM:SS}}
(출처) 네이버 금융

--- HTML 텍스트 시작 ---
{content}
--- HTML 텍스트 끝 ---
"""

def generate_combined_stock_prompt(content: str) -> str:
    return f"""
당신은 금융 HTML 텍스트에서 증시 정보를 정확히 추출하는 봇입니다.
아래 <HTML 텍스트>를 읽고, <template>의 각 항목을 {{정보}} 형식으로 **정확하게** 채워주세요.
- markdown 문법을 사용하지 마세요.
- 지시문을 답변에 포함하지 마세요.
- 템플릿 이외의 내용은 절대 응답하지 마세요.
- 코스피, 코스닥은 등락률(%)를 포함해주세요.
- 등락 정보는 텍스트에서 찾은 "상승", "하락", "상한", "하한", "보합" 텍스트 그대로 넣어주세요.
- 인기 검색 종목은 1위부터 5위까지만 추출하세요.

<template>
주요 증시 현황입니다.
(코스피) {{지수}} {{등락률%}}
(코스닥) {{지수}} {{등락률%}}

[해외지수]
(다우산업) {{지수}} {{등락텍스트}}
(나스닥) {{지수}} {{등락텍스트}}
(홍콩H) {{지수}} {{등락텍스트}}
(상해종합) {{지수}} {{등락텍스트}}
(니케이) {{지수}} {{등락텍스트}}

[인기 검색 종목]
1. {{종목명}} {{가격}} {{등락텍스트}}
2. {{종목명}} {{가격}} {{등락텍스트}}
3. {{종목명}} {{가격}} {{등락텍스트}}
4. {{종목명}} {{가격}} {{등락텍스트}}
5. {{종목명}} {{가격}} {{등락텍스트}}

(출처) 네이버 금융
</template>

(예시:
주요 증시 현황입니다.
(코스피) 3,930.06 -3.35%
(코스닥) 872.61 -3.35%
... (이하 생략) ...
)

<HTML 텍스트>
{content}
"""

# [수정] !증시 함수 (에러 발생 시 None 반환)
def get_combined_stock_info() -> str:
    url = "https://finance.naver.com/sise/"
    print(f"[web_service.py] Fetching combined stock data from: {url}")
    
    try:
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
        }
        response = requests.get(url, headers=headers, timeout=WEB_REQUEST_TIMEOUT)
        response.raise_for_status()

        soup = BeautifulSoup(response.text, "html.parser")
        main_content = soup.select_one("div#contentarea") 
        
        if not main_content:
            print(f"[web_service.py] Error: div#contentarea not found.")
            return None # [수정] 에러 메시지 대신 None

        content = main_content.get_text(separator="\n", strip=True)

        llm = GeminiLLM()
        prompt = generate_combined_stock_prompt(content)
        print("[web_service.py] Calling Gemini LLM for combined stock extraction...")
        raw_output = llm._call(prompt)

        processed_output = (
            raw_output.replace("(코스피)", "🇰🇷 코스피")
            .replace("(코스닥)", "🇰🇷 코스닥")
            .replace("(다우산업)", "🇺🇸 다우산업")
            .replace("(나스닥)", "🇺🇸 나스닥")
            .replace("(홍콩H)", "🇭🇰 홍콩H")
            .replace("(상해종합)", "🇨🇳 상해종합")
            .replace("(니케이)", "🇯🇵 니케이")
            .replace("상승", "📈")
            .replace("하락", "📉")
            .replace("상한가", "📈📈📈")
            .replace("하한가", "📉📉📉")
            .replace("보합", "➖")
        )
        
        if "(출처)" not in processed_output:
            processed_output += "\n(출처) 네이버 금융"

        return processed_output

    except Exception as e:
        # [수정] 로그 보안 처리 및 None 반환
        print(f"[web_service.py] Combined stock scraping failed: {sanitize_log(e)}")
        return None 


# --- 프롬프트 생성 함수들 시작 ---

def generate_dc_prompt(url: str, content: str) -> str:
    return f"""
아래 DCInside 게시글 내용을 읽고, 아래 <template> 양식에 맞춰 응답하세요:
- markdown 문법을 사용하지 마세요.
- 요약 내용 외에 인사말이나 지시문은 포함하지 마세요.
- 출력 결과에 괄호 `()`, `{{}}`, `[]` 기호는 절대 출력하지 말고 내용만 자연스럽게 작성하세요.
- 원본 내용의 분량과 중요도에 따라 요약의 깊이를 유연하게 조절하세요. 내용이 길고 상세하다면 핵심 정보가 누락되지 않도록 상세하게 여러 줄로 작성해도 좋습니다.

<template>
👉 {{글 제목 또는 핵심 요약 문장}}
📌 {{글의 주제 또는 분위기 요약}}
✅ {{주요 주장, 댓글 반응 등 상세한 핵심 정보 정리}}
🚀 {{재미요소, 반전, 감정적 표현 등 포함 - 없다면 이 줄은 생략}}

게시글 내용:
{content}
"""

def generate_fmkorea_prompt(url: str, content: str) -> str:
    return f"""
아래 FMKorea 게시글을 읽고, 아래 <template> 양식에 맞춰 응답하세요:
- markdown 문법을 사용하지 마세요.
- 요약 내용 외에 인사말이나 지시문은 포함하지 마세요.
- 출력 결과에 괄호 `()`, `{{}}`, `[]` 기호는 절대 출력하지 말고 내용만 자연스럽게 작성하세요.
- 원본 내용의 분량과 중요도에 따라 요약의 깊이를 유연하게 조절하세요. 내용이 길고 상세하다면 핵심 정보가 누락되지 않도록 상세하게 여러 줄로 작성해도 좋습니다.

<template>
👉 {{글 제목 또는 핵심 요약 문장}}
📌 {{글의 주제나 분위기 요약}}
✅ {{주요 주장, 반응, 이슈 등 상세한 핵심 정보 정리}}
🚀 {{유머, 반전, 커뮤니티 반응 등 포함 - 없다면 이 줄은 생략}}

게시글 내용:
{content}
"""

def generate_youtube_prompt_metadata(url: str, content: str) -> str:
    return f"""
아래 유튜브 영상의 '제목'과 '설명란' 내용을 참고하여, 아래 <template> 양식에 맞춰 응답하세요:
- markdown 문법을 사용하지 마세요.
- 요약 내용 외에 인사말이나 지시문은 포함하지 마세요.
- 출력 결과에 괄호 `()`, `{{}}`, `[]` 기호는 절대 출력하지 말고 내용만 자연스럽게 작성하세요.
- 원본 내용의 분량과 중요도에 따라 요약의 깊이를 유연하게 조절하세요. 내용이 길고 상세하다면 핵심 정보가 누락되지 않도록 상세하게 여러 줄로 작성해도 좋습니다.

<template>
👉 {{영상 제목 또는 핵심 주제}}
📌 {{영상의 전반적인 흐름과 주요 내용 요약}}
✅ {{강조된 내용, 설명, 세부 정보 등 상세한 핵심 정보 정리}}
🚀 {{유익한 팁, 흥미 요소, 추천 포인트 등 - 없다면 이 줄은 생략}}

영상 관련 내용:
{content}
"""

def generate_youtube_prompt_script(url: str, content: str) -> str:
    return f"""
아래 유튜브 영상의 '스크립트' 내용을 참고하여, 아래 <template> 양식에 맞춰 응답하세요:
- markdown 문법을 사용하지 마세요.
- 요약 내용 외에 인사말이나 지시문은 포함하지 마세요.
- 출력 결과에 괄호 `()`, `{{}}`, `[]` 기호는 절대 출력하지 말고 내용만 자연스럽게 작성하세요.
- 원본 내용의 분량과 중요도에 따라 요약의 깊이를 유연하게 조절하세요. 영상 스크립트가 길고 다루는 주제가 많다면, 핵심 정보가 누락되지 않도록 상세하게 여러 줄로 작성해도 좋습니다.

<template>
👉 {{영상 제목 또는 핵심 주제}}
📌 {{영상의 전반적인 흐름과 주요 내용 요약}}
✅ {{강조된 내용, 설명, 세부 정보 등 상세한 핵심 정보 정리}}
🚀 {{유익한 팁, 흥미 요소, 추천 포인트 등 - 없다면 이 줄은 생략}}

영상 관련 내용:
{content}
"""

def generate_naver_prompt(url: str, content: str) -> str:
    return f"""
아래 뉴스 또는 네이버 콘텐츠를 읽고, 아래 <template> 양식에 맞춰 응답하세요:
- markdown 문법을 사용하지 마세요.
- 요약 내용 외에 인사말이나 지시문은 포함하지 마세요.
- 출력 결과에 괄호 `()`, `{{}}`, `[]` 기호는 절대 출력하지 말고 내용만 자연스럽게 작성하세요.
- 원본 내용의 분량과 중요도에 따라 요약의 깊이를 유연하게 조절하세요. 내용이 길고 상세하다면 핵심 정보가 누락되지 않도록 상세하게 여러 줄로 작성해도 좋습니다.

<template>
👉 {{기사 제목 또는 핵심 문장 요약}}
📌 {{핵심 사실 또는 사건 개요}}
✅ {{배경, 맥락 설명, 주요 데이터 등 상세한 핵심 정보 정리}}
🚀 {{영향, 전망, 이슈 포인트 등 - 없다면 이 줄은 생략}}

본문 내용:
{content}
"""

def generate_product_prompt(url: str, content: str) -> str:
    return f"""
다음 상품 설명을 읽고, 소비자에게 도움이 될 수 있도록 아래 <template> 양식에 맞춰 응답하세요:
- markdown 문법을 사용하지 마세요.
- 요약 내용 외에 인사말이나 지시문은 포함하지 마세요.
- 출력 결과에 괄호 `()`, `{{}}`, `[]` 기호는 절대 출력하지 말고 내용만 자연스럽게 작성하세요.
- 원본 내용의 분량과 중요도에 따라 요약의 깊이를 유연하게 조절하세요. 상품 설명이 길고 스펙이 다양하다면, 구매자에게 필요한 정보가 누락되지 않도록 상세하게 여러 줄로 작성해도 좋습니다.

<template>
👉 {{상품명 또는 특징 요약 문장}}
📌 {{상품의 용도, 주요 장점 요약}}
✅ {{가격, 브랜드, 사양, 세부 기능 등 상세한 핵심 정보 정리}}
🚀 {{추천 대상, 장점, 유의사항 등 - 없다면 이 줄은 생략}}

상품 설명 내용:
{content}
"""

def generate_generic_prompt(url: str, content: str) -> str:
    return f"""
다음 웹페이지 내용을 읽고, 아래 <template> 양식에 맞춰 응답하세요:
- markdown 문법을 사용하지 마세요.
- 요약 내용 외에 인사말이나 지시문은 포함하지 마세요.
- 출력 결과에 괄호 `()`, `{{}}`, `[]` 기호는 절대 출력하지 말고 내용만 자연스럽게 작성하세요.
- 원본 내용의 분량과 중요도에 따라 요약의 깊이를 유연하게 조절하세요. 내용이 길고 상세하다면 핵심 정보가 누락되지 않도록 상세하게 여러 줄로 작성해도 좋습니다.

<template>
👉 {{페이지 제목 또는 핵심 문장}}
📌 {{전체 내용의 개요 요약}}
✅ {{핵심 정보, 주요 기능, 세부 설명 등 상세한 정보 정리}}
🚀 {{추가 특징, 흥미로운 포인트 등 - 없다면 이 줄은 생략}}

웹페이지 내용:
{content}
"""

def generate_arxiv_prompt(url: str, content: str) -> str:
    return f"""
아래 arXiv 논문의 초록을 읽고, 아래 <template> 양식에 맞춰 응답하세요:
- markdown 문법을 사용하지 마세요.
- 요약 내용 외에 인사말이나 지시문은 포함하지 마세요.
- 출력 결과에 괄호 `()`, `{{}}`, `[]` 기호는 절대 출력하지 말고 내용만 자연스럽게 작성하세요.
- 초록의 분량과 연구의 깊이에 따라 요약의 길이를 유연하게 조절하세요. 방법론이나 결과가 복잡하다면 상세하게 여러 줄로 작성해도 좋습니다.

<template>
👉 {{논문 제목 또는 핵심 연구 주제}}
📌 {{연구의 목적 및 배경 요약}}
✅ {{사용된 방법론, 주요 데이터, 연구 결과 등 상세한 핵심 정보 정리}}
🚀 {{연구의 의의, 한계점, 향후 연구 방향 등 - 없다면 이 줄은 생략}}

논문 초록:
{content}
"""
# --- 프롬프트 생성 함수들 끝 ---

def get_prompt_func(domain: str):
    domain_map = {
        "dc": generate_dc_prompt,
        "fm": generate_fmkorea_prompt,
        "product": generate_product_prompt,
        "naver_cafe": generate_naver_prompt,
        "naver_news": generate_naver_prompt,
        "naver_other": generate_naver_prompt,
        "generic": generate_generic_prompt,
        "arxiv": generate_arxiv_prompt,
    }
    return domain_map.get(domain, generate_generic_prompt)


def process_url_content(url: str):
    print(f"[web_service.py] 4. Received URL: {url}")
    try:
        domain = get_domain_type(url)
        print(f"[web_service.py] 5. Determined domain: {domain}")

        if domain == "excluded":
            print("[web_service.py] 6. Domain is excluded.")
            return None, None

        if domain == "naver_cafe":
            print("[web_service.py] 6. Naver Cafe is excluded.")
            return None, None

        content = ""
        prompt_func = None
        
        if domain == "youtube":
            try:
                print("[web_service.py] 6. (1st Try) Fetching YouTube transcript...")
                content = fetch_youtube_transcript(url)
                prompt_func = generate_youtube_prompt_script
                print("[web_service.py] 7. YouTube: Transcript API Success (High Quality).")
            except Exception as e1:
                # [수정] 로그 마스킹
                print(f"[web_service.py] Transcript API failed: {sanitize_log(e1)}. Falling back to Data API...")
                try:
                    print("[web_service.py] 6. (2nd Try) Fetching YouTube metadata...")
                    content = fetch_youtube_metadata(url)
                    prompt_func = generate_youtube_prompt_metadata
                    print("[web_service.py] 7. YouTube: Data API Success (Standard Quality).")
                except Exception as e2:
                    # [수정] 로그 마스킹
                    print(f"[web_service.py] Data API also failed: {sanitize_log(e2)}")
                    return None, None
                
        elif domain == "arxiv":
            print("[web_service.py] 6. Fetching arXiv abstract...")
            try:
                content = fetch_arxiv_abstract(url)
                prompt_func = get_prompt_func(domain) 
            except Exception as e:
                print(f"[web_service.py] arXiv abstract failed: {sanitize_log(e)}")
                return None, None
                
        elif domain == "pdf":
            if "arxiv.org/pdf" in url:
                print("[web_service.py] 6. Fetching arXiv abstract for PDF link...")
                try:
                    content = fetch_arxiv_abstract(url)
                    prompt_func = get_prompt_func("arxiv")
                except Exception as e:
                    print(f"[web_service.py] arXiv abstract (for PDF) failed: {sanitize_log(e)}")
                    return None, None
            else:
                print("[web_service.py] 6. Generic PDF is excluded.")
                return None, None
        else:
            # 기타 웹사이트
            print("[web_service.py] 6. Fetching generic web content...")
            try:
                headers = {
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
                }
                response = requests.get(url, headers=headers, timeout=WEB_REQUEST_TIMEOUT)
                response.raise_for_status()

                soup = BeautifulSoup(response.text, "html.parser")
                
                for script_or_style in soup(["script", "style"]):
                    script_or_style.decompose()
                
                content = soup.get_text(separator="\n", strip=True)
                prompt_func = get_prompt_func(domain) 
                
            except requests.exceptions.Timeout:
                print(f"Web requests 타임아웃 ({WEB_REQUEST_TIMEOUT}초 초과): {url}")
                return None, None
            except Exception as e:
                print(f"requests/BeautifulSoup 로드 실패: {sanitize_log(e)}")
                return None, None
                
            if not content:
                print("[web_service.py] 7. No content found from web page.")
                return None, None
            
            if len(content.strip()) < MIN_CONTENT_LENGTH:
                print("[web_service.py] 7. Content is too short.")
                return None, None
        
        if not content.strip():
             print("[web_service.py] 7. Content is empty after fetching.")
             return None, None

        print(f"[web_service.py] 7. Content prepared (first 100 chars): {content[:100]}")

        # --- 요약 ---
        print("[web_service.py] 8. Initializing GeminiLLM...")
        llm = GeminiLLM()
        
        if not prompt_func:
            print(f"[web_service.py] 8. No prompt function found for domain {domain}.")
            return None, None

        prompt = prompt_func(url, content)
        print("[web_service.py] 9. Calling Gemini LLM...")
        raw = llm._call(prompt)

        # 요약 결과 후처리
        lines = raw.splitlines()
        while lines and not lines[0].strip():
            lines.pop(0)
        while lines and not lines[-1].strip():
            lines.pop()
        summary = "\n".join(lines)

        if not summary or not summary.strip():
            print("[web_service.py] 10. LLM returned empty summary.")
            return None, None

        print("[web_service.py] 11. Summary generated successfully.")
        headline = f"{url} 에 대한 사이트 요약입니다:"
        return headline, summary

    except Exception as e:
        # [수정] 핵심: 에러 발생 시 로그는 남기되(마스킹), 반환값은 None으로 설정하여 봇이 침묵하게 함
        print(f"process_url_content에서 예외 발생: {sanitize_log(e)}")
        return None, None