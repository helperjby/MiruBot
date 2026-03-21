// ==========================================================
// 📋 채팅봇 버전 관리
// ==========================================================
// v1.0.0  2026-03-18  최초 구성 (경험치, 레벨, 추천/비추천, 닉네임 히스토리)
// v1.1.0  2026-03-19  이벤트 핸들러 try-catch 추가 (크래시 방지)
// v1.2.0  2026-03-19  !커뮤니티 명령어 추가 (정보/추천/비추 on/off 토글)
// v1.3.0  2026-03-20  전체 최적화
//   - Date 유틸 통합 (formatDate/formatDateTime), onMessage 내 Date 객체 1회 생성
//   - findUser 정규화 맵 사전 구축으로 반복 replace 제거
//   - 채팅 카운트를 comm_db._meta에 통합 (countCache/saveCounters/COUNT_FILE 제거)
//   - indexOf → includes 전환, JSON compact 저장, 레거시 마이그레이션 코드 제거
// ==========================================================

const bot = BotManager.getCurrentBot();

// --- 👑 관리자 해시 설정 (하드코딩) ---
const ADMIN_HASHES = [
    "e5a0e976d576",
    "94c9c06f8ad5",
    "fe711d5acfa6"
];

// --- 🚫 추천/비추천 사용 금지 해시 목록 ---
const VOTE_BLOCKED_HASHES = [
    // "차단할유저해시값을여기에입력"
];

// --- 🌟 커뮤니티 설정 변수 ---
const MAX_UPVOTES_PER_DAY = 1;   // 하루에 가능한 추천 횟수
const MAX_DOWNVOTES_PER_DAY = 1; // 하루에 가능한 비추천 횟수

// --- 커뮤니티 명령어 목록 (함수 외부 상수) ---
const COMMUNITY_COMMANDS = ["정보", "추천", "비추"];

// --- 파일 경로 설정 ---
const CONFIG_PATH = "sdcard/bot/active_rooms.json";
const COMM_SETTINGS_FILE = "sdcard/bot/comm_settings.json";

// --- 전역 인메모리 캐시 ---
let commCache = {};
let commSettings = null;
let activeRoomsCache = null;
let nickHistoryCache = {};

// ==========================================================
// 🛠️ 기본 헬퍼 함수
// ==========================================================
function truncHash(h) {
    return h ? h.substring(0, 12) : null;
}

function isAdmin(hash) {
    return !!hash && ADMIN_HASHES.includes(truncHash(hash));
}

function getActiveRooms() {
    if (activeRoomsCache !== null) return activeRoomsCache;
    let data = FileStream.read(CONFIG_PATH);
    if (!data) { activeRoomsCache = []; return []; }
    try { activeRoomsCache = JSON.parse(data); } catch(e) { activeRoomsCache = []; }
    return activeRoomsCache;
}

function saveActiveRooms(rooms) {
    activeRoomsCache = rooms;
    FileStream.write(CONFIG_PATH, JSON.stringify(rooms));
}

// --- 날짜/시간 유틸 (Date 객체를 받아 재사용) ---
function formatDate(d) {
    let y = d.getFullYear();
    let m = ("0" + (d.getMonth() + 1)).slice(-2);
    let day = ("0" + d.getDate()).slice(-2);
    return y + "-" + m + "-" + day;
}

function formatDateTime(d) {
    let h = ("0" + d.getHours()).slice(-2);
    let min = ("0" + d.getMinutes()).slice(-2);
    let s = ("0" + d.getSeconds()).slice(-2);
    return formatDate(d) + " " + h + ":" + min + ":" + s;
}

// --- 닉네임 히스토리 (채널 기반 + 인메모리 캐시) ---
function getNickHistoryPath(channelId) {
    return "sdcard/bot/nick_history_" + String(channelId) + ".json";
}

