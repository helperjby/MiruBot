import os
import requests
import re
from langchain_core.language_models.llms import LLM
from dotenv import load_dotenv

# .env 파일 로드
load_dotenv()

# 💡 [추가] 달러 -> 원화 환산을 위한 환율 변수 지정 (현재 시세에 맞게 수정해서 사용하세요)
EXCHANGE_RATE = 1500.0

def _sanitize_log(text: str) -> str:
    """로그 출력 시 Gemini API Key 노출을 방지하는 내부 함수"""
    if not text:
        return ""
    return re.sub(r'key=AIza[a-zA-Z0-9_-]+', 'key=***HIDDEN***', str(text))


class GeminiLLM(LLM):
    @property
    def _llm_type(self) -> str:
        return "gemini"

    def _call(self, prompt: str, stop=None, **kwargs) -> str:
        api_key = os.getenv("GEMINI_API_KEY")
        if not api_key:
            raise ValueError("GEMINI_API_KEY 환경 변수가 설정되지 않았습니다.")

        # 최신 3.1 flash lite 모델 사용
        model_name = "gemini-3.1-flash-lite-preview"
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent?key={api_key}"

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
                "temperature": kwargs.get("temperature", 0.4),
                "topK": 40,
                "topP": 0.9,
                "maxOutputTokens": 1000,
                "stopSequences": []
            }
        }

        try:
            response = requests.post(
                url=url,
                json=payload,
                headers={"Content-Type": "application/json"}
            )
            response.raise_for_status() 

            response_json = response.json()

            # 토큰 사용량 및 예상 비용 계산 로직
            if "usageMetadata" in response_json:
                usage = response_json["usageMetadata"]
                prompt_tokens = usage.get("promptTokenCount", 0)
                output_tokens = usage.get("candidatesTokenCount", 0)
                total_tokens = usage.get("totalTokenCount", 0)
                
                # 비용 계산 (입력: 100만 개당 $0.25 / 출력: 100만 개당 $1.50)
                input_cost = (prompt_tokens / 1_000_000) * 0.25
                output_cost = (output_tokens / 1_000_000) * 1.50
                total_cost_usd = input_cost + output_cost
                
                # 💡 [추가] 지정한 환율 변수를 곱하여 원화(KRW) 비용 계산
                total_cost_krw = total_cost_usd * EXCHANGE_RATE
                
                print(f"\n[GeminiLLM Token Usage] Input: {prompt_tokens} / Output: {output_tokens} / Total: {total_tokens}")
                # 💡 [수정] 달러 비용과 원화 비용을 함께 로그에 출력
                print(f"[GeminiLLM Estimated Cost] ${total_cost_usd:.6f} USD (약 {total_cost_krw:.2f}원)")

            if "candidates" in response_json and len(response_json["candidates"]) > 0:
                if "content" in response_json["candidates"][0]:
                    if "parts" in response_json["candidates"][0]["content"]:
                        if len(response_json["candidates"][0]["content"]["parts"]) > 0:
                            if "text" in response_json["candidates"][0]["content"]["parts"][0]:
                                raw_text = response_json["candidates"][0]["content"]["parts"][0]["text"]
                                
                                print(f"[GeminiLLM Debug] 모델 원본 응답:\n{raw_text}\n")
                                
                                # 마크다운 코드블록 방어 로직
                                clean_text = re.sub(r'^```[a-zA-Z]*\n', '', raw_text)
                                clean_text = re.sub(r'```$', '', clean_text)
                                
                                # <template> 태그 강제 제거 및 공백 정리
                                clean_text = clean_text.replace("<template>", "").replace("</template>", "").strip()
                                return clean_text

            error_msg = f"응답 파싱 오류: {response_json}"
            print(f"[GeminiLLM Error] {_sanitize_log(error_msg)}")
            raise RuntimeError("API 응답 구조를 파싱할 수 없습니다.")

        except requests.exceptions.HTTPError as e:
            print(f"[GeminiLLM HTTP Error] {_sanitize_log(e)}")
            if e.response is not None:
                print(f"[GeminiLLM Response Body] {_sanitize_log(e.response.text)}")
            raise RuntimeError("LLM API 서버 통신 중 HTTP 오류가 발생했습니다.")

        except Exception as e:
            print(f"[GeminiLLM Network Error] API 요청 중 예외 발생: {_sanitize_log(e)}")
            raise RuntimeError("LLM API 서버 연결에 실패했습니다.")

    @property
    def _identifying_params(self):
        return {"model": "gemini-3.1-flash-lite-preview"}

if __name__ == "__main__":
    gemini_llm = GeminiLLM()
    prompt_text = "간단한 자기소개를 해줘."
    try:
        response_text = gemini_llm.invoke(prompt_text)
        print(f"질문: {prompt_text}")
        print(f"답변: {response_text}")
    except Exception as e:
        print(f"테스트 중 에러 발생: {e}")