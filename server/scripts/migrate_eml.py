"""
chat data.eml → SQLite 마이그레이션 스크립트

사용법:
    # 드라이런 (DB 변경 없음, 파싱 결과만 출력)
    python -m scripts.migrate_eml --dry-run

    # 실제 마이그레이션 실행
    python -m scripts.migrate_eml

    # 롤백 (source='import' 레코드 전체 삭제)
    python -m scripts.migrate_eml --rollback

    # 특정 날짜 이전 데이터만 import (봇 수집 시작 시점 기준)
    python -m scripts.migrate_eml --before 2025-01-01
"""

import re
import sys
import sqlite3
import os
import argparse
from datetime import datetime, timezone, timedelta

# ── 설정 ──────────────────────────────────────────────
CHANNEL_ID = "18301468764762222"
ROOM_NAME = "수다방"
SOURCE_TAG = "import"

EML_PATH = os.path.join(os.path.dirname(__file__), "..", "..", "docs", "chat data.eml")
DB_PATH = os.getenv("CHAT_DB_PATH", os.path.join(os.path.dirname(__file__), "..", "data", "chat.db"))

KST = timezone(timedelta(hours=9))

# ── 정규식 ─────────────────────────────────────────────
# 메시지 라인: "2024년 7월 17일 오후 8:50, 닉네임 : 메시지내용"
_MSG_RE = re.compile(
    r"^(\d{4})년 (\d{1,2})월 (\d{1,2})일 (오전|오후) (\d{1,2}):(\d{2}), (.+?) : (.+)$"
)

# 날짜 구분선: "2024년 7월 17일 오후 8:50" (닉네임 없음)
_DATE_RE = re.compile(
    r"^(\d{4})년 (\d{1,2})월 (\d{1,2})일 (오전|오후) (\d{1,2}):(\d{2})$"
)

# 시스템 메시지 패턴
_SYSTEM_RE = re.compile(
    r"^(\d{4})년.*?, (채팅방 관리자가 메시지를 가렸습니다|.*님이 들어왔습니다|.*님이 나갔습니다)"
)

# user_name 정규화 (summarize_service._clean_name과 동일)
def _clean_name(name: str) -> str:
    return re.sub(r"[^\w가-힣]", "", name) or "알수없음"


# ── 한국어 날짜 → epoch ms 변환 ────────────────────────
def _parse_korean_datetime(year, month, day, ampm, hour, minute):
    """한국어 날짜 문자열 → epoch 밀리초(KST 기준)"""
    year, month, day, hour, minute = int(year), int(month), int(day), int(hour), int(minute)

    # 12시간제 → 24시간제
    if ampm == "오후" and hour != 12:
        hour += 12
    elif ampm == "오전" and hour == 12:
        hour = 0

    dt = datetime(year, month, day, hour, minute, tzinfo=KST)
    return int(dt.timestamp() * 1000)


# ── .eml 파서 ──────────────────────────────────────────
def parse_eml(filepath: str, before_ms: int | None = None) -> list[dict]:
    """
    .eml 파일을 파싱하여 메시지 리스트를 반환합니다.

    멀티라인 메시지 처리:
      타임스탬프 패턴으로 시작하지 않는 줄은 직전 메시지의 content에 이어붙입니다.
    """
    messages = []
    current_msg = None

    # 같은 분(minute) 내 메시지에 순차 초를 배분하기 위한 카운터
    last_minute_ms = None
    second_offset = 0

    with open(filepath, "r", encoding="utf-8-sig") as f:
        for line_no, raw_line in enumerate(f, 1):
            line = raw_line.rstrip("\r\n")

            # 빈 줄 스킵
            if not line.strip():
                continue

            # 헤더 라인 스킵 (첫 2줄)
            if line_no <= 2:
                continue

            # 시스템 메시지 스킵
            if _SYSTEM_RE.match(line):
                current_msg = None
                continue

            # "메시지가 삭제되었습니다." 스킵
            if line.strip() == "메시지가 삭제되었습니다.":
                current_msg = None
                continue

            # 날짜 구분선 스킵
            if _DATE_RE.match(line):
                current_msg = None
                continue

            # 메시지 라인 매칭
            m = _MSG_RE.match(line)
            if m:
                year, month, day, ampm, hour, minute, nickname, content = m.groups()
                base_ms = _parse_korean_datetime(year, month, day, ampm, hour, minute)

                # before 필터
                if before_ms is not None and base_ms >= before_ms:
                    current_msg = None
                    continue

                # 같은 분 내 순차 초 배분
                if base_ms == last_minute_ms:
                    second_offset += 1
                    if second_offset > 59:
                        second_offset = 59  # 분당 최대 60개
                else:
                    last_minute_ms = base_ms
                    second_offset = 0

                timestamp_ms = base_ms + (second_offset * 1000)

                current_msg = {
                    "channel_id": CHANNEL_ID,
                    "room_name": ROOM_NAME,
                    "user_name": nickname,
                    "content": content,
                    "timestamp": timestamp_ms,
                }
                messages.append(current_msg)
            else:
                # 멀티라인 메시지: 직전 메시지에 이어붙이기
                if current_msg is not None:
                    current_msg["content"] += "\n" + line

    return messages