function getNickHistory(channelId) {
    let chIdStr = String(channelId);
    if (nickHistoryCache[chIdStr]) return nickHistoryCache[chIdStr];

    let path = getNickHistoryPath(chIdStr);
    let data = FileStream.read(path);

    if (data) {
        try { nickHistoryCache[chIdStr] = JSON.parse(data); }
        catch(e) { nickHistoryCache[chIdStr] = {}; }
    } else {
        nickHistoryCache[chIdStr] = {};
    }
    return nickHistoryCache[chIdStr];
}

function saveNickHistory(channelId) {
    let chIdStr = String(channelId);
    FileStream.write(getNickHistoryPath(chIdStr), JSON.stringify(nickHistoryCache[chIdStr]));
}

// ==========================================================
// 🌟 커뮤니티 헬퍼 함수
// ==========================================================
function getCommSettings() {
    if (!commSettings) {
        let data = FileStream.read(COMM_SETTINGS_FILE);
        try { commSettings = data ? JSON.parse(data) : { voteReplyRooms: [] }; }
        catch(e) { commSettings = { voteReplyRooms: [] }; }
    }
    return commSettings;
}

function saveCommSettings() {
    FileStream.write(COMM_SETTINGS_FILE, JSON.stringify(commSettings));
}

function getCommDb(channelId) {
    let chIdStr = String(channelId);
    if (!commCache[chIdStr]) {
        let path = "sdcard/bot/comm_db_" + chIdStr + ".json";
        let data = FileStream.read(path);
        try { commCache[chIdStr] = data ? JSON.parse(data) : {}; }
        catch (e) { commCache[chIdStr] = {}; }
    }
    return commCache[chIdStr];
}

function saveCommDb(channelId) {
    let chIdStr = String(channelId);
    let path = "sdcard/bot/comm_db_" + chIdStr + ".json";
    FileStream.write(path, JSON.stringify(commCache[chIdStr]));
}

// --- 채팅 카운트 메타 (comm_db 내 _meta 키로 통합) ---
function getChannelMeta(channelId) {
    let db = getCommDb(channelId);
    if (!db._meta) db._meta = { date: "", msgCount: 0, saveCounter: 0 };
    return db._meta;
}

function getXpForNextLevel(level) { return (level * 200) + 50; }

function createProgressBar(current, max) {
    let percentage = (max > 0) ? (current / max) : 0;
    let filledCount = Math.round(percentage * 10);
    return '■'.repeat(filledCount) + '□'.repeat(10 - filledCount);
}

// --- findUser: 정규화 맵을 사전 구축하여 반복 replace 제거 ---
function findUser(channelId, searchName) {
    let db = getCommDb(channelId);
    let history = getNickHistory(channelId);
    let normSearch = searchName.replace(/\s/g, "");

    // 해시값 직접 매칭
    if (db[searchName]) return { hash: searchName, data: db[searchName] };

    // 정규화된 현재 이름 맵 구축 (1회)
    let normNameMap = {};
    for (let h in db) {
        if (h === "_meta" || !db[h].name) continue;
        normNameMap[h] = db[h].name.replace(/\s/g, "");
    }

    // 1단계: 현재 닉네임 정확 일치
    for (let h in normNameMap) {
        if (normNameMap[h] === normSearch) return { hash: h, data: db[h] };
    }

    // 2단계: 현재 닉네임 부분 일치
    for (let h in normNameMap) {
        if (normNameMap[h].includes(normSearch)) return { hash: h, data: db[h] };
    }

    // 정규화된 히스토리 맵 구축 (1회)
    let normHistMap = {};
    for (let h in history) {
        if (!db[h]) continue;
        normHistMap[h] = history[h].map(function(item) {
            return ((typeof item === "string") ? item : item.name).replace(/\s/g, "");
        });
    }

    // 3단계: 닉네임 히스토리 정확 일치
    for (let h in normHistMap) {
        if (normHistMap[h].some(function(n) { return n === normSearch; })) {
            return { hash: h, data: db[h] };
        }
    }

    // 4단계: 닉네임 히스토리 부분 일치
    for (let h in normHistMap) {
        if (normHistMap[h].some(function(n) { return n.includes(normSearch); })) {
            return { hash: h, data: db[h] };
        }
    }

    return null;
}

