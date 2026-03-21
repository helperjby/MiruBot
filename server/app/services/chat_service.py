import time
from app.database import get_connection


def insert_chat_logs(messages: list[dict]) -> int:
    """채팅 로그를 일괄 저장하고 저장된 건수를 반환합니다."""
    if not messages:
        return 0

    conn = get_connection()
    HASH_LEN = 12
    rows = [
        (
            msg["channel_id"],
            msg.get("room_name"),
            msg.get("user_hash", "")[:HASH_LEN] if msg.get("user_hash") else None,
            msg.get("user_name"),
            msg["content"],
            msg.get("log_id"),
            msg["timestamp"],
            msg.get("source", "bot"),
        )
        for msg in messages
    ]
    conn.executemany(
        """INSERT INTO chat_logs
           (channel_id, room_name, user_hash, user_name, content, log_id, timestamp, source)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
        rows,
    )
    conn.commit()
    return len(rows)


def get_recent_logs(channel_id: str, hours: float = 4.0) -> list[dict]:
    """특정 채팅방의 최근 N시간 로그를 시간순으로 반환합니다."""
    conn = get_connection()
    cutoff = int((time.time() - hours * 3600) * 1000)  # epoch ms

    rows = conn.execute(
        """SELECT user_name, user_hash, content, timestamp
           FROM chat_logs
           WHERE channel_id = ? AND timestamp >= ?
           ORDER BY timestamp ASC""",
        (channel_id, cutoff),
    ).fetchall()

    return [dict(r) for r in rows]
