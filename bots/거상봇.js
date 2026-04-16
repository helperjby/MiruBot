/**
 * 거상봇 v2.3
 * - 환경: MessengerBot R (API2) - v0.7.41-alpha 이상
 *
 * 기능
 * 1. 사통팔달: 채팅 감지 시 서버에서 신규 데이터 가져와 전송 (자동)
 * 2. 육의전: 아이템 검색 및 알람 명령어
 * 3. 메모: 유저별 메모 저장/조회/삭제 (로컬 JSON)
 * 4. 퀘스트 정보: gersangjjang.com 파싱 결과(JSON 번들)를 로컬에서 조회
 *
 * 명령어
 * - !육의전 <이름>: DB에서 아이템 검색
 * - !알람등록 <이름>: 신규 아이템 알람 등록 (유저별)
 * - !알람해제 <이름>: 본인의 해당 키워드 알람 해제
 * - !알람해제 <번호>: 해당 번호 유저의 알람 전체 해제
 * - !알람목록: 유저별 그룹핑된 알람 리스트
 * - !메모 <내용>: 메모 저장 후 목록 표시
 * - !메모: 본인 메모 목록 조회
 * - !메모삭제 <번호>: 해당 번호 메모 삭제
 * - !퀘스트: 카테고리 목록 및 사용법
 * - !퀘스트 목록 [카테고리]: 전체 또는 카테고리별 퀘스트 이름 나열
 * - !퀘스트 주간: 주간-일반 (/quest/week.asp)
 * - !퀘스트 일일: 일일-우호도 (/quest/date2.asp)
 * - !퀘스트 <이름>: 해당 퀘스트 상세 (부분 일치 시 후보 표시)
 */

/* ==================== 전역 상수/변수 ==================== */

const bot = BotManager.getCurrentBot();
const Jsoup = org.jsoup.Jsoup;
const Thread = java.lang.Thread;
const File = java.io.File;

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

/* ==================== 메모 (로컬 JSON) ==================== */

const MEMO_FILE = "sdcard/msgbot/Bots/거상봇/memo.json";

function loadMemos() {
    try {
        let file = new File(MEMO_FILE);
        if (!file.exists()) return {};
        let reader = new java.io.BufferedReader(new java.io.FileReader(file));
        let sb = new java.lang.StringBuilder();
        let line;
        while ((line = reader.readLine()) !== null) {
            sb.append(line);
        }
        reader.close();
        return JSON.parse(String(sb.toString()));
    } catch (e) {
        Log.e("[거상봇] loadMemos 오류: " + e);
        return {};
    }
}

function saveMemos(data) {
    try {
        let file = new File(MEMO_FILE);
        let fos = new java.io.FileOutputStream(file);
        try {
            let bytes = new java.lang.String(JSON.stringify(data)).getBytes("UTF-8");
            fos.write(bytes);
        } finally {
            fos.close();
        }
    } catch (e) {
        Log.e("[거상봇] saveMemos 오류: " + e);
    }
}

/**
 * KST 날짜를 "YYMMDD HH:MM:SS" 형식으로 포맷
 */
function formatMemoDate(dateStr) {
    // dateStr: "2026-04-03 13:45:17" 또는 ISO 형식
    let d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    let yy = String(d.getFullYear()).substring(2);
    let MM = String(d.getMonth() + 1).padStart(2, "0");
    let dd = String(d.getDate()).padStart(2, "0");
    let hh = String(d.getHours()).padStart(2, "0");
    let mm = String(d.getMinutes()).padStart(2, "0");
    let ss = String(d.getSeconds()).padStart(2, "0");
    return yy + MM + dd + " " + hh + ":" + mm + ":" + ss;
}

/**
 * 메모 목록 포맷팅
 */
function formatMemoList(memos, userName) {
    if (!memos || memos.length === 0) {
        return "등록된 메모가 없습니다.";
    }

    let msg = "📝 " + userName + "님의 메모입니다.\n";
    msg += "\u200b".repeat(500) + "\n";

    for (let i = 0; i < memos.length; i++) {
        let m = memos[i];
        msg += (i + 1) + ". " + m.content + "\n";
        msg += formatMemoDate(m.created_at) + "\n";
    }

    return msg.trim();
}

