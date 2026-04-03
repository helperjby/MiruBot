/**
 * 거상봇 v2.1
 * - 환경: MessengerBot R (API2) - v0.7.41-alpha 이상
 *
 * 기능
 * 1. 사통팔달: 채팅 감지 시 서버에서 신규 데이터 가져와 전송 (자동)
 * 2. 육의전: 아이템 검색 및 알람 명령어
 *
 * 명령어
 * - !육의전 <이름>: DB에서 아이템 검색
 * - !알람등록 <이름>: 신규 아이템 알람 등록 (유저별)
 * - !알람해제 <이름>: 본인의 해당 키워드 알람 해제
 * - !알람해제 <번호>: 해당 번호 유저의 알람 전체 해제
 * - !알람목록: 유저별 그룹핑된 알람 리스트
 */

/* ==================== 전역 상수/변수 ==================== */

const bot = BotManager.getCurrentBot();
const Jsoup = org.jsoup.Jsoup;
const Thread = java.lang.Thread;

// --- 설정 ---
const FASTAPI_BASE_URL = "http://192.168.0.133:8080";
const SATONG_COOLDOWN_MS = 5 * 60 * 1000;     // 사통팔달 5분
const YUK_NOTIFY_COOLDOWN_MS = 5 * 60 * 1000; // 육의전 알림 5분

// 대상 채팅방 ID 리스트
const TARGET_ROOM_IDS = [
    "18478829551518149"
];

// --- 전역 변수 ---
let lastSatongFetchTime = 0;
let lastYukNotifyTime = 0;

/* ==================== HTTP 유틸 ==================== */

/**
 * FastAPI GET 요청
 * @param {string} endpoint
 * @returns {object|null}
 */
function getFromServer(endpoint) {
    try {
        let response = Jsoup.connect(FASTAPI_BASE_URL + endpoint)
            .timeout(10000)
            .ignoreContentType(true)
            .ignoreHttpErrors(true)
            .method(org.jsoup.Connection.Method.GET)
            .execute();

        if (response.statusCode() !== 200) {
            Log.e("[거상봇] GET " + endpoint + " HTTP " + response.statusCode());
            return null;
        }
        return JSON.parse(response.body());
    } catch (e) {
        Log.e("[거상봇] GET " + endpoint + " 오류: " + e);
        return null;
    }
}

/**
 * FastAPI POST/DELETE 요청 (JSON body)
 * @param {string} endpoint
 * @param {object} payload
 * @param {string} method - "POST" 또는 "DELETE"
 * @returns {object|null}
 */
function sendToServer(endpoint, payload, method) {
    try {
        let httpMethod = method === "DELETE"
            ? org.jsoup.Connection.Method.DELETE
            : org.jsoup.Connection.Method.POST;

        let response = Jsoup.connect(FASTAPI_BASE_URL + endpoint)
            .header("Content-Type", "application/json")
            .timeout(10000)
            .ignoreContentType(true)
            .ignoreHttpErrors(true)
            .requestBody(JSON.stringify(payload))
            .method(httpMethod)
            .execute();

        if (response.statusCode() !== 200) {
            Log.e("[거상봇] " + method + " " + endpoint + " HTTP " + response.statusCode());
            return null;
        }
        return JSON.parse(response.body());
    } catch (e) {
        Log.e("[거상봇] " + method + " " + endpoint + " 오류: " + e);
        return null;
    }
}

/* ==================== 사통팔달 (기존 기능) ==================== */

/**
 * 신규 사통팔달 데이터 포맷팅
 * @param {Array} entries
 * @returns {string}
 */
function formatSatongEntries(entries) {
    let msg = "📢 사통팔달 새 글 (" + entries.length + "건)\n";
    msg += "━━━━━━━━━━━━━━━\n";

    if (entries.length > 3) {
        msg += "\u200b".repeat(500) + "\n";
    }

    for (let i = 0; i < entries.length; i++) {
        let e = entries[i];
        msg += "[" + e.nick + "] " + e.content + " (" + e.time + ")\n";
    }

    return msg.trim();
}

/**
 * 채팅 감지 시 사통팔달 신규 데이터 확인 및 전송
 */
function checkAndSendSatong(msg) {
    if (!msg || msg.channelId == null) return;
    if (!TARGET_ROOM_IDS.includes(String(msg.channelId))) return;

    let now = Date.now();
    if (now - lastSatongFetchTime < SATONG_COOLDOWN_MS) return;
    lastSatongFetchTime = now;

    new Thread(function () {
        try {
            let data = getFromServer("/gersang/satong/new");
            if (!data || data.new_count === 0) return;

            let reply = formatSatongEntries(data.entries);
            bot.send(msg.room, reply);
        } catch (e) {
            Log.e("[거상봇] checkAndSendSatong 오류: " + e);
        }
    }).start();
}

