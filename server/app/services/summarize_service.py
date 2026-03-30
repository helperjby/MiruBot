import re
import time
from app.services.gemini_service import GeminiLLM
from app.services.chat_service import get_recent_logs

_gemini = GeminiLLM()

# Gemini 입력 토큰 보호: 최대 메시지 수
MAX_MESSAGES_FOR_SUMMARY = 1000

# content가 이 패턴에 해당하면 요약 대상에서 제외
_SKIP_RE = re.compile(
    r"^(이모티콘|사진|동영상|샵검색)(을 보냈습니다\.?|( \d+장을 보냈습니다\.?))$"
)

# 단순 반응 패턴 (프롬프트에서 LLM이 걸러내던 것을 전처리로 이동)
_NOISE_RE = re.compile(
    r"^[ㄱ-ㅎㅋㅎㅉㅠㅜㅡ\s.!?~ㅇㅎ]+$"
)

# 짧은 메시지 병합 기준 길이
_SHORT_MSG_LEN = 15


def _clean_name(name: str) -> str:
    """user_name에서 공백·특수문자를 제거합니다."""
    return re.sub(r"[^\w가-힣]", "", name) or "알수없음"


def _format_chat_log(messages: list[dict]) -> str:
    """DB 로그를 전처리하여 Gemini에 전달할 텍스트로 변환합니다."""
    lines: list[str] = []
    prev_name: str | None = None
    prev_hhmm: str | None = None
    merge_buf: list[str] = []

    def _flush_merge():
        """병합 버퍼에 쌓인 짧은 메시지를 하나의 줄로 내보냅니다."""
        if not merge_buf:
            return
        time_part = f"[{prev_hhmm}] " if prev_hhmm != lines_last_hhmm() else ""
        lines.append(f"{time_part}{prev_name}: {' / '.join(merge_buf)}")
        merge_buf.clear()

    def lines_last_hhmm() -> str | None:
        """직전에 출력된 줄의 시각을 반환합니다."""
        if not lines:
            return None
        first = lines[-1]
        if first.startswith("[") and "]" in first:
            return first[1:first.index("]")]
        return prev_hhmm

    for m in messages:
        content: str = m["content"].strip()

        # 1) 이모티콘/사진 등 스킵
        if _SKIP_RE.match(content):
            continue

        # 2) 단순 반응(ㅋㅋ, ㅇㅇ 등) 스킵
        if _NOISE_RE.match(content):
            continue

        # 3) user_name 정규화
        name = _clean_name(m.get("user_name") or "")

        # 4) timestamp → HH:MM
        t = time.localtime(m["timestamp"] / 1000)
        hhmm = time.strftime("%H:%M", t)

        # 5) 연속 동일 유저의 짧은 메시지 병합
        if name == prev_name and len(content) <= _SHORT_MSG_LEN:
            merge_buf.append(content)
            continue

        # 유저가 바뀌거나 긴 메시지가 오면 병합 버퍼 비우기
        _flush_merge()

        # 6) 시각이 바뀔 때만 timestamp 표시
        if hhmm != prev_hhmm:
            lines.append(f"[{hhmm}] {name}: {content}")
        else:
            lines.append(f"{name}: {content}")

        prev_name = name
        prev_hhmm = hhmm

    # 마지막 병합 버퍼 처리
    _flush_merge()

    return "\n".join(lines)


def summarize_chat(channel_id: str, hours: float = 4.0) -> dict:
    """채팅 로그를 조회하고 Gemini로 요약합니다."""
    messages = get_recent_logs(channel_id, hours)

    if not messages:
        return {
            "success": False,
            "summary": None,
            "message": f"최근 {hours}시간 내 채팅 기록이 없습니다.",
            "count": 0,
        }

    total_count = len(messages)

    # 토큰 보호: 너무 많으면 최근 N개만 사용
    if total_count > MAX_MESSAGES_FOR_SUMMARY:
        messages = messages[-MAX_MESSAGES_FOR_SUMMARY:]

    chat_text = _format_chat_log(messages)

    prompt = f"""다음은 카카오톡 채팅방의 최근 {hours}시간 대화 기록입니다.
이 대화를 한국어로 요약해주세요.

요약 규칙:
1. 주요 주제별로 나누어 요약할 것
2. 각 주제에서 누가 어떤 이야기를 했는지 간략히 포함할 것
3. 전체 요약은 간결하게 작성할 것

출력 형식 규칙 (반드시 지킬 것):
- 마크다운 문법(**, *, #, ``` 등)을 절대 사용하지 말 것
- 주제 구분은 "[주제명]" 형태로 표시할 것
- 하위 항목은 "- " (대시+공백)으로 표시할 것
- 순수 텍스트만 사용할 것

--- 대화 기록 ---
{chat_text}
--- 대화 기록 끝 ---

위 대화를 요약해주세요."""

    summary = _gemini.invoke(prompt)

    return {
        "success": True,
        "summary": summary,
        "message": None,
        "count": len(messages),
        "total_count": total_count,
    }