/**
 * !메모 [내용] - 메모 저장 또는 조회
 */
function handleMemo(cmd) {
    let userHash = cmd.author.hash ? cmd.author.hash.substring(0, 12) : "";
    let userName = cmd.author.name || "";
    let channelId = String(cmd.channelId);
    let key = channelId + "_" + userHash;

    let allMemos = loadMemos();
    if (!allMemos[key]) allMemos[key] = [];

    if (cmd.args.length > 0) {
        let content = cmd.args.join(" ");
        let now = new Date();
        let kstStr = now.getFullYear() + "-"
            + String(now.getMonth() + 1).padStart(2, "0") + "-"
            + String(now.getDate()).padStart(2, "0") + " "
            + String(now.getHours()).padStart(2, "0") + ":"
            + String(now.getMinutes()).padStart(2, "0") + ":"
            + String(now.getSeconds()).padStart(2, "0");

        allMemos[key].push({ content: content, created_at: kstStr });
        saveMemos(allMemos);
        cmd.reply("메모가 저장되었습니다. (" + allMemos[key].length + "건)");
        return;
    }

    cmd.reply(formatMemoList(allMemos[key], userName));
}

/**
 * !메모삭제 <번호> - 메모 삭제
 */
function handleMemoDelete(cmd) {
    if (cmd.args.length === 0 || !/^\d+$/.test(cmd.args[0])) {
        cmd.reply("사용법: !메모삭제 <번호>");
        return;
    }

    let index = parseInt(cmd.args[0], 10);
    let userHash = cmd.author.hash ? cmd.author.hash.substring(0, 12) : "";
    let userName = cmd.author.name || "";
    let channelId = String(cmd.channelId);
    let key = channelId + "_" + userHash;

    let allMemos = loadMemos();
    if (!allMemos[key] || allMemos[key].length === 0) {
        cmd.reply("등록된 메모가 없습니다.");
        return;
    }

    if (index < 1 || index > allMemos[key].length) {
        cmd.reply("유효한 번호를 입력해주세요. (1~" + allMemos[key].length + ")");
        return;
    }

    allMemos[key].splice(index - 1, 1);
    saveMemos(allMemos);

    if (allMemos[key].length === 0) {
        cmd.reply("메모가 모두 삭제되었습니다.");
    } else {
        cmd.reply(formatMemoList(allMemos[key], userName));
    }
}

/* ==================== 퀘스트 정보 (로컬 JSON) ==================== */

const QUEST_FILE = "sdcard/msgbot/Bots/거상봇/quests.json";

let _questCache = null;       // 파싱된 데이터 캐시
let _questLoadFailed = false; // 최초 로드 실패 여부 (재시도 방지)

/**
 * quests.json 을 최초 1회 로드하여 메모리에 캐시한다.
 * @returns {object|null}
 */
function loadQuestData() {
    if (_questCache) return _questCache;
    if (_questLoadFailed) return null;

    try {
        let file = new File(QUEST_FILE);
        if (!file.exists()) {
            Log.e("[거상봇] quests.json 파일 없음: " + QUEST_FILE);
            _questLoadFailed = true;
            return null;
        }
        let reader = new java.io.BufferedReader(
            new java.io.InputStreamReader(
                new java.io.FileInputStream(file), "UTF-8"));
        let sb = new java.lang.StringBuilder();
        let line;
        while ((line = reader.readLine()) !== null) {
            sb.append(line);
            sb.append("\n");
        }
        reader.close();

        _questCache = JSON.parse(String(sb.toString()));
        Log.i("[거상봇] quests.json 로드 완료: " + _questCache.total + "건");
        return _questCache;
    } catch (e) {
        Log.e("[거상봇] loadQuestData 오류: " + e);
        _questLoadFailed = true;
        return null;
    }
}

/**
 * 숫자 포맷 (12345 → "12,345")
 */
