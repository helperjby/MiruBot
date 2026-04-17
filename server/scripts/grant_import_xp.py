#!/usr/bin/env python3
"""
import 채팅 데이터 기반 XP 부여 스크립트

comm_db JSON의 중복 해시 키를 병합하고,
chat.db에서 source='import'인 메시지를 집계하여 XP를 부여합니다.
1 메시지 = 1 XP (보너스 XP 제외)

처리 순서:
  1단계: 64자 해시 키를 12자 키로 병합 (totalXp 합산 후 레벨 재계산)
  2단계: import 채팅 데이터 기반 XP 부여

사용법:
    # 드라이런 (기본, JSON 변경 없음)
    python -m scripts.grant_import_xp --comm-dir /path/to/bot

    # 실제 실행
    python -m scripts.grant_import_xp --comm-dir /path/to/bot --execute
"""

import argparse
import glob
import json
import os
import sqlite3
import sys

# ── 설정 ──────────────────────────────────────────────
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DEFAULT_DB_PATH = os.getenv(
    "CHAT_DB_PATH",
    os.path.join(SCRIPT_DIR, "..", "data", "chat.db"),
)
SOURCE_TAG = "import"
HASH_LENGTH = 12


# ── 레벨 시스템 (채팅봇.js와 동일) ───────────────────
def get_xp_for_next_level(level: int) -> int:
    return (level * 200) + 50


def recalculate_level(xp: int, level: int) -> tuple[int, int]:
    """레벨업 로직 적용 후 (new_xp, new_level) 반환."""
    while xp >= get_xp_for_next_level(level):
        xp -= get_xp_for_next_level(level)
        level += 1
    return xp, level


# ── DB 조회 ───────────────────────────────────────────
def query_import_counts(conn: sqlite3.Connection) -> dict:
    """
    source='import' 메시지를 채널/유저별로 집계.
    Returns: {channel_id: {user_hash: {"count": int, "latest_name": str}}}
    """
    # 메시지 수 집계
    rows = conn.execute("""
        SELECT channel_id, user_hash, COUNT(*) as msg_count
        FROM chat_logs
        WHERE source = ? AND user_hash IS NOT NULL
        GROUP BY channel_id, user_hash
    """, (SOURCE_TAG,)).fetchall()

    # 최신 닉네임 조회
    name_rows = conn.execute("""
        SELECT channel_id, user_hash, user_name
        FROM (
            SELECT channel_id, user_hash, user_name,
                   ROW_NUMBER() OVER (
                       PARTITION BY channel_id, user_hash
                       ORDER BY timestamp DESC
                   ) as rn
            FROM chat_logs
            WHERE source = ? AND user_hash IS NOT NULL
        ) WHERE rn = 1
    """, (SOURCE_TAG,)).fetchall()

    # 닉네임 맵 구성
    name_map = {}
    for ch, uh, name in name_rows:
        name_map.setdefault(ch, {})[uh] = name

    # 결과 구성
    result = {}
    for ch, uh, count in rows:
        result.setdefault(ch, {})[uh] = {
            "count": count,
            "latest_name": name_map.get(ch, {}).get(uh, "알수없음"),
        }

    return result


# ── 1단계: 64자 → 12자 해시 키 병합 ──────────────────
def merge_long_keys(comm_data: dict) -> list[dict]:
    """
    64자 해시 키를 12자 키로 병합.
    - 12자 키가 이미 있으면: totalXp 합산, 레벨 재계산, 64자 키 삭제
    - 12자 키가 없으면: 64자 키를 12자로 rename
    Returns: 병합 결과 리스트
    """
    long_keys = [k for k in comm_data
                 if not k.startswith("_") and len(k) > HASH_LENGTH]
    if not long_keys:
        return []

    results = []
    for long_key in long_keys:
        short_key = long_key[:HASH_LENGTH]
        long_user = comm_data[long_key]
        long_total = long_user.get("totalXp", 0)

        if short_key in comm_data:
            # 양쪽 다 존재 — totalXp 합산 후 레벨 재계산
            short_user = comm_data[short_key]
            short_total = short_user.get("totalXp", 0)
            merged_total = long_total + short_total

            # totalXp 기준으로 레벨 처음부터 계산
            new_xp, new_level = recalculate_level(merged_total, 1)

            old_level = short_user.get("level", 1)
            short_user["totalXp"] = merged_total
            short_user["xp"] = new_xp
            short_user["level"] = new_level

            # firstSeen: 더 이른 쪽 유지
            long_first = long_user.get("firstSeen", "")
            short_first = short_user.get("firstSeen", "")
            if long_first and (not short_first or long_first < short_first):
                short_user["firstSeen"] = long_first

            # upvotes/downvotes: 합산
            short_user["upvotes"] = (short_user.get("upvotes", 0)
                                     + long_user.get("upvotes", 0))
            short_user["downvotes"] = (short_user.get("downvotes", 0)
                                       + long_user.get("downvotes", 0))

            # features: 합집합
            long_feats = set(long_user.get("features", []))
            short_feats = set(short_user.get("features", []))
            short_user["features"] = list(short_feats | long_feats)

            del comm_data[long_key]

            results.append({
                "name": short_user["name"],
                "hash": short_key,
                "action": "병합",
                "long_total": long_total,
                "short_total": short_total,
                "merged_total": merged_total,
                "old_level": old_level,
                "new_level": new_level,
            })
        else:
            # 12자 키 없음 — rename
            comm_data[short_key] = long_user
            del comm_data[long_key]

            results.append({
                "name": long_user["name"],
                "hash": short_key,
                "action": "rename",
                "long_total": long_total,
                "short_total": 0,
                "merged_total": long_total,
                "old_level": long_user.get("level", 1),
                "new_level": long_user.get("level", 1),
            })

    return results


