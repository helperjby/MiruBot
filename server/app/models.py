from pydantic import BaseModel


class MessageRequest(BaseModel):
    text: str


# --- 채팅 로그 / 요약 관련 ---

class ChatMessage(BaseModel):
    channel_id: str
    room_name: str | None = None
    user_hash: str | None = None
    user_name: str | None = None
    content: str
    log_id: str | None = None
    timestamp: int  # epoch ms


class ChatLogBatchRequest(BaseModel):
    messages: list[ChatMessage]


class ChatSummarizeRequest(BaseModel):
    channel_id: str
    hours: float = 4.0

class SummaryResponse(BaseModel):
    headline: str
    gemini_summary: str

class TranslationResponse(BaseModel):
    translation: str

class TranslateRequest(BaseModel):
    text: str
    target_language: str

class TranslateResponse(BaseModel):
    translated_text: str