function formatInt(n) {
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * 보상 객체를 한 줄로 포맷팅
 */
function formatRewards(r) {
    if (!r) return "";
    let parts = [];
    if (r.coin) parts.push("동전 " + r.coin);
    if (r.exp) parts.push("경험치 " + formatInt(r.exp));
    if (r.credit) parts.push("신용도 " + formatInt(r.credit));
    if (r.contrib) parts.push("기여도 +" + r.contrib);
    if (r.items && r.items.length > 0) {
        parts.push(r.items.join(", "));
    }
    return parts.join(" | ");
}

/**
 * step-row 포맷 퀘스트 렌더링
 */
function renderStepRowQuest(quest) {
    let msg = "🗺️ " + quest.label + "  [" + quest.category + "]\n";
    msg += quest.url + "\n";
    msg += "━━━━━━━━━━━━━━━\n";
    msg += "\u200b".repeat(500) + "\n";

    let containers = quest.containers || [];
    for (let i = 0; i < containers.length; i++) {
        let c = containers[i];
        if (c.title) {
            msg += "\n■ " + c.title + "\n";
        }
        if (c.top_desc) {
            msg += c.top_desc + "\n";
        }

        let groups = c.groups || [];
        for (let g = 0; g < groups.length; g++) {
            let group = groups[g];
            if (group.header) {
                msg += "\n▸ " + group.header + "\n";
            }
            let steps = group.steps || [];
            for (let s = 0; s < steps.length; s++) {
                let step = steps[s];
                let stepLabel = step.step ? "[" + step.step + "] " : "";
                msg += stepLabel + step.monster.replace(/\n/g, " ") + "\n";
                let rewardLine = formatRewards(step.rewards);
                if (rewardLine) {
                    msg += "  → " + rewardLine + "\n";
                }
            }
        }
    }

    return msg.trim();
}

/**
 * raw 포맷 퀘스트 렌더링
 */
function renderRawQuest(quest) {
    let msg = "🗺️ " + quest.label + "  [" + quest.category + "]\n";
    msg += quest.url + "\n";
    msg += "━━━━━━━━━━━━━━━\n";
    msg += "\u200b".repeat(500) + "\n";
    msg += quest.raw_text || "(내용 없음)";
    return msg;
}

/**
 * 퀘스트 이름으로 후보 검색 (alias → 완전일치 → 부분일치)
 * @returns {object} { exact: string|null, candidates: string[] }
 */
function lookupQuest(data, input) {
    let name = String(input).trim();
    if (!name) return { exact: null, candidates: [] };

    // 1. alias
    if (data.aliases && data.aliases[name]) {
        return { exact: data.aliases[name], candidates: [] };
    }
    // 2. 완전 일치
    if (data.quests[name]) {
        return { exact: name, candidates: [] };
    }
    // 3. 부분 일치
    let keys = Object.keys(data.quests);
    let matches = [];
    for (let i = 0; i < keys.length; i++) {
        if (keys[i].indexOf(name) !== -1) {
            matches.push(keys[i]);
        }
    }
    if (matches.length === 1) {
        return { exact: matches[0], candidates: [] };
    }
    return { exact: null, candidates: matches };
}

/**
 * !퀘스트 (인자 없음) - 카테고리 요약과 사용법 안내
 */
function handleQuestRoot(cmd, data) {
    let catKeys = Object.keys(data.categories);
    let msg = "🗺️ 거상 퀘스트 정보 (" + data.total + "건)\n";
    msg += "━━━━━━━━━━━━━━━\n";
    for (let i = 0; i < catKeys.length; i++) {
        let k = catKeys[i];
        msg += "  " + k + ": " + data.categories[k].length + "개\n";
    }
    msg += "\n사용법:\n";
    msg += "  !퀘스트 주간 / 일일\n";
    msg += "  !퀘스트 목록 [카테고리]\n";
    msg += "  !퀘스트 <이름>\n";
    msg += "(출처: " + data.source + ")";
    cmd.reply(msg);
}

/**
 * !퀘스트 목록 [카테고리]
 */
function handleQuestList(cmd, data, catArg) {
    let msg;
    if (catArg && data.categories[catArg]) {
        let names = data.categories[catArg];
        msg = "🗺️ [" + catArg + "] 퀘스트 " + names.length + "개\n";
        msg += "━━━━━━━━━━━━━━━\n";
        msg += "\u200b".repeat(500) + "\n";
        for (let i = 0; i < names.length; i++) {
            msg += "- " + names[i] + "\n";
        }
    } else {
        msg = "🗺️ 전체 퀘스트 목록 (" + data.total + "건)\n";
        msg += "━━━━━━━━━━━━━━━\n";
        msg += "\u200b".repeat(500) + "\n";
        let catKeys = Object.keys(data.categories);
        for (let i = 0; i < catKeys.length; i++) {
            let k = catKeys[i];
            let names = data.categories[k];
            msg += "\n■ " + k + " (" + names.length + "개)\n";
            for (let j = 0; j < names.length; j++) {
                msg += "- " + names[j] + "\n";
            }
        }
        if (catArg) {
            msg += "\n(카테고리 '" + catArg + "' 없음 — 전체 출력)";
        }
    }
    cmd.reply(msg.trim());
}

/**
 * !퀘스트 <이름> - 상세 출력 or 후보 안내
 */
function handleQuestDetail(cmd, data, name) {
    let r = lookupQuest(data, name);
    if (!r.exact) {
        if (r.candidates.length === 0) {
            cmd.reply("'" + name + "' 에 해당하는 퀘스트를 찾지 못했습니다.\n!퀘스트 목록 으로 이름을 확인해주세요.");
        } else {
            let msg = "'" + name + "' 부분 일치 " + r.candidates.length + "건:\n";
            for (let i = 0; i < r.candidates.length && i < 20; i++) {
                msg += "- " + r.candidates[i] + "\n";
            }
            if (r.candidates.length > 20) {
                msg += "... 외 " + (r.candidates.length - 20) + "건";
            }
            cmd.reply(msg.trim());
        }
        return;
    }

    let quest = data.quests[r.exact];
    let rendered;
    if (quest.format === "step-row") {
        rendered = renderStepRowQuest(quest);
    } else {
        rendered = renderRawQuest(quest);
    }
    cmd.reply(rendered);
}

/**
 * !퀘스트 명령어 메인 디스패처
 */
function handleQuestCommand(cmd) {
    new Thread(function () {
        try {
            let data = loadQuestData();
            if (!data) {
                cmd.reply("퀘스트 데이터를 불러오지 못했습니다.\n(" + QUEST_FILE + ")");
                return;
            }

            if (cmd.args.length === 0) {
                handleQuestRoot(cmd, data);
                return;
            }

            let first = cmd.args[0];
            if (first === "목록") {
                let cat = cmd.args.length > 1 ? cmd.args[1] : null;
                handleQuestList(cmd, data, cat);
                return;
            }

            // 그 외: 전체 args 를 공백으로 이어붙여 퀘스트 이름으로 조회
            let name = cmd.args.join(" ");
            handleQuestDetail(cmd, data, name);
        } catch (e) {
            Log.e("[거상봇] handleQuestCommand 오류: " + e);
            cmd.reply("퀘스트 조회 중 오류가 발생했습니다.");
        }
    }).start();
}

/* ==================== 이벤트 리스너 ==================== */

bot.setCommandPrefix("!");

bot.addListener(Event.COMMAND, function (cmd) {
    if (!TARGET_ROOM_IDS.includes(String(cmd.channelId))) return;
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
        case "메모":
            handleMemo(cmd);
            break;
        case "메모삭제":
            handleMemoDelete(cmd);
            break;
        case "퀘스트":
            handleQuestCommand(cmd);
            break;
    }
});

bot.addListener(Event.MESSAGE, function (msg) {
    checkAndSendSatong(msg);
    checkAndSendYukNotifications(msg);
});

Log.i("--- 거상봇 v2.3 로드됨 ---");