// ==========================================================
// 💬 명령어 핸들러 (API2)
// ==========================================================
function onCommand(cmd) {
    try {
    let chIdStr = String(cmd.channelId);
    let cmdHash = truncHash(cmd.author.hash);

    if (cmd.command === "활성화") {
        if (!isAdmin(cmdHash)) return cmd.reply("❌ 관리자만 사용할 수 있는 명령어입니다.");
        let rooms = getActiveRooms();
        if (!rooms.includes(cmd.room)) {
            rooms.push(cmd.room);
            saveActiveRooms(rooms);
            Log.i("[채팅봇] 방 활성화: " + cmd.room + " (by " + cmd.author.name + ")");
            cmd.reply("✅ [" + cmd.room + "] 활성화 완료");
        } else cmd.reply("이미 활성화된 방입니다.");
        return;
    }
    if (cmd.command === "비활성화") {
        if (!isAdmin(cmdHash)) return cmd.reply("❌ 관리자만 사용할 수 있는 명령어입니다.");
        let rooms = getActiveRooms();
        let index = rooms.indexOf(cmd.room);
        if (index !== -1) {
            rooms.splice(index, 1);
            saveActiveRooms(rooms);
            Log.i("[채팅봇] 방 비활성화: " + cmd.room + " (by " + cmd.author.name + ")");
            cmd.reply("❌ [" + cmd.room + "] 비활성화 완료");
        } else cmd.reply("활성화되지 않은 방입니다.");
        return;
    }

    let activeRooms = getActiveRooms();
    if (!activeRooms.includes(cmd.room)) return;

    if (cmd.command === "커뮤니티") {
        if (!isAdmin(cmdHash)) return cmd.reply("❌ 관리자만 사용할 수 있는 명령어입니다.");
        let settings = getCommSettings();
        if (!settings.communityDisabledRooms) settings.communityDisabledRooms = [];
        let idx = settings.communityDisabledRooms.indexOf(chIdStr);
        if (idx > -1) {
            settings.communityDisabledRooms.splice(idx, 1);
            cmd.reply("✅ 커뮤니티 명령어(정보/추천/비추)가 활성화되었습니다.");
        } else {
            settings.communityDisabledRooms.push(chIdStr);
            cmd.reply("🚫 커뮤니티 명령어(정보/추천/비추)가 비활성화되었습니다.");
        }
        saveCommSettings();
        return;
    }

    if (cmd.command === "추천알람") {
        if (!isAdmin(cmdHash)) return cmd.reply("❌ 관리자만 사용할 수 있는 명령어입니다.");
        let settings = getCommSettings();
        let idx = settings.voteReplyRooms.indexOf(chIdStr);
        if (idx > -1) {
            settings.voteReplyRooms.splice(idx, 1);
            cmd.reply("🚫 추천/비추천 알림이 비활성화되었습니다.");
        } else {
            settings.voteReplyRooms.push(chIdStr);
            cmd.reply("✅ 추천/비추천 알림이 활성화되었습니다.");
        }
        saveCommSettings();
        return;
    }

    // --- 커뮤니티 명령어 비활성화 체크 ---
    if (COMMUNITY_COMMANDS.includes(cmd.command)) {
        let _cs = getCommSettings();
        if (_cs.communityDisabledRooms && _cs.communityDisabledRooms.includes(chIdStr)) return;
    }

    // 3. 유저 정보 조회
    if (cmd.command === "정보") {
        let targetName = cmd.args.join(" ");
        let userHash = cmdHash;
        let found = null;

        if (!targetName) {
            let db = getCommDb(chIdStr);
            if (db[userHash]) found = { hash: userHash, data: db[userHash] };
        } else {
            found = findUser(chIdStr, targetName);
        }

        if (!found) return cmd.reply("❌ 정보가 등록되지 않았거나 검색되지 않습니다.");

        let u = found.data;
        let reqXp = getXpForNextLevel(u.level);
        let pop = (u.upvotes || 0) - (u.downvotes || 0);
        let lastSeenDate = u.lastSeen || "기록 없음";

        let reply = "📊 lv" + u.level + " " + u.name + " 님의 정보\n━━━━━━━━━━━━━━\n";
        let viewMore = "\u200b".repeat(500);
        reply += viewMore + "\n";
        reply += "⚜️ 경험치 : " + u.xp + " / " + reqXp + " (누적: " + (u.totalXp || 0) + ")\n";
        reply += "🌟 인기도 : " + pop + " (👍" + (u.upvotes||0) + " / 👎" + (u.downvotes||0) + ")\n";
        reply += "🗓️ 마지막 채팅 : " + lastSeenDate + "\n";

        let hist = getNickHistory(chIdStr)[found.hash];
        if (hist && hist.length > 0) {
            reply += "\n📜 닉네임 변경 내역\n";
            let reversedHist = hist.slice().reverse();
            let recentHist = reversedHist.slice(0, 5);

            for (let i = 0; i < recentHist.length; i++) {
                let hItem = recentHist[i];
                if (typeof hItem === "string") {
                    reply += "* " + hItem + "  (날짜 없음)\n";
                } else {
                    reply += "* " + hItem.name + "  " + hItem.date + "\n";
                }
            }
        }
        cmd.reply(reply.trim());
        return;
    }

    if (cmd.command === "정보입력") {
        let rawArgs = cmd.args.join(" ");
        let parts = rawArgs.split(",");
        if (parts.length < 2) return cmd.reply("❌ 사용법: !정보입력 [닉네임], [특징 내용]");

        let targetName = parts[0].trim();
        let feature = parts.slice(1).join(",").trim();

        let found = findUser(chIdStr, targetName);
        if (!found) return cmd.reply("❌ 대상 유저를 찾을 수 없습니다.");
        if (found.hash === cmdHash) return cmd.reply("❌ 자신의 특징은 스스로 추가할 수 없습니다.");

        let u = found.data;
        if (!u.features) u.features = [];
        if (u.features.includes(feature)) return cmd.reply("❌ 이미 등록된 특징입니다.");

        u.features.push(feature);
        saveCommDb(chIdStr);
        cmd.reply("✅ [" + u.name + "] 님에게 '" + feature + "' 특징 추가 완료!");
        return;
    }

    // 5. 추천 / 비추천 시스템
    if (cmd.command === "추천" || cmd.command === "비추") {
        let targetName = cmd.args.join(" ");
        if (!targetName) return cmd.reply("❌ 사용법: !" + cmd.command + " [닉네임]");

        if (VOTE_BLOCKED_HASHES.includes(cmdHash)) {
            return cmd.reply("❌ 추천/비추천 사용이 제한된 계정입니다.");
        }

        let db = getCommDb(chIdStr);
        let commander = db[cmdHash];
        if (!commander) return cmd.reply("❌ 정보가 없습니다. (채팅을 한 번 이상 치면 활성화됩니다.)");

        let found = findUser(chIdStr, targetName);
        if (!found) return cmd.reply("❌ 대상 유저를 찾을 수 없습니다.");
        if (found.hash === cmdHash) return cmd.reply("❌ 자신에게는 투표할 수 없습니다.");

        let targetUser = found.data;
        let today = formatDate(new Date());
        let isUpvote = (cmd.command === "추천");

        if (commander.upvoteDate !== today) {
            commander.upvoteDate = today;
            commander.upvoteCount = 0;
        }
        if (commander.downvoteDate !== today) {
            commander.downvoteDate = today;
            commander.downvoteCount = 0;
        }

        if (isUpvote) {
            if (commander.upvoteCount >= MAX_UPVOTES_PER_DAY) {
                return cmd.reply("⏳ 오늘의 추천 횟수(" + MAX_UPVOTES_PER_DAY + "회)를 모두 사용했습니다.");
            }
            targetUser.upvotes = (targetUser.upvotes || 0) + 1;
            commander.upvoteCount++;
        } else {
            if (commander.downvoteCount >= MAX_DOWNVOTES_PER_DAY) {
                return cmd.reply("⏳ 오늘의 비추천 횟수(" + MAX_DOWNVOTES_PER_DAY + "회)를 모두 사용했습니다.");
            }
            targetUser.downvotes = (targetUser.downvotes || 0) + 1;
            commander.downvoteCount++;
        }

        saveCommDb(chIdStr);

        let settings = getCommSettings();
        if (settings.voteReplyRooms.includes(chIdStr)) {
            cmd.reply("✅ [" + targetUser.name + "] 님을 " + (isUpvote ? "추천" : "비추천") + " 했습니다.");
        }
        return;
    }
    } catch (e) {
        Log.e("[채팅봇] onCommand 오류 (!" + cmd.command + "): " + String(e));
    }
}

