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

    # --- 마이그레이션: 기존 yukeuijeon_items에 category 컬럼 추가 ---
    # executescript보다 먼저 실행해야 category 참조 인덱스가 동작함
    try:
        conn.execute("ALTER TABLE yukeuijeon_items ADD COLUMN category TEXT NOT NULL DEFAULT 'item'")
        conn.commit()
        print("[database] yukeuijeon_items.category 컬럼 마이그레이션 완료")
    except sqlite3.OperationalError:
        pass  # 테이블 없거나 이미 존재

    # --- 마이그레이션: yukeuijeon_alarms에 user_hash, user_name 컬럼 추가 ---
    # UNIQUE 제약도 (channel_id, keyword) → (channel_id, user_hash, keyword)로 변경
    try:
        conn.execute("ALTER TABLE yukeuijeon_alarms ADD COLUMN user_hash TEXT DEFAULT ''")
        conn.execute("ALTER TABLE yukeuijeon_alarms ADD COLUMN user_name TEXT DEFAULT ''")
        conn.commit()
        print("[database] yukeuijeon_alarms user_hash/user_name 컬럼 마이그레이션 완료")
    except sqlite3.OperationalError:
        pass  # 테이블 없거나 이미 존재

    # UNIQUE 제약 변경: 테이블 재생성 필요 (SQLite는 ALTER CONSTRAINT 미지원)
    try:
        cursor = conn.execute(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name='yukeuijeon_alarms'"
        )
        row = cursor.fetchone()
        if row and "user_hash" in row[0] and "UNIQUE(channel_id, keyword)" in row[0]:
            conn.executescript("""
                CREATE TABLE IF NOT EXISTS yukeuijeon_alarms_new (
                    id              INTEGER PRIMARY KEY AUTOINCREMENT,
                    channel_id      TEXT NOT NULL,
                    user_hash       TEXT DEFAULT '',
                    user_name       TEXT DEFAULT '',
                    keyword         TEXT NOT NULL,
                    keyword_raw     TEXT NOT NULL,
                    created_at      TEXT DEFAULT (datetime('now','localtime')),
                    UNIQUE(channel_id, user_hash, keyword)
                );
                INSERT OR IGNORE INTO yukeuijeon_alarms_new
                    (id, channel_id, user_hash, user_name, keyword, keyword_raw, created_at)
                    SELECT id, channel_id, COALESCE(user_hash,''), COALESCE(user_name,''),
                           keyword, keyword_raw, created_at
                    FROM yukeuijeon_alarms;
                DROP TABLE yukeuijeon_alarms;
                ALTER TABLE yukeuijeon_alarms_new RENAME TO yukeuijeon_alarms;
            """)
            conn.commit()
            print("[database] yukeuijeon_alarms UNIQUE 제약 마이그레이션 완료")
    except sqlite3.OperationalError:
        pass

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
            source      TEXT DEFAULT 'bot',
            created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_channel_time ON chat_logs(channel_id, timestamp);
        CREATE INDEX IF NOT EXISTS idx_user_hash ON chat_logs(user_hash);
        CREATE INDEX IF NOT EXISTS idx_source ON chat_logs(source);

        CREATE TABLE IF NOT EXISTS user_features (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            channel_id  TEXT NOT NULL,
            user_hash   TEXT NOT NULL,
            features    TEXT NOT NULL,
            created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(channel_id, user_hash)
        );

        CREATE TABLE IF NOT EXISTS yukeuijeon_items (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            category        TEXT NOT NULL DEFAULT 'item',
            item_name       TEXT NOT NULL,
            item_name_raw   TEXT NOT NULL,
            quantity        INTEGER NOT NULL,
            price           INTEGER NOT NULL,
            seller          TEXT NOT NULL,
            registered_at   TEXT NOT NULL,
            scraped_at      TEXT DEFAULT (datetime('now','localtime'))
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_yuk_unique
            ON yukeuijeon_items(category, item_name, quantity, price, seller);
        CREATE INDEX IF NOT EXISTS idx_yuk_item_name ON yukeuijeon_items(item_name);
        CREATE INDEX IF NOT EXISTS idx_yuk_scraped ON yukeuijeon_items(scraped_at);

        CREATE TABLE IF NOT EXISTS yukeuijeon_alarms (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            channel_id      TEXT NOT NULL,
            user_hash       TEXT DEFAULT '',
            user_name       TEXT DEFAULT '',
            keyword         TEXT NOT NULL,
            keyword_raw     TEXT NOT NULL,
            created_at      TEXT DEFAULT (datetime('now','localtime')),
            UNIQUE(channel_id, user_hash, keyword)
        );
    """)
    conn.commit()
    print("[database] chat_logs, user_features, yukeuijeon 테이블 준비 완료")
