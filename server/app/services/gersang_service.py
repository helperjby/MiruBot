"""
거상 사통팔달(전체외침) 스크래핑 및 데이터 관리 서비스
- 5분마다 geota.co.kr에서 스크래핑
- 상대 시간("5분 전")을 절대 시각("10:32")으로 변환
- nick+content+절대시각으로 신규 판별, 봇 소비까지 누적
"""

import re
import time
from datetime import datetime, timedelta
import requests
from bs4 import BeautifulSoup

SATONG_URL = "https://geota.co.kr/gersang/satongpaldal"
USER_AGENT = (
    "Mozilla/5.0 (Linux; Android 13; SM-G991B) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/120.0.0.0 Mobile Safari/537.36"
)
SCRAPE_INTERVAL = 5 * 60  # 5분

# --- 메모리 상태 ---
_last_scrape_time = 0
_previous_keys = set()       # 직전 스크래핑의 항목 키셋
_pending_new_entries = []     # 봇이 소비할 때까지 누적되는 신규 항목


def _parse_relative_time(time_text: str, now: datetime) -> datetime:
    """
    상대 시간 문자열을 절대 datetime으로 변환합니다.
    '방금 전' → now, 'X분 전' → now - X분, 'X시간 전' → now - X시간
    분 단위로 내림하여 동일 항목의 시각이 스크래핑 간 일관되도록 합니다.
    """
    m = re.search(r"(\d+)분\s*전", time_text)
    if m:
        dt = now - timedelta(minutes=int(m.group(1)))
        return dt.replace(second=0, microsecond=0)

    m = re.search(r"(\d+)시간\s*전", time_text)
    if m:
        dt = now - timedelta(hours=int(m.group(1)))
        return dt.replace(minute=0, second=0, microsecond=0)

    # "방금 전" 또는 알 수 없는 형식
    return now.replace(second=0, microsecond=0)


def _format_time(dt: datetime) -> str:
    """datetime을 'HH:MM' 형식으로 포맷합니다."""
    return dt.strftime("%H:%M")


def _make_key(nick: str, content: str) -> str:
    """항목의 고유 키를 생성합니다. 시간은 상대값이라 비교에서 제외."""
    return f"{nick}|{content}"


def scrape_satong(server_id: str = "7") -> list[dict] | None:
    """geota.co.kr에서 사통팔달 데이터를 스크래핑하고 절대 시각으로 변환합니다."""
    try:
        resp = requests.get(
            SATONG_URL,
            params={"serverId": server_id},
            headers={"User-Agent": USER_AGENT},
            timeout=15,
        )
        if resp.status_code != 200:
            print(f"[gersang] HTTP {resp.status_code}")
            return None

        now = datetime.now()
        soup = BeautifulSoup(resp.text, "html.parser")
        rows = soup.select("div.flex.min-h-10")

        entries = []
        for row in rows:
            nick_el = row.select_one("div.w-44 span.truncate")
            content_el = row.select_one("div.whitespace-break-spaces")
            time_el = row.select_one("div.w-32 div.text-gray-500")

            nick = nick_el.get_text(strip=True) if nick_el else ""
            content = content_el.get_text(strip=True) if content_el else ""
            time_text = time_el.get_text(strip=True) if time_el else ""

            if nick and content:
                abs_dt = _parse_relative_time(time_text, now)
                abs_time = _format_time(abs_dt)
                entries.append({
                    "nick": nick,
                    "content": content,
                    "time": abs_time,
                })

        return entries
    except Exception as e:
        print(f"[gersang] 스크래핑 오류: {e}")
        return None


def run_scrape_cycle(server_id: str = "7"):
    """
    스크래핑 1회 수행: 가져오기 → 이전 결과와 비교 → 신규 항목 누적.
    nick+content+절대시각으로 동일 항목을 판별합니다.
    """
    global _last_scrape_time, _previous_keys, _pending_new_entries

    entries = scrape_satong(server_id)
    if entries is None:
        print("[gersang] 스크래핑 실패, 다음 주기에 재시도")
        return

    _last_scrape_time = int(time.time())
    current_keys = {_make_key(e["nick"], e["content"]) for e in entries}

    if not _previous_keys:
        # 최초 실행: 기준점만 설정, 신규로 쌓지 않음
        _previous_keys = current_keys
        print(f"[gersang] 초기 데이터 설정 완료 ({len(entries)}건)")
        return

    # 이전에 없던 항목 = 신규
    new_keys = current_keys - _previous_keys
    if new_keys:
        new_entries = [
            e for e in entries
            if _make_key(e["nick"], e["content"]) in new_keys
        ]
        _pending_new_entries.extend(new_entries)
        print(f"[gersang] 신규 {len(new_entries)}건 감지 (누적 대기: {len(_pending_new_entries)}건)")
    else:
        print("[gersang] 신규 항목 없음")

    # 현재 결과를 다음 비교 기준으로 저장
    _previous_keys = current_keys


def get_new_entries() -> dict:
    """
    봇이 호출하는 API용: 누적된 신규 항목을 반환하고 비웁니다.
    여러 스크래핑 주기에 걸쳐 쌓인 항목을 한 번에 전달합니다.
    """
    global _pending_new_entries
    entries = _pending_new_entries
    _pending_new_entries = []
    return {
        "new_count": len(entries),
        "entries": entries,
        "last_scrape": _last_scrape_time,
    }