# ── user_hash 매핑 ─────────────────────────────────────
def build_hash_map(conn: sqlite3.Connection) -> dict[str, str]:
    """
    DB에서 (정규화된 user_name → user_hash) 매핑을 생성합니다.
    동일 정규화 이름에 여러 hash가 있으면 가장 최근 것을 사용합니다.
    """
    rows = conn.execute(
        """SELECT user_name, user_hash, MAX(timestamp) as latest
           FROM chat_logs
           WHERE user_hash IS NOT NULL AND user_name IS NOT NULL
           GROUP BY user_name, user_hash
           ORDER BY latest DESC"""
    ).fetchall()

    mapping = {}
    for r in rows:
        clean = _clean_name(r[0])
        if clean not in mapping:
            mapping[clean] = r[1]

    return mapping


def apply_hash_map(messages: list[dict], hash_map: dict[str, str]) -> tuple[int, list[str]]:
    """
    메시지 리스트에 user_hash를 backfill합니다.
    Returns: (매칭 성공 수, 매칭 실패 닉네임 목록)
    """
    matched = 0
    unmatched_names = set()

    for msg in messages:
        clean = _clean_name(msg["user_name"])
        h = hash_map.get(clean)
        if h:
            msg["user_hash"] = h
            matched += 1
        else:
            msg["user_hash"] = None
            unmatched_names.add(msg["user_name"])

    return matched, sorted(unmatched_names)


# ── DB 삽입 ────────────────────────────────────────────
def ensure_source_column(conn: sqlite3.Connection):
    """source 컬럼이 없으면 추가합니다 (기존 DB 호환)."""
    cols = [row[1] for row in conn.execute("PRAGMA table_info(chat_logs)").fetchall()]
    if "source" not in cols:
        conn.execute("ALTER TABLE chat_logs ADD COLUMN source TEXT DEFAULT 'bot'")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_source ON chat_logs(source)")
        conn.commit()
        print("[migrate] source 컬럼 추가 완료")


def insert_messages(conn: sqlite3.Connection, messages: list[dict], batch_size: int = 5000) -> int:
    """메시지를 DB에 배치 삽입합니다."""
    total = 0
    for i in range(0, len(messages), batch_size):
        batch = messages[i:i + batch_size]
        conn.executemany(
            """INSERT INTO chat_logs
               (channel_id, room_name, user_hash, user_name, content, log_id, timestamp, source)
               VALUES (?, ?, ?, ?, ?, NULL, ?, ?)""",
            [(m["channel_id"], m["room_name"], m["user_hash"], m["user_name"],
              m["content"], m["timestamp"], SOURCE_TAG) for m in batch]
        )
        total += len(batch)
        print(f"  [migrate] {total:,} / {len(messages):,} 삽입 완료")
    conn.commit()
    return total


# ── 롤백 ──────────────────────────────────────────────
def rollback(conn: sqlite3.Connection):
    """source='import' 레코드를 전부 삭제합니다."""
    cursor = conn.execute("SELECT COUNT(*) FROM chat_logs WHERE source = ?", (SOURCE_TAG,))
    count = cursor.fetchone()[0]
    if count == 0:
        print("[rollback] 삭제할 import 레코드가 없습니다.")
        return
    print(f"[rollback] {count:,}개의 import 레코드를 삭제합니다...")
    conn.execute("DELETE FROM chat_logs WHERE source = ?", (SOURCE_TAG,))
    conn.commit()
    print("[rollback] 완료")


