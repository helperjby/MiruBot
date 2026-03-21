import re
import time
import random
from datetime import datetime, timedelta, timezone
from app.database import get_connection
from app.services.gemini_service import GeminiLLM

_gemini = GeminiLLM()

# 이모티콘 패턴
_EMOTICON_RE = re.compile(
    r"^(이모티콘|사진|동영상|샵검색)(을 보냈습니다\.?|( \d+장을 보냈습니다\.?))$"
)

# URL 패턴
_URL_RE = re.compile(r"https?://\S+")

# 노이즈 패턴 (인물평 전처리용)
_NOISE_RE = re.compile(r"^[ㄱ-ㅎㅋㅎㅉㅠㅜㅡ\s.!?~ㅇㅎ]+$")

# 바 차트 설정
_BAR_MAX_WIDTH = 12  # 최대 블록 수
_BLOCK_CHARS = ["", "▏", "▎", "▍", "▌", "▋", "▊", "▉", "█"]

# 한국 시간대
KST = timezone(timedelta(hours=9))

DAY_NAMES = ["월요일", "화요일", "수요일", "목요일", "금요일", "토요일", "일요일"]


def find_user_hash(channel_id: str, nickname: str) -> dict:
    """닉네임으로 user_hash를 검색합니다. 정확 일치 우선, 부분 일치 차선."""
    conn = get_connection()

    # 해당 채널의 고유 (user_hash, user_name) 쌍 조회
    rows = conn.execute(
        """SELECT DISTINCT user_hash, user_name
           FROM chat_logs
           WHERE channel_id = ? AND user_name IS NOT NULL AND user_hash IS NOT NULL""",
        (channel_id,),
    ).fetchall()

    if not rows:
        return {"found": False, "message": "이 채팅방에 기록된 데이터가 없습니다.", "candidates": None}

    users = [{"user_hash": r["user_hash"], "user_name": r["user_name"]} for r in rows]

    nickname_lower = nickname.lower()
    nickname_nospace = nickname_lower.replace(" ", "")

    def _normalize(name: str) -> str:
        return name.lower().replace(" ", "")

    # 1) 정확 일치 (대소문자·공백 무시)
    for u in users:
        if _normalize(u["user_name"]) == nickname_nospace:
            return {"found": True, "user_hash": u["user_hash"], "user_name": u["user_name"]}

    # 2) 부분 일치 (대소문자·공백 무시)
    partial = [u for u in users if nickname_nospace in _normalize(u["user_name"])]

    if len(partial) == 1:
        return {"found": True, "user_hash": partial[0]["user_hash"], "user_name": partial[0]["user_name"]}

    if len(partial) > 1:
        # 중복 user_name 제거 (같은 이름이 여러 hash로 나올 수 있음)
        seen = set()
        unique = []
        for u in partial:
            if u["user_name"] not in seen:
                seen.add(u["user_name"])
                unique.append(u["user_name"])
        return {
            "found": False,
            "message": f"'{nickname}' 검색 결과가 {len(unique)}명입니다:\n" + "\n".join(f"- {n}" for n in unique),
            "candidates": unique,
        }

    return {"found": False, "message": f"'{nickname}'에 해당하는 유저를 찾을 수 없습니다.", "candidates": None}


def _make_bar(count: int, max_count: int) -> str:
    """count를 max_count 기준으로 정규화하여 블록 바 문자열을 생성합니다."""
    if max_count == 0:
        return "　" * _BAR_MAX_WIDTH

    ratio = count / max_count
    full_blocks = int(ratio * _BAR_MAX_WIDTH)
    remainder = (ratio * _BAR_MAX_WIDTH) - full_blocks
    frac_index = int(remainder * 8)

    bar = "█" * full_blocks
    if frac_index > 0 and full_blocks < _BAR_MAX_WIDTH:
        bar += _BLOCK_CHARS[frac_index]

    # 나머지를 전각 공백으로 채움
    current_len = full_blocks + (1 if frac_index > 0 else 0)
    bar += "　" * (_BAR_MAX_WIDTH - current_len)

    return bar