/* ==================== 육의전 명령어 ==================== */

/**
 * 가격 포맷 (123456 → "123,456")
 */
function formatPrice(price) {
    return String(price).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * !육의전 <이름> - 아이템 검색
 */
function handleYukSearch(cmd) {
    if (cmd.args.length === 0) {
        cmd.reply("사용법: !육의전 <아이템이름>");
        return;
    }

    let keyword = cmd.args.join("");

    new Thread(function () {
        try {
            let data = getFromServer("/gersang/yukeuijeon/search?keyword=" + encodeURIComponent(keyword));
            if (!data) {
                cmd.reply("서버 연결에 실패했습니다.");
                return;
            }

            if (data.count === 0) {
                cmd.reply("'" + keyword + "'에 대한 검색 결과가 없습니다.");
                return;
            }

            let msg = "🏪 육의전 검색: " + keyword + " (" + data.count + "건)\n";
            msg += "━━━━━━━━━━━━━━━\n";
            msg += "\u200b".repeat(500) + "\n";

            for (let i = 0; i < data.items.length; i++) {
                let item = data.items[i];
                if (item.category === "unit") {
                    msg += item.item_name + " | Lv." + item.quantity;
                } else {
                    msg += item.item_name + " | " + item.quantity + "개";
                }
                msg += " | " + formatPrice(item.price) + "원";
                msg += " | " + item.seller + "\n";
            }

            cmd.reply(msg.trim());
        } catch (e) {
            Log.e("[거상봇] handleYukSearch 오류: " + e);
            cmd.reply("검색 중 오류가 발생했습니다.");
        }
    }).start();
}

/**
 * !알람등록 <이름> - 알람 등록 (유저별)
 */
function handleAlarmRegister(cmd) {
    if (cmd.args.length === 0) {
        cmd.reply("사용법: !알람등록 <아이템이름>");
        return;
    }

    let keyword = cmd.args.join(" ");
    let channelId = String(cmd.channelId);
    let userHash = cmd.author.hash ? cmd.author.hash.substring(0, 12) : "";
    let userName = cmd.author.name || "";

    new Thread(function () {
        try {
            let data = sendToServer("/gersang/yukeuijeon/alarm",
                { channel_id: channelId, keyword: keyword, user_hash: userHash, user_name: userName }, "POST");

            if (!data) {
                cmd.reply("서버 연결에 실패했습니다.");
                return;
            }

            cmd.reply(data.message);
        } catch (e) {
            Log.e("[거상봇] handleAlarmRegister 오류: " + e);
            cmd.reply("알람 등록 중 오류가 발생했습니다.");
        }
    }).start();
}

/**
 * !알람해제 <이름|번호> - 알람 해제
 * - 키워드: 본인의 해당 키워드만 해제
 * - 번호: 해당 번호 유저의 알람 전체 해제
 */
function handleAlarmUnregister(cmd) {
    if (cmd.args.length === 0) {
        cmd.reply("사용법: !알람해제 <아이템이름 또는 번호>");
        return;
    }

    let arg = cmd.args.join(" ");
    let channelId = String(cmd.channelId);
    let userHash = cmd.author.hash ? cmd.author.hash.substring(0, 12) : "";

    new Thread(function () {
        try {
            // 숫자인 경우: 번호로 유저 알람 전체 해제
            if (/^\d+$/.test(arg)) {
                let index = parseInt(arg, 10);

                // 먼저 알람 목록 조회하여 N번째 유저의 hash 확인
                let listData = getFromServer("/gersang/yukeuijeon/alarms?channel_id=" + encodeURIComponent(channelId));
                if (!listData || listData.count === 0) {
                    cmd.reply("등록된 알람이 없습니다.");
                    return;
                }

                if (index < 1 || index > listData.alarms.length) {
                    cmd.reply("유효한 번호를 입력해주세요. (1~" + listData.alarms.length + ")");
                    return;
                }

                let target = listData.alarms[index - 1];
                let data = sendToServer(
                    "/gersang/yukeuijeon/alarm/user?channel_id=" + encodeURIComponent(channelId)
                    + "&user_hash=" + encodeURIComponent(target.user_hash),
                    {}, "DELETE");

                if (!data) {
                    cmd.reply("서버 연결에 실패했습니다.");
                    return;
                }

                cmd.reply(target.user_name + "님의 " + data.message);
            } else {
                // 키워드인 경우: 본인의 해당 키워드만 해제
                let data = sendToServer("/gersang/yukeuijeon/alarm",
                    { channel_id: channelId, keyword: arg, user_hash: userHash }, "DELETE");

                if (!data) {
                    cmd.reply("서버 연결에 실패했습니다.");
                    return;
                }

                cmd.reply(data.message);
            }
        } catch (e) {
            Log.e("[거상봇] handleAlarmUnregister 오류: " + e);
            cmd.reply("알람 해제 중 오류가 발생했습니다.");
        }
    }).start();
}

/**
 * !알람목록 - 유저별 그룹핑된 알람 리스트
 */
function handleAlarmList(cmd) {
    let channelId = String(cmd.channelId);

    new Thread(function () {
        try {
            let data = getFromServer("/gersang/yukeuijeon/alarms?channel_id=" + encodeURIComponent(channelId));

            if (!data) {
                cmd.reply("서버 연결에 실패했습니다.");
                return;
            }

            if (data.count === 0) {
                cmd.reply("등록된 알람이 없습니다.");
                return;
            }

            // 총 키워드 수 계산
            let totalKeywords = 0;
            for (let i = 0; i < data.alarms.length; i++) {
                totalKeywords += data.alarms[i].keywords.length;
            }

            let msg = "🔔 육의전 알람 목록 (" + totalKeywords + "건)\n";
            msg += "━━━━━━━━━━━━━━━\n";

            for (let i = 0; i < data.alarms.length; i++) {
                let alarm = data.alarms[i];
                let name = alarm.user_name || "(알 수 없음)";
                msg += (i + 1) + ". " + name + ": " + alarm.keywords.join(", ") + "\n";
            }

            cmd.reply(msg.trim());
        } catch (e) {
            Log.e("[거상봇] handleAlarmList 오류: " + e);
            cmd.reply("알람 목록 조회 중 오류가 발생했습니다.");
        }
    }).start();
}

/* ==================== 육의전 알림 폴링 ==================== */

/**
 * 채팅 감지 시 육의전 알림 확인 및 전송
 */
function checkAndSendYukNotifications(msg) {
    if (!msg || msg.channelId == null) return;
    if (!TARGET_ROOM_IDS.includes(String(msg.channelId))) return;

    let now = Date.now();
    if (now - lastYukNotifyTime < YUK_NOTIFY_COOLDOWN_MS) return;
    lastYukNotifyTime = now;

    new Thread(function () {
        try {
            let data = getFromServer("/gersang/yukeuijeon/notifications");
            if (!data || data.count === 0) return;

            // 키워드별로 알림 합치기
            let merged = {};
            for (let i = 0; i < data.notifications.length; i++) {
                let n = data.notifications[i];
                let key = n.keyword_raw;
                if (!merged[key]) {
                    merged[key] = [];
                }
                for (let j = 0; j < n.matched_items.length; j++) {
                    merged[key].push(n.matched_items[j]);
                }
            }

            // 하나의 메시지로 조합
            let reply = "";
            let keys = Object.keys(merged);
            for (let k = 0; k < keys.length; k++) {
                let keyword = keys[k];
                let items = merged[keyword];
                reply += "알람 설정한 " + keyword + "이(가) 육의전에 등록됐습니다.";
                reply += "(총 " + items.length + "건)\n";
                reply += "\u200b".repeat(500) + "\n";
                for (let m = 0; m < items.length; m++) {
                    let item = items[m];
                    reply += item.seller + ", ";
                    reply += formatPrice(item.price) + "원, ";
                    if (item.category === "unit") {
                        reply += "Lv." + item.quantity + ", ";
                    } else {
                        reply += item.quantity + "개, ";
                    }
                    reply += item.registered_at + "\n";
                }
            }

            bot.send(msg.room, reply.trim());
        } catch (e) {
            Log.e("[거상봇] checkAndSendYukNotifications 오류: " + e);
        }
    }).start();
}

/* ==================== 이벤트 리스너 ==================== */

bot.setCommandPrefix("!");

bot.addListener(Event.COMMAND, function (cmd) {
    switch (cmd.command) {
        case "육의전":
            handleYukSearch(cmd);
            break;
        case "알람등록":
            handleAlarmRegister(cmd);
            break;
        case "알람해제":
            handleAlarmUnregister(cmd);
            break;
        case "알람목록":
            handleAlarmList(cmd);
            break;
    }
});

bot.addListener(Event.MESSAGE, function (msg) {
    checkAndSendSatong(msg);
    checkAndSendYukNotifications(msg);
});

Log.i("--- 거상봇 v2.0 로드됨 ---");