# ── XP 적용 ──────────────────────────────────────────
def apply_xp(comm_data: dict, actual_key: str, msg_count: int,
             latest_name: str) -> dict:
    """유저에게 XP 부여. 변경 요약 반환."""
    is_new = actual_key is None

    if is_new:
        # DB의 12자 해시를 키로 신규 생성
        return None  # 호출자에서 처리

    user = comm_data[actual_key]
    old_level = user.get("level", 1)
    old_xp = user.get("xp", 0)
    old_total = user.get("totalXp", 0)

    user["xp"] = old_xp + msg_count
    user["totalXp"] = old_total + msg_count

    new_xp, new_level = recalculate_level(user["xp"], user["level"])
    user["xp"] = new_xp
    user["level"] = new_level

    return {
        "name": user["name"],
        "is_new": False,
        "msg_count": msg_count,
        "old_level": old_level,
        "new_level": new_level,
    }


def create_new_user(comm_data: dict, user_hash: str, msg_count: int,
                    latest_name: str) -> dict:
    """신규 유저 생성 후 XP 부여."""
    user = {
        "name": latest_name,
        "xp": 0,
        "totalXp": 0,
        "level": 1,
        "upvotes": 0,
        "downvotes": 0,
        "features": [],
        "lastSeen": "",
    }

    user["xp"] = msg_count
    user["totalXp"] = msg_count

    new_xp, new_level = recalculate_level(user["xp"], user["level"])
    user["xp"] = new_xp
    user["level"] = new_level

    comm_data[user_hash] = user

    return {
        "name": latest_name,
        "is_new": True,
        "msg_count": msg_count,
        "old_level": 1,
        "new_level": new_level,
    }


