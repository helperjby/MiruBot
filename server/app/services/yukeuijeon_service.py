"""
거상 육의전(마켓플레이스) 스크래핑 및 알람 서비스
- 초기: 3일치 대량 수집 (배치 단위, rate limiting)
- 이후: 5분마다 최신 5페이지 스크래핑
- DB 저장, 3일 만료 자동 정리, 부분일치 검색, 채팅방 단위 알람
"""

import re
import time
from datetime import datetime, timedelta, timezone
import requests
from bs4 import BeautifulSoup

KST = timezone(timedelta(hours=9))

from app.database import get_connection

YUKEUIJEON_URL = "https://geota.co.kr/gersang/yukeuijeon"
USER_AGENT = (
    "Mozilla/5.0 (Linux; Android 13; SM-G991B) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/120.0.0.0 Mobile Safari/537.36"
)
SCRAPE_INTERVAL = 5 * 60  # 5분
REGULAR_MAX_PAGES = 5
INITIAL_MAX_PAGES = 800   # 3일치 추정
BATCH_SIZE = 50           # 초기 스크래핑 배치 크기
BATCH_DELAY = 30          # 배치 간 대기 시간(초)

# --- 알림 버퍼 ---
_pending_notifications = []
_initial_scrape_done = False


# ──────────────────────── 파싱 유틸 ────────────────────────

def _parse_relative_time(time_text: str, now: datetime) -> datetime:
    """상대 시간 → 절대 datetime 변환. 'X일 전'까지 지원."""
    m = re.search(r"(\d+)분\s*전", time_text)
    if m:
        dt = now - timedelta(minutes=int(m.group(1)))
        return dt.replace(second=0, microsecond=0)

    m = re.search(r"(\d+)시간\s*전", time_text)
    if m:
        dt = now - timedelta(hours=int(m.group(1)))
        return dt.replace(minute=0, second=0, microsecond=0)

    m = re.search(r"(\d+)일\s*전", time_text)
    if m:
        dt = now - timedelta(days=int(m.group(1)))
        return dt.replace(hour=0, minute=0, second=0, microsecond=0)

    # "방금 전" 또는 알 수 없는 형식
    return now.replace(second=0, microsecond=0)


def _parse_price(price_text: str) -> int:
    """'1,888,887원' → 1888887"""
    digits = re.sub(r"[^\d]", "", price_text)
    return int(digits) if digits else 0


def _remove_spaces(text: str) -> str:
    """띄어쓰기 제거."""
    return text.replace(" ", "")


# ──────────────────────── 스크래핑 ────────────────────────

def scrape_page(server_id: str = "7", page: int = 1, category: str = "item") -> list[dict] | None:
    """육의전 단일 페이지 스크래핑. category: 'item' 또는 'unit'."""
    try:
        resp = requests.get(
            YUKEUIJEON_URL,
            params={
                "serverId": server_id,
                "page": page,
                "orderDirection": "desc",
                "category": category,
                "searchType": "archived",
            },
            headers={"User-Agent": USER_AGENT},
            timeout=15,
        )
        if resp.status_code != 200:
            print(f"[yukeuijeon] HTTP {resp.status_code} (page {page})")
            return None

        now = datetime.now(KST)
        soup = BeautifulSoup(resp.text, "html.parser")
        rows = soup.select("div.group.flex.min-h-14")

        entries = []
        for row in rows:
            cols = row.select("div.flex-1")
            if len(cols) < 5:
                continue

            name_raw = cols[0].get_text(strip=True)
            qty_text = cols[1].get_text(strip=True)
            price_text = cols[2].get_text(strip=True)
            seller = cols[3].get_text(strip=True)
            time_text = cols[4].get_text(strip=True)

            if not name_raw or not seller:
                continue

            abs_dt = _parse_relative_time(time_text, now)
            entries.append({
                "category": category,
                "item_name": _remove_spaces(name_raw),
                "item_name_raw": name_raw,
                "quantity": int(re.sub(r"[^\d]", "", qty_text) or "0"),
                "price": _parse_price(price_text),
                "seller": seller,
                "registered_at": abs_dt.strftime("%Y-%m-%d %H:%M"),
            })

        return entries
    except Exception as e:
        print(f"[yukeuijeon] 스크래핑 오류 (page {page}): {e}")
        return None


