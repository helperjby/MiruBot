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
    """닉네임으로 user_hash를 검색합니다. 정확 일치 우선, 부분 일치 차선.
    같은 user_hash의 닉네임 변경 이력을 하나의 유저로 그룹핑합니다."""
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

    # user_hash별로 사용했던 닉네임 목록을 그룹핑
    hash_names: dict[str, list[str]] = {}
    for r in rows:
        h = r["user_hash"]
        hash_names.setdefault(h, []).append(r["user_name"])

    # user_hash별 최신 닉네임 조회 (가장 최근 메시지의 닉네임)
    latest_rows = conn.execute(
        """SELECT user_hash, user_name
           FROM chat_logs
           WHERE channel_id = ? AND user_name IS NOT NULL AND user_hash IS NOT NULL
             AND (user_hash, timestamp) IN (
                 SELECT user_hash, MAX(timestamp)
                 FROM chat_logs
                 WHERE channel_id = ? AND user_name IS NOT NULL AND user_hash IS NOT NULL
                 GROUP BY user_hash
             )""",
        (channel_id, channel_id),
    ).fetchall()
    latest_name: dict[str, str] = {r["user_hash"]: r["user_name"] for r in latest_rows}

    def _normalize(name: str) -> str:
        return name.lower().replace(" ", "")

    nickname_nospace = _normalize(nickname)

    def _make_result(h: str) -> dict:
        display_name = latest_name.get(h, hash_names[h][0])
        return {"found": True, "user_hash": h, "user_name": display_name}

    # 1) 정확 일치 — 현재 또는 과거 닉네임 중 하나라도 매칭
    for h, names in hash_names.items():
        if any(_normalize(n) == nickname_nospace for n in names):
            return _make_result(h)

    # 2) 부분 일치 — 현재 또는 과거 닉네임 중 하나라도 매칭
    partial_hashes = [
        h for h, names in hash_names.items()
        if any(nickname_nospace in _normalize(n) for n in names)
    ]

    if len(partial_hashes) == 1:
        return _make_result(partial_hashes[0])

    if len(partial_hashes) > 1:
        # 각 hash의 최신 닉네임으로 후보 표시
        unique_names = []
        seen = set()
        for h in partial_hashes:
            name = latest_name.get(h, hash_names[h][0])
            if name not in seen:
                seen.add(name)
                unique_names.append(name)
        return {
            "found": False,
            "message": f"'{nickname}' 검색 결과가 {len(unique_names)}명입니다:\n" + "\n".join(f"- {n}" for n in unique_names),
            "candidates": unique_names,
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


def _fetch_user_features(channel_id: str, user_hash: str) -> str | None:
    """유저의 등록된 특징(features)을 조회합니다.
    ref:<user_hash> 패턴이 있으면 해당 유저의 features와 닉네임을 인라인으로 치환합니다."""
    conn = get_connection()
    row = conn.execute(
        "SELECT features FROM user_features WHERE channel_id = ? AND user_hash = ?",
        (channel_id, user_hash),
    ).fetchone()
    if not row:
        return None

    features = row["features"]

    # ref:<hash> 참조 해석 (최대 3단계 깊이 방지)
    ref_re = re.compile(r"ref:([a-f0-9]+)")
    resolved = set()

    for _ in range(3):
        matches = ref_re.findall(features)
        if not matches:
            break
        for ref_hash in matches:
            if ref_hash in resolved:
                continue
            resolved.add(ref_hash)

            # 참조 대상의 닉네임 조회
            name_row = conn.execute(
                """SELECT user_name FROM chat_logs
                   WHERE channel_id = ? AND user_hash = ?
                   ORDER BY timestamp DESC LIMIT 1""",
                (channel_id, ref_hash),
            ).fetchone()
            ref_name = name_row["user_name"] if name_row else ref_hash

            # 참조 대상의 features 조회
            ref_feat_row = conn.execute(
                "SELECT features FROM user_features WHERE channel_id = ? AND user_hash = ?",
                (channel_id, ref_hash),
            ).fetchone()
            ref_info = f"{ref_name}"
            if ref_feat_row:
                ref_info += f"({ref_feat_row['features']})"

            features = features.replace(f"ref:{ref_hash}", ref_info)

    return features


def _fetch_age_messages(channel_id: str, user_hash: str) -> tuple[list[str], dict]:
    """나이 추정을 위한 메시지를 시간대별 층화 샘플링 + 대화쌍으로 가져옵니다.
    Returns: (formatted_pairs, activity_profile)"""
    conn = get_connection()

    # 시간대별·요일별 층화 샘플링: 4시간대 × 2(평일/주말) = 8 버킷
    # 시간대: 새벽(1-6), 오전(7-12), 오후(13-18), 저녁(19-0)
    time_slots = [
        ("새벽", 1, 6),
        ("오전", 7, 12),
        ("오후", 13, 18),
        ("저녁", 19, 23),  # 19-23 + 0시는 별도 처리
    ]
    per_bucket = 65  # 8 버킷 × 65 = 최대 520건 (예산 5원)

    all_pairs = []
    activity_counts = {}  # 시간대별 활동 비율 계산용

    for slot_name, h_start, h_end in time_slots:
        for is_weekend in [0, 1]:
            if is_weekend:
                dow_cond = "IN (0, 6)"
                bucket_key = f"{slot_name}_주말"
            else:
                dow_cond = "BETWEEN 1 AND 5"
                bucket_key = f"{slot_name}_평일"

            # 저녁(19-23)은 0시도 포함
            if slot_name == "저녁":
                hour_cond = "(CAST(strftime('%H', timestamp/1000, 'unixepoch', '+9 hours') AS INTEGER) BETWEEN 19 AND 23 OR CAST(strftime('%H', timestamp/1000, 'unixepoch', '+9 hours') AS INTEGER) = 0)"
                params = (channel_id, user_hash, per_bucket * 3)
            else:
                hour_cond = "CAST(strftime('%H', timestamp/1000, 'unixepoch', '+9 hours') AS INTEGER) BETWEEN ? AND ?"
                params = (channel_id, user_hash, h_start, h_end, per_bucket * 3)

            # 대상자 메시지 + timestamp 가져오기
            rows = conn.execute(
                f"""SELECT content, timestamp FROM chat_logs
                    WHERE channel_id = ? AND user_hash = ?
                      AND {hour_cond}
                      AND CAST(strftime('%w', timestamp/1000, 'unixepoch', '+9 hours') AS INTEGER)
                          {dow_cond}
                    ORDER BY RANDOM()
                    LIMIT ?""",
                params,
            ).fetchall()

            bucket_total = len(rows)
            activity_counts[bucket_key] = bucket_total

            # 1차: 텍스트 필터링
            candidates = []
            for r in rows:
                content = r["content"].strip()
                if _EMOTICON_RE.match(content):
                    continue
                if _NOISE_RE.match(content):
                    continue
                if _URL_RE.match(content):
                    continue
                if len(content.split()) < 2 and len(content) < 5:
                    continue
                candidates.append((content, r["timestamp"]))

            # 2차: 버킷 제한 후 대화쌍 조회 (DB 쿼리 최소화)
            if len(candidates) > per_bucket:
                candidates = random.sample(candidates, per_bucket)

            filtered = []
            for content, ts in candidates:
                prev_row = conn.execute(
                    """SELECT content, user_name FROM chat_logs
                       WHERE channel_id = ? AND timestamp < ?
                       ORDER BY timestamp DESC LIMIT 1""",
                    (channel_id, ts),
                ).fetchone()

                if prev_row and prev_row["user_name"] and not _EMOTICON_RE.match(prev_row["content"].strip()):
                    pair = f"{prev_row['user_name']}: {prev_row['content'].strip()}\n> {content}"
                else:
                    pair = content
                filtered.append(pair)

            all_pairs.extend(filtered)

    # 활동 시간대 프로필 계산
    total_activity = sum(activity_counts.values()) or 1
    activity_profile = {}
    for slot_name, _, _ in time_slots:
        weekday = activity_counts.get(f"{slot_name}_평일", 0)
        weekend = activity_counts.get(f"{slot_name}_주말", 0)
        activity_profile[slot_name] = round((weekday + weekend) / total_activity * 100)

    weekend_total = sum(v for k, v in activity_counts.items() if "주말" in k)
    activity_profile["주말_비율"] = round(weekend_total / total_activity * 100)

    return all_pairs, activity_profile


def estimate_age(user_name: str, filtered: list[str], activity_profile: dict,
                 features: str | None = None) -> str:
    """전처리된 채팅 목록과 활동 프로필을 기반으로 LLM 나이 추정을 수행합니다."""

    if len(filtered) < 20:
        return "분석할 채팅 데이터가 부족합니다. (최소 20건 이상 필요)"

    # 최대 500건으로 제한 (예산 5원)
    if len(filtered) > 500:
        filtered = random.sample(filtered, 500)

    chat_sample = "\n".join(filtered)

    # 활동 시간대 메타데이터 텍스트
    activity_text = (
        f"활동 시간대: 새벽(1-6시) {activity_profile.get('새벽', 0)}% / "
        f"오전(7-12시) {activity_profile.get('오전', 0)}% / "
        f"오후(13-18시) {activity_profile.get('오후', 0)}% / "
        f"저녁(19-0시) {activity_profile.get('저녁', 0)}%\n"
        f"주말 활동 비율: {activity_profile.get('주말_비율', 0)}%"
    )

    # features 힌트 블록
    features_block = ""
    if features:
        features_block = f"\n--- 알려진 정보 ---\n{features}\n"

    prompt = f"""다음은 '{user_name}'이라는 사람의 채팅 메시지 샘플과 활동 패턴입니다.

--- 활동 패턴 ---
{activity_text}
{features_block}
--- 채팅 샘플 ---
아래에서 ">" 로 시작하는 줄이 대상자의 메시지이고, 그 위 줄은 직전에 다른 사람이 보낸 메시지입니다.

{chat_sample}
--- 채팅 샘플 끝 ---

위 데이터를 종합적으로 분석하여 이 사람의 나이(또는 연령대)를 추정해주세요.

분석 기준:
1. 말투와 은어/신조어 사용 패턴 (세대별 언어 특성)
2. 문화적 레퍼런스 (언급하는 게임, 드라마, 음악, 유행어 등)
3. 활동 시간대 (학생/직장인/프리랜서 등 생활 패턴)
4. 관심사와 화제 (취업, 육아, 학교, 직장 등)
5. 대화 맥락에서 드러나는 사회적 위치와 생활상

주의: 닉네임으로 나이를 판단하지 마세요. 반드시 채팅 내용과 행동 패턴만으로 판단하세요.

출력 형식 (마크다운 문법 절대 사용 금지, 순수 텍스트만):
추정 나이: XX~YY세 (추정 중심값 ±2세 범위, 예: 35세로 추정되면 33~37세)

[판단 근거]
- (근거 1)
- (근거 2)
- (근거 3)

판단 근거는 정확히 3줄로 작성하세요. 각 줄은 1문장으로 핵심만 간결하게 요약하세요."""

    try:
        return _gemini.invoke(prompt, temperature=0.2)
    except Exception as e:
        print(f"[stats_service] 나이 추정 실패: {e}")
        return "나이 추정에 실패했습니다."


def get_age_estimate(channel_id: str, nickname: str) -> dict:
    """나이 추정 전용 파이프라인을 실행합니다."""

    # 1) 닉네임으로 유저 검색
    search = find_user_hash(channel_id, nickname)
    if not search["found"]:
        return {
            "success": False,
            "message": search["message"],
            "age_text": None,
            "candidates": search.get("candidates"),
        }

    user_hash = search["user_hash"]
    user_name = search["user_name"]

    # 2) 유저 features 조회
    features = _fetch_user_features(channel_id, user_hash)

    # 3) 나이 추정 (층화 샘플링 + 대화쌍 + 전처리 → LLM)
    age_msgs, activity_profile = _fetch_age_messages(channel_id, user_hash)
    age_result = estimate_age(user_name, age_msgs, activity_profile, features)

    header = f"{user_name}님의 나이 추정"
    full_text = f"{header}\n\n{age_result}"

    return {
        "success": True,
        "message": None,
        "age_text": full_text,
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
