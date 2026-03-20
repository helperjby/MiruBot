import time
from app.services.gemini_service import GeminiLLM
from app.services.chat_service import get_recent_logs

_gemini = GeminiLLM()

# Gemini 입력 토큰 보호: 최대 메시지 수
MAX_MESSAGES_FOR_SUMMARY = 1500


def _format_chat_log(messages: list[dict]) -> str:
    """DB 로그를 Gemini에 전달할 텍스트로 변환합니다."""
    lines = []
    for m in messages:
        # timestamp(epoch ms) → HH:MM 변환
        t = time.localtime(m["timestamp"] / 1000)
        time_str = time.strftime("%H:%M", t)
        name = m.get("user_name") or "알수없음"
        lines.append(f"[{time_str}] {name}: {m['content']}")
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

    # 토큰 보호: 너무 많으면 최근 N개만 사용
    if len(messages) > MAX_MESSAGES_FOR_SUMMARY:
        messages = messages[-MAX_MESSAGES_FOR_SUMMARY:]

    chat_text = _format_chat_log(messages)

    prompt = f"""다음은 카카오톡 채팅방의 최근 {hours}시간 대화 기록입니다.
이 대화를 한국어로 요약해주세요.

요약 규칙:
1. 주요 주제별로 나누어 요약할 것
2. 각 주제에서 누가 어떤 이야기를 했는지 간략히 포함할 것
3. 중요하지 않은 인사말이나 단순 반응("ㅋㅋ", "ㅇㅇ" 등)은 생략할 것
4. 전체 요약은 간결하게 작성할 것

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
    }