def scrape_pages(server_id: str = "7", max_pages: int = 5, category: str = "item") -> list[dict]:
    """여러 페이지 순회. 빈 페이지 시 조기 종료."""
    all_entries = []
    for page in range(1, max_pages + 1):
        entries = scrape_page(server_id, page, category)
        if entries is None or len(entries) == 0:
            break
        all_entries.extend(entries)
    return all_entries


def scrape_pages_batched(server_id: str = "7", max_pages: int = 800, category: str = "item") -> list[dict]:
    """배치 단위 스크래핑 (초기 대량 수집용). 배치 간 대기로 서버 부하 분산."""
    all_entries = []
    total_batches = (max_pages + BATCH_SIZE - 1) // BATCH_SIZE
    current_page = 1

    for batch_num in range(1, total_batches + 1):
        batch_end = min(current_page + BATCH_SIZE - 1, max_pages)
        batch_entries = []
        empty_page = False

        for page in range(current_page, batch_end + 1):
            entries = scrape_page(server_id, page, category)
            if entries is None or len(entries) == 0:
                empty_page = True
                break
            batch_entries.extend(entries)

        if batch_entries:
            inserted, _ = save_items(batch_entries)
            print(
                f"[yukeuijeon] 초기 스크래핑({category}) 배치 {batch_num}/{total_batches} "
                f"({batch_end}페이지 완료, {inserted}건 저장)"
            )

        if empty_page:
            print(f"[yukeuijeon] 초기 스크래핑({category}) 완료 (page {current_page + len(batch_entries) // 10}에서 종료)")
            break

        current_page = batch_end + 1
        if batch_num < total_batches:
            time.sleep(BATCH_DELAY)

    return all_entries  # 초기 스크래핑은 알람 체크 불필요


# ──────────────────────── DB 관리 ────────────────────────

