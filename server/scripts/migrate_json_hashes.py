#!/usr/bin/env python3
"""
봇 JSON 파일의 user_hash 키를 12자로 truncate하는 마이그레이션 스크립트

대상 파일:
- sdcard/bot/comm_db_*.json      (커뮤니티 DB — 키가 user_hash)
- sdcard/bot/nick_history_*.json  (닉네임 히스토리 — 키가 user_hash)
- sdcard/bot/owner_hashes.json    (오너 해시 목록 — 배열)

사용법:
    python migrate_json_hashes.py --bot-dir /path/to/sdcard/bot
    python migrate_json_hashes.py --bot-dir /path/to/sdcard/bot --execute
"""

import argparse
import glob
import json
import os
import sys

HASH_LENGTH = 12


def truncate_dict_keys(data: dict) -> tuple[dict, int]:
    """딕셔너리의 키를 HASH_LENGTH로 truncate. 변환된 키 수 반환."""
    new_data = {}
    changed = 0
    for key, value in data.items():
        if key.startswith("_"):  # _meta 등 내부 키는 유지
            new_data[key] = value
        elif len(key) > HASH_LENGTH:
            new_key = key[:HASH_LENGTH]
            new_data[new_key] = value
            changed += 1
        else:
            new_data[key] = value
    return new_data, changed


def truncate_array(data: list) -> tuple[list, int]:
    """배열의 해시값을 HASH_LENGTH로 truncate. 변환된 항목 수 반환."""
    new_data = []
    changed = 0
    seen = set()
    for item in data:
        if isinstance(item, str) and len(item) > HASH_LENGTH:
            truncated = item[:HASH_LENGTH]
            if truncated not in seen:
                new_data.append(truncated)
                seen.add(truncated)
            changed += 1
        else:
            if item not in seen:
                new_data.append(item)
                seen.add(item)
    return new_data, changed


def migrate_file(filepath: str, execute: bool) -> int:
    """단일 JSON 파일 마이그레이션. 변환된 키/항목 수 반환."""
    with open(filepath, "r", encoding="utf-8") as f:
        data = json.load(f)

    filename = os.path.basename(filepath)

    if isinstance(data, dict):
        new_data, changed = truncate_dict_keys(data)
    elif isinstance(data, list):
        new_data, changed = truncate_array(data)
    else:
        print(f"  ⏭️  {filename}: 지원하지 않는 형식 (skip)")
        return 0

    if changed == 0:
        print(f"  ✅ {filename}: 변환 대상 없음")
        return 0

    print(f"  🔄 {filename}: {changed}개 키/항목 변환")

    if execute:
        with open(filepath, "w", encoding="utf-8") as f:
            json.dump(new_data, f, ensure_ascii=False)
        print(f"     ✅ 저장 완료")

    return changed


def run(bot_dir: str, execute: bool):
    if not os.path.isdir(bot_dir):
        print(f"❌ 디렉토리를 찾을 수 없습니다: {bot_dir}")
        sys.exit(1)

    print(f"📂 대상 디렉토리: {bot_dir}")
    print(f"🔧 모드: {'실행' if execute else 'dry-run'}\n")

    total_changed = 0

    # 1. comm_db_*.json
    comm_files = sorted(glob.glob(os.path.join(bot_dir, "comm_db_*.json")))
    print(f"[커뮤니티 DB] {len(comm_files)}개 파일")
    for f in comm_files:
        total_changed += migrate_file(f, execute)

    # 2. nick_history_*.json
    nick_files = sorted(glob.glob(os.path.join(bot_dir, "nick_history_*.json")))
    print(f"\n[닉네임 히스토리] {len(nick_files)}개 파일")
    for f in nick_files:
        total_changed += migrate_file(f, execute)

    # 3. owner_hashes.json
    owner_file = os.path.join(bot_dir, "owner_hashes.json")
    print(f"\n[오너 해시]")
    if os.path.exists(owner_file):
        total_changed += migrate_file(owner_file, execute)
    else:
        print("  ⏭️  owner_hashes.json 없음 (skip)")

    print(f"\n📊 총 {total_changed}개 키/항목 변환")
    if not execute and total_changed > 0:
        print(f"💡 실제 실행하려면: python {os.path.basename(__file__)} --bot-dir {bot_dir} --execute")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="JSON 파일 해시 키 마이그레이션")
    parser.add_argument("--bot-dir", required=True, help="sdcard/bot 디렉토리 경로")
    parser.add_argument("--execute", action="store_true", help="실제 실행 (기본: dry-run)")
    args = parser.parse_args()

    run(args.bot_dir, args.execute)