# ── 메인 로직 ────────────────────────────────────────
def run(comm_dir: str, db_path: str, execute: bool):
    if not os.path.isdir(comm_dir):
        print(f"[grant-xp] 디렉토리를 찾을 수 없습니다: {comm_dir}")
        sys.exit(1)

    if not os.path.isfile(db_path):
        print(f"[grant-xp] DB 파일을 찾을 수 없습니다: {db_path}")
        sys.exit(1)

    print(f"[grant-xp] DB: {db_path}")
    print(f"[grant-xp] comm_db 디렉토리: {comm_dir}")
    print(f"[grant-xp] 모드: {'실행' if execute else 'dry-run'}\n")

    # 1. DB에서 import 메시지 집계
    conn = sqlite3.connect(db_path)
    import_data = query_import_counts(conn)
    conn.close()

    if not import_data:
        print("[grant-xp] import 데이터가 없습니다.")
        return

    total_users = sum(len(users) for users in import_data.values())
    total_msgs = sum(
        u["count"] for users in import_data.values() for u in users.values()
    )
    print(f"[grant-xp] import 메시지 집계: "
          f"채널 {len(import_data)}개, 유저 {total_users}명, "
          f"총 {total_msgs:,}건\n")

    # 2. 채널별 처리 (병합 + XP 부여)
    grand_merged = 0
    grand_renamed = 0
    grand_updated = 0
    grand_created = 0
    grand_xp = 0
    grand_leveled = 0

    # 모든 comm_db 파일 대상으로 처리 (import 데이터 유무와 무관하게 병합)
    comm_files = sorted(glob.glob(os.path.join(comm_dir, "comm_db_*.json")))
    # import 데이터가 있는 채널 ID 추출
    import_channel_ids = set(import_data.keys())
    # comm_db 파일에서 채널 ID 추출
    all_channel_ids = set()
    for f in comm_files:
        basename = os.path.basename(f)
        ch_id = basename.replace("comm_db_", "").replace(".json", "")
        all_channel_ids.add(ch_id)

    for channel_id in sorted(all_channel_ids):
        json_path = os.path.join(comm_dir, f"comm_db_{channel_id}.json")
        if not os.path.isfile(json_path):
            continue

        with open(json_path, "r", encoding="utf-8") as f:
            comm_data = json.load(f)

        # ── 1단계: 64자 키 병합 ──
        merge_results = merge_long_keys(comm_data)
        if merge_results:
            merged = [r for r in merge_results if r["action"] == "병합"]
            renamed = [r for r in merge_results if r["action"] == "rename"]
            print(f"[merge] 채널 {channel_id}: "
                  f"병합 {len(merged)}건, rename {len(renamed)}건")
            for r in merge_results:
                if r["action"] == "병합":
                    lvl = (f"Lv.{r['old_level']} -> Lv.{r['new_level']}"
                           if r["new_level"] > r["old_level"]
                           else f"Lv.{r['new_level']}")
                    print(f"  {r['name']} ({r['hash']}): "
                          f"{r['long_total']:,} + {r['short_total']:,} "
                          f"= {r['merged_total']:,} totalXp, {lvl}")
                else:
                    print(f"  {r['name']} ({r['hash']}): rename")
            print()
            grand_merged += len(merged)
            grand_renamed += len(renamed)

        # ── 2단계: import XP 부여 ──
        user_counts = import_data.get(channel_id, {})

        if user_counts:
            changes = []
            for user_hash, info in sorted(user_counts.items(),
                                           key=lambda x: -x[1]["count"]):
                count = info["count"]
                name = info["latest_name"]

                # 병합 후에는 모두 12자 키이므로 직접 조회
                if user_hash in comm_data:
                    change = apply_xp(comm_data, user_hash, count, name)
                else:
                    change = create_new_user(
                        comm_data, user_hash, count, name)

                if change:
                    change["hash"] = user_hash
                    changes.append(change)

            # 통계
            updated = sum(1 for c in changes if not c["is_new"])
            created = sum(1 for c in changes if c["is_new"])
            ch_xp = sum(c["msg_count"] for c in changes)
            leveled = sum(
                1 for c in changes if c["new_level"] > c["old_level"])

            print(f"[grant-xp] 채널 {channel_id}:")
            print(f"  기존 유저: {updated}명, 신규 유저: {created}명, "
                  f"총 XP: {ch_xp:,}\n")

            for c in changes:
                prefix = "[신규] " if c["is_new"] else ""
                lvl = (f"Lv.{c['old_level']} -> Lv.{c['new_level']}"
                       if c["new_level"] > c["old_level"]
                       else f"Lv.{c['new_level']}")
                print(f"  {prefix}{c['name']} ({c['hash']}): "
                      f"+{c['msg_count']:,} XP, {lvl}")

            print()
        else:
            updated = created = ch_xp = leveled = 0

        grand_updated += updated
        grand_created += created
        grand_xp += ch_xp
        grand_leveled += leveled

        # 저장
        if execute:
            with open(json_path, "w", encoding="utf-8") as f:
                json.dump(comm_data, f, ensure_ascii=False)
            print(f"  저장 완료: {json_path}")

    # 3. 총 요약
    print(f"\n[grant-xp] 총 요약:")
    if grand_merged + grand_renamed > 0:
        print(f"  해시 병합: {grand_merged}건, rename: {grand_renamed}건")
    print(f"  XP 업데이트: {grand_updated}명")
    print(f"  신규 유저: {grand_created}명")
    print(f"  총 XP 부여: {grand_xp:,}")
    print(f"  레벨 변경: {grand_leveled}명")

    total_changes = (grand_merged + grand_renamed
                     + grand_updated + grand_created)
    if not execute and total_changes > 0:
        print(f"\n[dry-run] JSON 변경 없이 종료합니다.")
        print(f"  실제 실행하려면: "
              f"python -m scripts.grant_import_xp "
              f"--comm-dir {comm_dir} --execute")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="import 채팅 데이터 기반 XP 부여")
    parser.add_argument("--comm-dir", required=True,
                        help="comm_db_*.json 파일이 있는 디렉토리")
    parser.add_argument("--db", default=DEFAULT_DB_PATH,
                        help="chat.db 파일 경로 (기본: server/data/chat.db)")
    parser.add_argument("--execute", action="store_true",
                        help="실제 실행 (기본: dry-run)")
    args = parser.parse_args()

    run(args.comm_dir, args.db, args.execute)