// ==========================================================
// 🔔 메시지 핸들러 (API2)
// ==========================================================
function onMessage(msg) {
    try {
        let activeRooms = getActiveRooms();
        if (!activeRooms.includes(msg.room)) return;

        let hash = truncHash(msg.author.hash);
        let currentName = msg.author.name;
        let chIdStr = String(msg.channelId);

        if (!hash) return;

        // Date 객체 1회 생성, 날짜/시간 모두 파생
        let now = new Date();
        let todayStr = formatDate(now);
        let dateTimeStr = formatDateTime(now);

        // 1. 닉네임 로직
        let historyObj = getNickHistory(chIdStr);
        if (!historyObj[hash]) historyObj[hash] = [];
        let len = historyObj[hash].length;

        let lastRecordedName = "";
        if (len > 0) {
            let lastItem = historyObj[hash][len - 1];
            lastRecordedName = (typeof lastItem === "string") ? lastItem : lastItem.name;
        }

        if (len === 0 || lastRecordedName !== currentName) {
            historyObj[hash].push({ name: currentName, date: todayStr });
            saveNickHistory(chIdStr);
        }

        // 2. XP 및 유저 정보 업데이트 로직
        let cDb = getCommDb(chIdStr);
        let user = cDb[hash];
        if (!user) {
            user = {
                name: currentName, xp: 0, totalXp: 0, level: 1,
                upvotes: 0, downvotes: 0, features: [],
                lastSeen: dateTimeStr
            };
            cDb[hash] = user;
        } else {
            user.name = currentName;
            user.lastSeen = dateTimeStr;
        }

        let content = msg.content;
        let bonusXp = 0;

        if (content.includes("선착순 선물게임을 시작합니다!")) {
            let match = content.match(/선착순\s*(\d+)명에게!/);
            if (match && match[1]) bonusXp = parseInt(match[1], 10) * 20;
        }
        else if (content.includes("퀴즈 선물게임을 시작합니다!")) {
            let match = content.match(/정답자\s*(\d+)명에게!/);
            if (match && match[1]) bonusXp = parseInt(match[1], 10) * 20;
        }

        user.xp += (1 + bonusXp);
        if (!user.totalXp) user.totalXp = 0;
        user.totalXp += (1 + bonusXp);
        let leveledUp = false;

        while (user.xp >= getXpForNextLevel(user.level)) {
            user.xp -= getXpForNextLevel(user.level);
            user.level++;
            leveledUp = true;
        }

        // 3. 채팅 카운트 (comm_db._meta 통합)
        let meta = getChannelMeta(chIdStr);
        if (meta.date !== todayStr) {
            meta.date = todayStr;
            meta.msgCount = 0;
        }
        meta.msgCount++;
        meta.saveCounter++;

        if (meta.saveCounter >= 10 || leveledUp || bonusXp > 0) {
            meta.saveCounter = 0;
            saveCommDb(chIdStr);
        }

        if (meta.msgCount > 0 && meta.msgCount % 100 === 0) {
            msg.reply("오늘 " + meta.msgCount + "번째 채팅 돌파!");
        }

    } catch (e) {
        Log.e("[채팅봇] onMessage 오류: " + String(e));
    }
}

bot.addListener(Event.COMMAND, onCommand);
bot.addListener(Event.MESSAGE, onMessage);
bot.setCommandPrefix("!");
Log.i("[채팅봇] v1.3.0 로드 완료.");