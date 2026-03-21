#!/usr/bin/env python3
"""
DB 최적화 마이그레이션 스크립트

1. 2024-12-31 이전 데이터 삭제
2. user_hash를 12자로 truncate
3. VACUUM 실행

사용법:
    python optimize_db.py                  # dry-run (변경 없이 미리보기)
    python optimize_db.py --execute        # 실제 실행
"""

import argparse
import os
import sqlite3
import sys
from datetime import datetime

# 프로젝트 루트 기준 DB 경로
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DEFAULT_DB_PATH = os.path.join(SCRIPT_DIR, "..", "data", "chat.db")

HASH_LENGTH = 12
# 2025-01-01 00:00:00 KST (UTC+9) in epoch ms
CUTOFF_TS = int(datetime(2025, 1, 1, 0, 0, 0).timestamp() * 1000)


def get_db_size(db_path: str) -> float:
    """DB 파일 + WAL + SHM 총 크기(MB)"""
    total = 0
    for suffix in ("", "-wal", "-shm"):
        p = db_path + suffix
        if os.path.exists(p):
            total += os.path.getsize(p)
    return total / (1024 * 1024)


def run(db_path: str, execute: bool):
    if not os.path.exists(db_path):
        print(f"❌ DB 파일을 찾을 수 없습니다: {db_path}")
        sys.exit(1)

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    size_before = get_db_size(db_path)
    print(f"📊 현재 DB 크기: {size_before:.1f} MB")

    # --- 1단계: 오래된 데이터 삭제 ---
    cur.execute("SELECT COUNT(*) FROM chat_logs WHERE timestamp < ?", (CUTOFF_TS,))
    delete_count = cur.fetchone()[0]

    cur.execute("SELECT COUNT(*) FROM chat_logs WHERE timestamp >= ?", (CUTOFF_TS,))
    keep_count = cur.fetchone()[0]

    print(f"\n[1단계] 2024-12-31 이전 데이터 삭제")
    print(f"   삭제 대상: {delete_count:,}건")
    print(f"   보존 대상: {keep_count:,}건")

    if execute and delete_count > 0:
        cur.execute("DELETE FROM chat_logs WHERE timestamp < ?", (CUTOFF_TS,))
        conn.commit()
        print(f"   ✅ {delete_count:,}건 삭제 완료")

    # --- 2단계: user_hash truncate ---
    cur.execute(
        "SELECT COUNT(*) FROM chat_logs WHERE user_hash IS NOT NULL AND LENGTH(user_hash) > ?",
        (HASH_LENGTH,),
    )
    truncate_count = cur.fetchone()[0]

    # 충돌 검사
    cur.execute(
        """SELECT COUNT(DISTINCT user_hash) as full_cnt,
                  COUNT(DISTINCT SUBSTR(user_hash, 1, ?)) as trunc_cnt
           FROM chat_logs WHERE user_hash IS NOT NULL""",
        (HASH_LENGTH,),
    )
    row = cur.fetchone()
    full_distinct = row["full_cnt"]
    trunc_distinct = row["trunc_cnt"]

    print(f"\n[2단계] user_hash {HASH_LENGTH}자 truncate")
    print(f"   대상 레코드: {truncate_count:,}건")
    print(f"   고유 해시: {full_distinct}개 → truncate 후: {trunc_distinct}개")

    if full_distinct != trunc_distinct:
        print(f"   ⚠️  경고: truncate 시 {full_distinct - trunc_distinct}개 해시 충돌 발생!")
        print(f"   작업을 중단합니다.")
        conn.close()
        sys.exit(1)
    else:
        print(f"   ✅ 충돌 없음")

    if execute and truncate_count > 0:
        cur.execute(
            "UPDATE chat_logs SET user_hash = SUBSTR(user_hash, 1, ?) WHERE user_hash IS NOT NULL AND LENGTH(user_hash) > ?",
            (HASH_LENGTH, HASH_LENGTH),
        )
        conn.commit()
        print(f"   ✅ {truncate_count:,}건 truncate 완료")

    # --- 3단계: VACUUM ---
    print(f"\n[3단계] VACUUM")
    if execute:
        print("   VACUUM 실행 중... (시간이 걸릴 수 있습니다)")
        conn.execute("VACUUM")
        conn.close()

        size_after = get_db_size(db_path)
        print(f"   ✅ VACUUM 완료")
        print(f"\n📊 결과: {size_before:.1f} MB → {size_after:.1f} MB (▼ {size_before - size_after:.1f} MB)")
    else:
        conn.close()
        print("   (dry-run: 실행하지 않음)")
        print(f"\n💡 실제 실행하려면: python {os.path.basename(__file__)} --execute")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="DB 최적화 마이그레이션")
    parser.add_argument("--execute", action="store_true", help="실제 실행 (기본: dry-run)")
    parser.add_argument("--db", default=DEFAULT_DB_PATH, help="DB 파일 경로")
    args = parser.parse_args()

    run(args.db, args.execute)