def save_items(items: list[dict]) -> tuple[int, list[dict]]:
    """아이템 저장. INSERT OR IGNORE로 중복 방지. (삽입건수, 신규아이템) 반환."""
    if not items:
        return 0, []

    conn = get_connection()
    new_items = []
    inserted = 0

    for item in items:
        cursor = conn.execute(
            """INSERT OR IGNORE INTO yukeuijeon_items
               (category, item_name, item_name_raw, quantity, price, seller, registered_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (
                item.get("category", "item"),
                item["item_name"],
                item["item_name_raw"],
                item["quantity"],
                item["price"],
                item["seller"],
                item["registered_at"],
            ),
        )
        if cursor.rowcount > 0:
            inserted += 1
            new_items.append(item)

    conn.commit()
    return inserted, new_items


def cleanup_old_items():
    """3일 이상 지난 데이터 삭제."""
    conn = get_connection()
    cursor = conn.execute(
        "DELETE FROM yukeuijeon_items WHERE scraped_at < datetime('now','localtime','-3 days')"
    )
    conn.commit()
    if cursor.rowcount > 0:
        print(f"[yukeuijeon] 만료 데이터 {cursor.rowcount}건 삭제")


def search_items(keyword: str) -> list[dict]:
    """부분일치 검색. 키워드 띄어쓰기 제거 후 LIKE 매칭."""
    conn = get_connection()
    clean_keyword = _remove_spaces(keyword)
    rows = conn.execute(
        """SELECT category, item_name_raw, quantity, price, seller, registered_at
           FROM yukeuijeon_items
           WHERE item_name LIKE ?
           ORDER BY scraped_at DESC
           LIMIT 20""",
        (f"%{clean_keyword}%",),
    ).fetchall()

    return [
        {
            "category": row["category"],
            "item_name": row["item_name_raw"],
            "quantity": row["quantity"],
            "price": row["price"],
            "seller": row["seller"],
            "registered_at": row["registered_at"],
        }
        for row in rows
    ]


# ──────────────────────── 알람 관리 ────────────────────────

def register_alarm(channel_id: str, keyword: str) -> bool:
    """알람 등록. 이미 존재하면 False."""
    conn = get_connection()
    keyword_clean = _remove_spaces(keyword)
    cursor = conn.execute(
        """INSERT OR IGNORE INTO yukeuijeon_alarms
           (channel_id, keyword, keyword_raw) VALUES (?, ?, ?)""",
        (channel_id, keyword_clean, keyword),
    )
    conn.commit()
    return cursor.rowcount > 0


def register_alarms(channel_id: str, keywords: list[str]) -> dict:
    """여러 알람 일괄 등록. 각 키워드별 등록 결과 반환."""
    registered = []
    duplicated = []
    for kw in keywords:
        kw = kw.strip()
        if not kw:
            continue
        if register_alarm(channel_id, kw):
            registered.append(kw)
        else:
            duplicated.append(kw)
    return {"registered": registered, "duplicated": duplicated}


def unregister_alarm(channel_id: str, keyword: str) -> bool:
    """알람 해제. 삭제 성공 시 True."""
    conn = get_connection()
    keyword_clean = _remove_spaces(keyword)
    cursor = conn.execute(
        "DELETE FROM yukeuijeon_alarms WHERE channel_id = ? AND keyword = ?",
        (channel_id, keyword_clean),
    )
    conn.commit()
    return cursor.rowcount > 0


def list_alarms(channel_id: str) -> list[dict]:
    """채팅방의 알람 목록 조회."""
    conn = get_connection()
    rows = conn.execute(
        "SELECT keyword_raw, created_at FROM yukeuijeon_alarms WHERE channel_id = ?",
        (channel_id,),
    ).fetchall()
    return [{"keyword": row["keyword_raw"], "created_at": row["created_at"]} for row in rows]


def check_alarms(new_items: list[dict]) -> list[dict]:
    """신규 아이템과 전체 알람 키워드 매칭. 매칭 결과를 알림 목록으로 반환."""
    if not new_items:
        return []

    conn = get_connection()
    alarms = conn.execute(
        "SELECT DISTINCT channel_id, keyword, keyword_raw FROM yukeuijeon_alarms"
    ).fetchall()

    if not alarms:
        return []

    notifications = []
    for alarm in alarms:
        keyword = alarm["keyword"]
        matched = [
            item for item in new_items
            if keyword in item["item_name"]
        ]
        if matched:
            notifications.append({
                "channel_id": alarm["channel_id"],
                "keyword_raw": alarm["keyword_raw"],
                "matched_items": matched,
            })

    return notifications


# ──────────────────────── 알림 버퍼 ────────────────────────

def get_pending_notifications() -> dict:
    """봇이 호출: 누적 알림 반환 후 비움."""
    global _pending_notifications
    result = _pending_notifications
    _pending_notifications = []
    return {
        "count": len(result),
        "notifications": result,
    }


# ──────────────────────── 메인 사이클 ────────────────────────

CATEGORIES = ["item", "unit"]


def run_yukeuijeon_cycle(server_id: str = "7", max_pages: int = REGULAR_MAX_PAGES):
    """스크래핑 1회 수행: 정리 → 카테고리별 스크래핑 → 저장 → 알람 체크."""
    global _pending_notifications, _initial_scrape_done

    cleanup_old_items()

    # 초기 대량 스크래핑
    if not _initial_scrape_done and max_pages > REGULAR_MAX_PAGES:
        for cat in CATEGORIES:
            print(f"[yukeuijeon] 초기 대량 스크래핑({cat}) 시작 ({max_pages}페이지, 배치 {BATCH_SIZE}페이지씩)")
            scrape_pages_batched(server_id, max_pages, cat)
            print(f"[yukeuijeon] 초기 대량 스크래핑({cat}) 완료")
        _initial_scrape_done = True
        return

    # 일반 주기적 스크래핑 (카테고리별)
    all_new_items = []
    for cat in CATEGORIES:
        entries = scrape_pages(server_id, max_pages, cat)
        if not entries:
            continue
        inserted, new_items = save_items(entries)
        print(f"[yukeuijeon] 스크래핑({cat}) 완료: {len(entries)}건 조회, {inserted}건 신규")
        all_new_items.extend(new_items)

    if all_new_items:
        notifications = check_alarms(all_new_items)
        if notifications:
            _pending_notifications.extend(notifications)
            total_matched = sum(len(n["matched_items"]) for n in notifications)
            print(f"[yukeuijeon] 알람 매칭: {len(notifications)}건 알림, {total_matched}건 아이템")
