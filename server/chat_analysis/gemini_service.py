import os
import requests
import re
from langchain_core.language_models.llms import LLM
from dotenv import load_dotenv

# .env 파일 로드
load_dotenv()

def _sanitize_log(text: str) -> str:
    """로그 출력 시 Gemini API Key 노출을 방지하는 내부 함수"""
    if not text:
        return ""
    return re.sub(r'key=AIza[a-zA-Z0-9_-]+', 'key=***HIDDEN***', str(text))


class GeminiLLM(LLM):
    @property
    def _llm_type(self) -> str:
        return "gemini"

    def _call(self, prompt: str, stop=None) -> str:
        # 환경 변수에서 API 키 로드
        api_key = os.getenv("GEMINI_API_KEY")
        if not api_key:
            raise ValueError("GEMINI_API_KEY 환경 변수가 설정되지 않았습니다.")

        # gemini-2.0-flash 및 v1beta 엔드포인트 사용
        model_name = "gemini-2.0-flash"
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent?key={api_key}"

        # 요청 본문 구조
        payload = {
            "contents": [
                {
                    "parts": [
                        {
                            "text": prompt
                        }
                    ]
                }
            ],
            "generationConfig": {
                "temperature": 0.4,
                "topK": 40,
                "topP": 0.9,
                "maxOutputTokens": 1000,
                "stopSequences": []
            }
        }

        # 디버깅을 위한 출력 (API 키 노출 방지)
        print(f"API 요청 URL: https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent")

        # API 요청
        try:
            response = requests.post(
                url=url,
                json=payload,
                headers={"Content-Type": "application/json"}
            )

            # 응답 상태 코드 확인 및 오류 처리 강화
            print(f"응답 상태 코드: {response.status_code}")
            response.raise_for_status()  # HTTP 오류 발생 시 HTTPError 예외를 발생시킴

            # 응답 파싱
            response_json = response.json()

            if "candidates" in response_json and len(response_json["candidates"]) > 0:
                if "content" in response_json["candidates"][0]:
                    if "parts" in response_json["candidates"][0]["content"]:
                        if len(response_json["candidates"][0]["content"]["parts"]) > 0:
                            if "text" in response_json["candidates"][0]["content"]["parts"][0]:
                                raw_text = response_json["candidates"][0]["content"]["parts"][0]["text"]
                                
                                # <template> 태그 강제 제거 및 공백 정리
                                clean_text = raw_text.replace("<template>", "").replace("</template>", "").strip()
                                return clean_text

            # 응답 구조가 예상과 다른 경우
            error_msg = f"응답 파싱 오류: {response_json}"
            print(f"[GeminiLLM Error] {_sanitize_log(error_msg)}")
            raise RuntimeError("API 응답 구조를 파싱할 수 없습니다.")

        except requests.exceptions.HTTPError as e:
            # HTTP 에러 (404 포함) 처리
            # ❌ 수정됨: 에러 상세 메시지는 로그로만 찍고, 밖으로는 안전한 에러만 던집니다.
            print(f"[GeminiLLM HTTP Error] {_sanitize_log(e)}")
            if e.response is not None:
                print(f"[GeminiLLM Response Body] {_sanitize_log(e.response.text)}")
            raise RuntimeError("LLM API 서버 통신 중 HTTP 오류가 발생했습니다.")

        except Exception as e:
            # 기타 네트워크/연결 예외 처리
            # ❌ 수정됨: 가장 치명적인 API 키 노출 지점. 마스킹된 로그만 출력 후 범용 에러 Throw.
            print(f"[GeminiLLM Network Error] API 요청 중 예외 발생: {_sanitize_log(e)}")
            raise RuntimeError("LLM API 서버 연결에 실패했습니다.")

    def _identifying_params(self):
        return {"model": "gemini-2.0-flash"}

# 사용 예시 (테스트)
if __name__ == "__main__":
    gemini_llm = GeminiLLM()
    prompt_text = "간단한 자기소개를 해줘."
    try:
        response_text = gemini_llm(prompt_text)
        print(f"질문: {prompt_text}")
        print(f"답변: {response_text}")
    except Exception as e:
        print(f"테스트 중 에러 발생: {e}")