def calculate_stats(channel_id: str, user_hash: str) -> dict:
    """특정 유저의 전체 채팅 통계를 계산합니다."""
    conn = get_connection()

    # 오늘 시작 시각 (KST 기준)
    now_kst = datetime.now(KST)
    today_start = now_kst.replace(hour=0, minute=0, second=0, microsecond=0)
    today_start_ms = int(today_start.timestamp() * 1000)

    # 1) 일반 통계: SQL에서 분류별 집계 (content 분류는 LIKE로 처리)
    general = conn.execute(
        """SELECT
               COUNT(*) AS total,
               SUM(CASE WHEN content LIKE '%을 보냈습니다%' OR content = '이모티콘' THEN 1 ELSE 0 END) AS emoticon,
               SUM(CASE WHEN content LIKE 'http://%' OR content LIKE 'https://%' THEN 1 ELSE 0 END) AS url,
               SUM(CASE WHEN timestamp >= ? THEN 1 ELSE 0 END) AS today_total,
               SUM(CASE WHEN timestamp >= ? AND (content LIKE '%을 보냈습니다%' OR content = '이모티콘') THEN 1 ELSE 0 END) AS today_emoticon,
               SUM(CASE WHEN timestamp >= ? AND (content LIKE 'http://%' OR content LIKE 'https://%') THEN 1 ELSE 0 END) AS today_url
           FROM chat_logs
           WHERE channel_id = ? AND user_hash = ?""",
        (today_start_ms, today_start_ms, today_start_ms, channel_id, user_hash),
    ).fetchone()

    total = general["total"]
    if total == 0:
        return {"total": 0}

    total_emoticon = general["emoticon"]
    total_url = general["url"]
    total_chat = total - total_emoticon - total_url
    today_total = general["today_total"]
    today_emoticon = general["today_emoticon"]
    today_url = general["today_url"]
    today_chat = today_total - today_emoticon - today_url

    # 2) 시간대별 집계: SQL GROUP BY (KST = UTC+9)
    hourly = [0] * 24
    hourly_rows = conn.execute(
        """SELECT CAST(strftime('%H', timestamp / 1000, 'unixepoch', '+9 hours') AS INTEGER) AS hour,
                  COUNT(*) AS cnt
           FROM chat_logs
           WHERE channel_id = ? AND user_hash = ?
           GROUP BY hour""",
        (channel_id, user_hash),
    ).fetchall()
    for r in hourly_rows:
        hourly[r["hour"]] = r["cnt"]

    # 3) 요일별 집계: SQL GROUP BY (strftime %w: 0=일 → weekday 6, 1=월 → 0, ...)
    daily = [0] * 7
    daily_rows = conn.execute(
        """SELECT CAST(strftime('%w', timestamp / 1000, 'unixepoch', '+9 hours') AS INTEGER) AS dow,
                  COUNT(*) AS cnt
           FROM chat_logs
           WHERE channel_id = ? AND user_hash = ?
           GROUP BY dow""",
        (channel_id, user_hash),
    ).fetchall()
    for r in daily_rows:
        # strftime %w: 0=일, 1=월, ..., 6=토 → Python weekday: 0=월, ..., 6=일
        py_weekday = (r["dow"] - 1) % 7
        daily[py_weekday] = r["cnt"]

    return {
        "total": total,
        "today_chat": today_chat,
        "today_emoticon": today_emoticon,
        "today_url": today_url,
        "total_chat": total_chat,
        "total_emoticon": total_emoticon,
        "total_url": total_url,
        "hourly": hourly,
        "daily": daily,
    }


def _format_stats_text(user_name: str, stats: dict) -> str:
    """통계 데이터를 포맷팅된 텍스트로 변환합니다."""
    lines = []

    # --- 일반 통계 ---
    lines.append("--- 일반 통계 ---")
    lines.append("[오늘 활동량]")
    lines.append(f"- 채팅: {stats['today_chat']}회")
    lines.append(f"- 이모티콘: {stats['today_emoticon']}회")
    lines.append(f"- URL: {stats['today_url']}회")
    lines.append("")
    lines.append("[누적 활동량]")
    lines.append(f"- 채팅: {stats['total_chat']}회")
    lines.append(f"- 이모티콘: {stats['total_emoticon']}회")
    lines.append(f"- URL: {stats['total_url']}회")

    # --- 시간대별 활동 분석 ---
    lines.append("")
    lines.append("--- 시간대별 활동 분석 ---")
    hourly = stats["hourly"]
    max_hourly = max(hourly) if hourly else 0

    for h in range(24):
        count = hourly[h]
        bar = _make_bar(count, max_hourly)
        lines.append(f"{h:02d}시  |  {bar}  ({count}회)")

    # --- 요일별 활동 분석 ---
    lines.append("")
    lines.append("--- 요일별 활동 분석 ---")
    daily = stats["daily"]
    max_daily = max(daily) if daily else 0

    for d in range(7):
        count = daily[d]
        bar = _make_bar(count, max_daily)
        name = DAY_NAMES[d]
        lines.append(f"{name}  |  {bar}  ({count}회)")

    return "\n".join(lines)


