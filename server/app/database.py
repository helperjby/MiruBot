import sqlite3
import os
import threading

DB_PATH = os.getenv("CHAT_DB_PATH", "/app/data/chat.db")

_local = threading.local()


def get_connection() -> sqlite3.Connection:
    """스레드별 SQLite 연결을 반환합니다."""
    if not hasattr(_local, "conn") or _local.conn is None:
        os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
        _local.conn = sqlite3.connect(DB_PATH)
        _local.conn.execute("PRAGMA journal_mode=WAL")
        _local.conn.execute("PRAGMA synchronous=NORMAL")
        _local.conn.row_factory = sqlite3.Row
    return _local.conn


def init_db():
    """DB 테이블 및 인덱스를 생성합니다."""
    conn = get_connection()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS chat_logs (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            channel_id  TEXT NOT NULL,
            room_name   TEXT,
            user_hash   TEXT,
            user_name   TEXT,
            content     TEXT NOT NULL,
            log_id      TEXT,
            timestamp   INTEGER NOT NULL,
            created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_channel_time ON chat_logs(channel_id, timestamp);
        CREATE INDEX IF NOT EXISTS idx_user_hash ON chat_logs(user_hash);
    """)
    conn.commit()
    print("[database] chat_logs 테이블 준비 완료")
