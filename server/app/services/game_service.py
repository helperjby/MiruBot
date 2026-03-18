import json
import random
import os
from datetime import datetime, timedelta

# 데이터 파일 경로
NPC_DATA_PATH = "/app/static_files/npc.json"

# 유저별 쿨타임 저장소 (메모리 내 저장)
_user_cooldowns = {}

def load_npc_data():
    """npc.json 파일을 로드합니다."""
    if not os.path.exists(NPC_DATA_PATH):
        return None
    with open(NPC_DATA_PATH, 'r', encoding='utf-8') as f:
        return json.load(f)

def get_fortune_result():
    """
    현재 시간(초 단위 포함)을 시드로 하여 운세를 생성합니다.
    """
    # 1. 운세 등급 및 확률 설정 (보내주신 최신 멘트 유지)
    tiers = [
        {"grade": "✨대박!✨", "msg": "신화의 기운이 느껴집니다! 당장 여세요!", "weight": 5},
        {"grade": "길 😊", "msg": "나쁘지 않습니다. 정수가 나올 것 같네요.", "weight": 15},
        {"grade": "평범 🙂", "msg": "무난한 하루입니다. 큰 기대는 실망을 부릅니다.", "weight": 40},
        {"grade": "흉 😔", "msg": "잠시 참으세요. 지금은 때가 아닙니다.", "weight": 25},
        {"grade": "대흉 😱", "msg": "골렘 다리가 부러졌습니다... ", "weight": 15}
    ]
    
    # [수정] 전역 random 시드 대신 로컬 인스턴스 사용
    # 이유: 여기서 전역 seed를 고정하면 장소 추천까지 똑같이 나오는 현상이 발생함
    rng = random.Random()
    now = datetime.now()
    seed_val = int(now.strftime("%Y%m%d%H%M%S"))
    rng.seed(seed_val)
    
    result = rng.choices(tiers, weights=[t['weight'] for t in tiers], k=1)[0]
    return result

def get_recommend_place():
    """장소 추천 로직 (확률 보정 적용)"""
    data = load_npc_data()
    if not data:
        return "데이터 없음 - 파일을 확인해주세요."

    # [핵심 수정] 마을 먼저 뽑지 않고, '마을-NPC' 전체 리스트를 생성 (한 바구니 담기)
    all_candidates = []
    
    for town, npc_list in data.items():
        for npc in npc_list:
            all_candidates.append((town, npc))
    
    if not all_candidates:
        return "데이터 오류 - 후보 목록이 없습니다."

    # 전체 리스트에서 1명 추첨 (이제 모든 NPC가 동일한 확률을 가짐)
    selected_town, selected_npc = random.choice(all_candidates)
    
    # 채널 랜덤 (1~10)
    channel = random.randint(1, 10)
    
    # (참고: 보내주신 코드에 채널 변수는 있는데 출력에서 빠져있어서 다시 넣었습니다)
    return f"{selected_town} - {selected_npc} 앞"

# ★ 여기가 중요합니다: user_id 파라미터가 반드시 있어야 합니다.
def process_key_fortune(user_id: str):
    """
    운세와 추천 장소를 반환하되, 쿨타임(15분)을 체크합니다.
    """
    global _user_cooldowns
    
    now = datetime.now()
    cooldown_minutes = 15
    
    # 1. 쿨타임 체크
    if user_id in _user_cooldowns:
        last_time = _user_cooldowns[user_id]
        diff = now - last_time
        
        if diff < timedelta(minutes=cooldown_minutes):
            remaining = timedelta(minutes=cooldown_minutes) - diff
            rem_min, rem_sec = divmod(remaining.seconds, 60)
            
            return {
                "status": "cooldown",
                "message": f"자주 확인하면 부정탑니다. 남은 시간: {rem_min}분"
            }

    # 2. 실행 처리 (시간 갱신)
    _user_cooldowns[user_id] = now
    
    # 3. 결과 생성
    fortune = get_fortune_result()
    place = get_recommend_place()
    
    return {
        "status": "success",
        "fortune_grade": fortune['grade'],
        "fortune_msg": fortune['msg'],
        "recommend_place": place
    }