def _fetch_personality_messages(channel_id: str, user_hash: str) -> list[str]:
    """인물평을 위한 최근 메시지를 가져와 전처리합니다."""
    conn = get_connection()

    rows = conn.execute(
        """SELECT content
           FROM chat_logs
           WHERE channel_id = ? AND user_hash = ?
           ORDER BY timestamp DESC
           LIMIT 500""",
        (channel_id, user_hash),
    ).fetchall()

    filtered = []
    for r in rows:
        content = r["content"].strip()
        if _EMOTICON_RE.match(content):
            continue
        if _NOISE_RE.match(content):
            continue
        if len(content) < 2:
            continue
        filtered.append(content)
    return filtered


def analyze_personality(user_name: str, filtered: list[str]) -> str:
    """전처리된 채팅 목록을 기반으로 LLM 인물평을 생성합니다."""

    if len(filtered) < 10:
        return "분석할 채팅 데이터가 부족합니다."

    # 최대 300건 샘플링
    if len(filtered) > 300:
        filtered = random.sample(filtered, 300)

    chat_sample = "\n".join(filtered)

    prompt = f"""다음은 '{user_name}'이라는 사람의 채팅 메시지 샘플입니다.

--- 채팅 샘플 ---
{chat_sample}
--- 채팅 샘플 끝 ---

위 채팅 스타일을 분석하여, 이 사람을 유명한 영화/드라마/애니메이션의 가상 캐릭터에 빗대어 재미있게 묘사해주세요.

규칙:
1. 실존 인물이 아닌, 가상의 캐릭터(영화/드라마/애니 등)에 비유할 것
2. 채팅 스타일, 말투, 관심사를 근거로 들 것
3. 3~4문장으로 짧고 재미있게 작성할 것
4. 마크다운 문법(**, *, #, ``` 등)을 절대 사용하지 말 것
5. 순수 텍스트만 사용할 것"""

    try:
        return _gemini.invoke(prompt)
    except Exception as e:
        print(f"[stats_service] 인물평 생성 실패: {e}")
        return "인물평 생성에 실패했습니다."


def get_chat_stats(channel_id: str, nickname: str) -> dict:
    """채팅 통계의 전체 파이프라인을 실행합니다."""

    # 1) 닉네임으로 유저 검색
    search = find_user_hash(channel_id, nickname)
    if not search["found"]:
        return {
            "success": False,
            "message": search["message"],
            "stats_text": None,
            "candidates": search.get("candidates"),
        }

    user_hash = search["user_hash"]
    user_name = search["user_name"]

    # 2) 통계 계산
    stats = calculate_stats(channel_id, user_hash)
    if stats["total"] == 0:
        return {
            "success": False,
            "message": f"'{user_name}'님의 채팅 기록이 없습니다.",
            "stats_text": None,
            "candidates": None,
        }

    # 3) 통계 텍스트 포맷팅
    stats_text = _format_stats_text(user_name, stats)

    # 4) 최종 텍스트 조합
    header = f"{user_name}님의 활동 통계입니다."
    notice = "(2025년 1월 이후 데이터 기준)"
    full_text = f"{header}\n{notice}\n\n{stats_text}"

    return {
        "success": True,
        "message": None,
        "stats_text": full_text,
        "candidates": None,
    }


def get_personality(channel_id: str, nickname: str) -> dict:
    """인물평 전용 파이프라인을 실행합니다."""

    # 1) 닉네임으로 유저 검색
    search = find_user_hash(channel_id, nickname)
    if not search["found"]:
        return {
            "success": False,
            "message": search["message"],
            "personality_text": None,
            "candidates": search.get("candidates"),
        }

    user_hash = search["user_hash"]
    user_name = search["user_name"]

    # 2) 인물평 생성 (메시지 조회 + 전처리 → LLM)
    personality_msgs = _fetch_personality_messages(channel_id, user_hash)
    personality = analyze_personality(user_name, personality_msgs)

    header = f"{user_name}님의 인물평"
    full_text = f"{header}\n\n{personality}"

    return {
        "success": True,
        "message": None,
        "personality_text": full_text,
        "candidates": None,
    }
