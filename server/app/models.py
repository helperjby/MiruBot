from pydantic import BaseModel

class MessageRequest(BaseModel):
    text: str

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
