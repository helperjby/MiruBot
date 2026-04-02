/**
 * 거상봇 v1.1
 * - 환경: MessengerBot R (API2) - v0.7.41-alpha 이상
 *
 * 기능
 * - 채팅 감지 시 라즈베리파이 서버에서 사통팔달 신규 데이터를 가져와 전송
 * - 스크래핑은 서버에서 5분마다 수행, 봇은 API 호출만 담당
 */

/* ==================== 전역 상수/변수 ==================== */

const bot = BotManager.getCurrentBot();
const Jsoup = org.jsoup.Jsoup;
const Thread = java.lang.Thread;

// --- 설정 ---
const FASTAPI_BASE_URL = "http://192.168.0.133:8080";
const COOLDOWN_MS = 5 * 60 * 1000; // 5분

// 대상 채팅방 ID 리스트
const TARGET_ROOM_IDS = [
    "18478829551518149"
];

// --- 전역 변수 ---
let lastFetchTime = 0;

/* ==================== 함수 ==================== */

/**
 * 서버에서 신규 사통팔달 데이터를 가져옴
 * @returns {{new_count: number, entries: Array}|null}
 */
function fetchNewSatong() {
    let response = Jsoup.connect(FASTAPI_BASE_URL + "/gersang/satong/new")
        .timeout(10000)
        .ignoreContentType(true)
        .ignoreHttpErrors(true)
        .method(org.jsoup.Connection.Method.GET)
        .execute();

    if (response.statusCode() !== 200) {
        Log.e("[거상봇] API 오류: HTTP " + response.statusCode());
        return null;
    }

    return JSON.parse(response.body());
}

/**
 * 신규 데이터를 포맷팅
 * @param {Array} entries
 * @returns {string}
 */
function formatNewEntries(entries) {
    let msg = "📢 사통팔달 새 글 (" + entries.length + "건)\n";
    msg += "━━━━━━━━━━━━━━━\n";

    for (let i = 0; i < entries.length; i++) {
        let e = entries[i];
        msg += "[" + e.nick + "] " + e.content + " (" + e.time + ")\n";
    }

    return msg.trim();
}

/**
 * 채팅 감지 시 사통팔달 신규 데이터 확인 및 전송
 * @param {object} msg 메시지 객체
 */
function checkAndSendSatong(msg) {
    if (!msg || msg.channelId == null) return;
    if (!TARGET_ROOM_IDS.includes(String(msg.channelId))) return;

    // 쿨다운 체크
    let now = Date.now();
    if (now - lastFetchTime < COOLDOWN_MS) return;
    lastFetchTime = now;

    new Thread(function () {
        try {
            let data = fetchNewSatong();
            if (!data || data.new_count === 0) return;

            let reply = formatNewEntries(data.entries);
            bot.send(msg.room, reply);
        } catch (e) {
            Log.e("[거상봇] checkAndSendSatong 오류: " + e);
        }
    }).start();
}

/* ==================== 이벤트 리스너 ==================== */

bot.addListener(Event.MESSAGE, function (msg) {
    checkAndSendSatong(msg);
});

Log.i("--- 거상봇 v1.1 로드됨 ---");