# ── 메인 ──────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(description="chat data.eml → SQLite 마이그레이션")
    parser.add_argument("--dry-run", action="store_true", help="DB 변경 없이 파싱 결과만 출력")
    parser.add_argument("--rollback", action="store_true", help="import 레코드 전체 삭제")
    parser.add_argument("--before", type=str, help="이 날짜 이전 데이터만 import (YYYY-MM-DD)")
    parser.add_argument("--db", type=str, default=DB_PATH, help="DB 파일 경로")
    parser.add_argument("--eml", type=str, default=EML_PATH, help=".eml 파일 경로")
    args = parser.parse_args()

    # before 날짜 → epoch ms
    before_ms = None
    if args.before:
        before_dt = datetime.strptime(args.before, "%Y-%m-%d").replace(tzinfo=KST)
        before_ms = int(before_dt.timestamp() * 1000)
        print(f"[migrate] {args.before} 이전 데이터만 import합니다.")

    # DB 연결 (dry-run이 아닐 때만 필수)
    conn = None
    if not args.dry_run:
        conn = sqlite3.connect(args.db)
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA synchronous=NORMAL")

        # 롤백 모드
        if args.rollback:
            rollback(conn)
            conn.close()
            return

        # source 컬럼 보장
        ensure_source_column(conn)

    # 1) .eml 파싱
    print(f"[migrate] .eml 파싱 중... ({args.eml})")
    messages = parse_eml(args.eml, before_ms)
    print(f"[migrate] 파싱 완료: {len(messages):,}개 메시지")

    if not messages:
        print("[migrate] import할 메시지가 없습니다.")
        if conn:
            conn.close()
        return

    # 날짜 범위 출력
    first_ts = datetime.fromtimestamp(messages[0]["timestamp"] / 1000, tz=KST)
    last_ts = datetime.fromtimestamp(messages[-1]["timestamp"] / 1000, tz=KST)
    print(f"[migrate] 날짜 범위: {first_ts:%Y-%m-%d %H:%M} ~ {last_ts:%Y-%m-%d %H:%M}")

    # 2) user_hash backfill
    if conn:
        hash_map = build_hash_map(conn)
        print(f"[migrate] DB에서 {len(hash_map)}개의 user_name → user_hash 매핑 로드")
        matched, unmatched = apply_hash_map(messages, hash_map)
        print(f"[migrate] user_hash 매칭: {matched:,}개 성공, {len(messages) - matched:,}개 실패")
        if unmatched:
            print(f"[migrate] 매칭 실패 닉네임 ({len(unmatched)}명):")
            for name in unmatched:
                print(f"  - {name} (정규화: {_clean_name(name)})")

    # 3) 통계 요약
    nicknames = set(m["user_name"] for m in messages)
    print(f"[migrate] 고유 닉네임 수: {len(nicknames)}")

    # dry-run이면 여기서 종료
    if args.dry_run:
        print("\n[dry-run] DB 변경 없이 종료합니다.")
        print("\n── 처음 5개 메시지 ──")
        for m in messages[:5]:
            ts = datetime.fromtimestamp(m["timestamp"] / 1000, tz=KST)
            print(f"  [{ts:%Y-%m-%d %H:%M:%S}] {m['user_name']}: {m['content'][:50]}")
        print("\n── 마지막 5개 메시지 ──")
        for m in messages[-5:]:
            ts = datetime.fromtimestamp(m["timestamp"] / 1000, tz=KST)
            print(f"  [{ts:%Y-%m-%d %H:%M:%S}] {m['user_name']}: {m['content'][:50]}")
        return

    # 4) 기존 import 데이터 확인
    existing = conn.execute(
        "SELECT COUNT(*) FROM chat_logs WHERE source = ?", (SOURCE_TAG,)
    ).fetchone()[0]
    if existing > 0:
        print(f"[migrate] 경고: 이미 {existing:,}개의 import 레코드가 존재합니다.")
        answer = input("  계속 진행하시겠습니까? (y/N): ").strip().lower()
        if answer != "y":
            print("[migrate] 취소됨")
            conn.close()
            return

    # 5) DB 삽입
    print(f"[migrate] {len(messages):,}개 메시지 삽입 시작...")
    inserted = insert_messages(conn, messages)
    print(f"[migrate] 완료! {inserted:,}개 레코드 삽입됨")

    # 6) 검증
    total = conn.execute("SELECT COUNT(*) FROM chat_logs").fetchone()[0]
    import_count = conn.execute(
        "SELECT COUNT(*) FROM chat_logs WHERE source = ?", (SOURCE_TAG,)
    ).fetchone()[0]
    print(f"[migrate] DB 총 레코드: {total:,} (bot: {total - import_count:,}, import: {import_count:,})")

    conn.close()


if __name__ == "__main__":
    main()
