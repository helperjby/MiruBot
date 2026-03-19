const bot = BotManager.getCurrentBot();

// --- 👑 관리자 해시 설정 (하드코딩) ---
const ADMIN_HASHES = [
    "e5a0e976d576ac81e83c32d98441d8eb1fa84fcf6598af66845ef9ae1fcede87",
    "94c9c06f8ad592f0c4bbc2d75f8567d6b0ba2e3d40f32fe41ea94711ac23f27d",
    "fe711d5acfa6e2ccf570dc0278bdb81607e63e4f17d72b0503499b7626d8c2ed"
];

// --- 🚫 추천/비추천 사용 금지 해시 목록 ---
const VOTE_BLOCKED_HASHES = [
    // "차단할유저해시값을여기에입력"
];

// --- 🌟 커뮤니티 설정 변수 ---
const MAX_UPVOTES_PER_DAY = 1;   // 하루에 가능한 추천 횟수
const MAX_DOWNVOTES_PER_DAY = 1; // 하루에 가능한 비추천 횟수

// --- 파일 경로 설정 ---
const CONFIG_PATH = "sdcard/bot/active_rooms.json";
const COUNT_FILE = "sdcard/bot/chat_counts.json";
// ⭐ [수정 #4] 닉네임 히스토리 파일 경로를 채널별로 분리 (기존 전역 파일 경로는 마이그레이션용으로 보존)
const NICK_HISTORY_FILE_LEGACY = "sdcard/bot/nickname_history.json";
const COMM_SETTINGS_FILE = "sdcard/bot/comm_settings.json";

// --- 전역 인메모리 캐시 ---
let countCache = null;
let commCache = {}; 
let saveCounters = {}; 
let commSettings = null; 
let activeRoomsCache = null;   // ⭐ [수정 #7] 활성 방 목록 캐시
let nickHistoryCache = {};     // ⭐ [수정 #6] 닉네임 히스토리 채널별 캐시

// ==========================================================
// 🛠️ 기본 헬퍼 함수
// ==========================================================
function isAdmin(hash) {
    if (!hash) return false;
    return ADMIN_HASHES.indexOf(hash) !== -1;
}

// ⭐ [수정 #7] 활성 방 목록 - 인메모리 캐시 적용
function getActiveRooms() {
    if (activeRoomsCache !== null) return activeRoomsCache;
    let data = FileStream.read(CONFIG_PATH); 
    if (!data) { activeRoomsCache = []; return []; }
    try { activeRoomsCache = JSON.parse(data); } catch(e) { activeRoomsCache = []; }
    return activeRoomsCache;
}
function saveActiveRooms(rooms) { 
    activeRoomsCache = rooms; // 캐시도 함께 갱신
    FileStream.write(CONFIG_PATH, JSON.stringify(rooms)); 
}

// 날짜 포맷 (YYYY-MM-DD) - 자정 리셋 및 기록용
function getTodayStr() {
    let d = new Date();
    let y = d.getFullYear();
    let m = ("0" + (d.getMonth() + 1)).slice(-2);
    let date = ("0" + d.getDate()).slice(-2);
    return y + "-" + m + "-" + date;
}

// ⭐ [신규] 날짜+시간 포맷 (YYYY-MM-DD HH:mm:ss) - 마지막 채팅 기록용
function getDateTimeStr() {
    let d = new Date();
    let y = d.getFullYear();
    let m = ("0" + (d.getMonth() + 1)).slice(-2);
    let date = ("0" + d.getDate()).slice(-2);
    let h = ("0" + d.getHours()).slice(-2);
    let min = ("0" + d.getMinutes()).slice(-2);
    let s = ("0" + d.getSeconds()).slice(-2);
    return y + "-" + m + "-" + date + " " + h + ":" + min + ":" + s;
}

// ⭐ [수정 #4, #6] 닉네임 히스토리 - 채널 기반 + 인메모리 캐시
// 최초 로드 시 기존 전역 파일에서 해당 채널 유저 데이터를 마이그레이션
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
        // ⭐ 마이그레이션: 채널별 파일이 없으면, 기존 전역 파일에서 해당 채널 유저만 추출
        nickHistoryCache[chIdStr] = {};
        let db = getCommDb(chIdStr); // 해당 채널에 존재하는 해시 목록
        let legacyData = FileStream.read(NICK_HISTORY_FILE_LEGACY);
        if (legacyData) {
            try {
                let legacyObj = JSON.parse(legacyData);
                for (let h in legacyObj) {
                    if (db[h]) { // 해당 채널 DB에 있는 유저만 가져옴
                        nickHistoryCache[chIdStr][h] = legacyObj[h];
                    }
                }
                // 마이그레이션 결과 즉시 저장
                FileStream.write(path, JSON.stringify(nickHistoryCache[chIdStr], null, 2));
            } catch(e) { /* 파싱 실패 시 빈 객체로 시작 */ }
        }
    }
    return nickHistoryCache[chIdStr];
}

function saveNickHistory(channelId) { 
    let chIdStr = String(channelId);
    FileStream.write(getNickHistoryPath(chIdStr), JSON.stringify(nickHistoryCache[chIdStr], null, 2)); 
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
function saveCommSettings() { FileStream.write(COMM_SETTINGS_FILE, JSON.stringify(commSettings)); }

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
    FileStream.write(path, JSON.stringify(commCache[chIdStr], null, 2));
}

function getXpForNextLevel(level) { return (level * 200) + 50; }

function createProgressBar(current, max) {
    let percentage = (max > 0) ? (current / max) : 0;
    let filledCount = Math.round(percentage * 10);
    return '■'.repeat(filledCount) + '□'.repeat(10 - filledCount);
}

// ⭐ [수정 #2] findUser - 정확 일치 우선 반환 로직 추가
function findUser(channelId, searchName) {
    let db = getCommDb(channelId);
    let history = getNickHistory(channelId); // ⭐ [수정 #4] 채널 기반
    let normSearch = searchName.replace(/\s/g, "");

    // 해시값 직접 매칭 (기존)
    if (db[searchName]) return { hash: searchName, data: db[searchName] };

    // --- [수정 #2] 1단계: 현재 닉네임 정확 일치 ---
    for (let h in db) {
        if (db[h].name && db[h].name.replace(/\s/g, "") === normSearch) {
            return { hash: h, data: db[h] };
        }
    }

    // --- [수정 #2] 2단계: 현재 닉네임 부분 일치 ---
    for (let h in db) {
        if (db[h].name && db[h].name.replace(/\s/g, "").includes(normSearch)) {
            return { hash: h, data: db[h] };
        }
    }

    // --- [수정 #2] 3단계: 닉네임 히스토리 정확 일치 ---
    for (let h in history) {
        let hasExact = history[h].some(function(item) {
            let nameStr = (typeof item === "string") ? item : item.name;
            return nameStr.replace(/\s/g, "") === normSearch;
        });
        if (hasExact && db[h]) {
            return { hash: h, data: db[h] };
        }
    }

    // --- [수정 #2] 4단계: 닉네임 히스토리 부분 일치 ---
    for (let h in history) {
        let hasMatch = history[h].some(function(item) {
            let nameStr = (typeof item === "string") ? item : item.name;
            return nameStr.replace(/\s/g, "").includes(normSearch);
        });
        if (hasMatch && db[h]) {
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

    if (cmd.command === "활성화") {
        if (!isAdmin(cmd.author.hash)) return cmd.reply("❌ 관리자만 사용할 수 있는 명령어입니다.");
        let rooms = getActiveRooms();
        if (rooms.indexOf(cmd.room) === -1) {
            rooms.push(cmd.room);
            saveActiveRooms(rooms);
            cmd.reply("✅ [" + cmd.room + "] 활성화 완료");
        } else cmd.reply("이미 활성화된 방입니다.");
        return;
    }
    if (cmd.command === "비활성화") {
        if (!isAdmin(cmd.author.hash)) return cmd.reply("❌ 관리자만 사용할 수 있는 명령어입니다.");
        let rooms = getActiveRooms();
        let index = rooms.indexOf(cmd.room);
        if (index !== -1) {
            rooms.splice(index, 1);
            saveActiveRooms(rooms);
            cmd.reply("❌ [" + cmd.room + "] 비활성화 완료");
        } else cmd.reply("활성화되지 않은 방입니다.");
        return;
    }

    let activeRooms = getActiveRooms();
    if (activeRooms.indexOf(cmd.room) === -1) return;

    if (cmd.command === "추천알람") {
        if (!isAdmin(cmd.author.hash)) return cmd.reply("❌ 관리자만 사용할 수 있는 명령어입니다.");
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

    // 3. 유저 정보 조회
    if (cmd.command === "정보") {
        let targetName = cmd.args.join(" ");
        let userHash = cmd.author.hash;
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

        // ⭐ [수정 #4] 채널 기반 닉네임 히스토리 조회
        let hist = getNickHistory(chIdStr)[found.hash];
        if (hist && hist.length > 0) {
            reply += "\n📜 닉네임 변경 내역\n";
            let reversedHist = hist.slice().reverse(); 
            let recentHist = reversedHist.slice(0, 5); 
            
            for(let i=0; i<recentHist.length; i++) { 
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
        if (found.hash === cmd.author.hash) return cmd.reply("❌ 자신의 특징은 스스로 추가할 수 없습니다.");

        let u = found.data;
        if (!u.features) u.features = [];
        if (u.features.indexOf(feature) !== -1) return cmd.reply("❌ 이미 등록된 특징입니다.");

        u.features.push(feature);
        saveCommDb(chIdStr); 
        cmd.reply("✅ [" + u.name + "] 님에게 '" + feature + "' 특징 추가 완료!");
        return;
    }

    // 5. 추천 / 비추천 시스템 (⭐ 횟수 변수 조절 방식)
    if (cmd.command === "추천" || cmd.command === "비추") {
        let targetName = cmd.args.join(" ");
        if (!targetName) return cmd.reply("❌ 사용법: !" + cmd.command + " [닉네임]");

        if (VOTE_BLOCKED_HASHES.indexOf(cmd.author.hash) !== -1) {
            return cmd.reply("❌ 추천/비추천 사용이 제한된 계정입니다.");
        }

        let db = getCommDb(chIdStr);
        let commander = db[cmd.author.hash];
        if (!commander) return cmd.reply("❌ 정보가 없습니다. (채팅을 한 번 이상 치면 활성화됩니다.)");

        let found = findUser(chIdStr, targetName);
        if (!found) return cmd.reply("❌ 대상 유저를 찾을 수 없습니다.");
        if (found.hash === cmd.author.hash) return cmd.reply("❌ 자신에게는 투표할 수 없습니다.");

        let targetUser = found.data;
        let today = getTodayStr();
        let isUpvote = (cmd.command === "추천");

        // ⭐ 이전 버전(날짜만 기록) 데이터 호환성 처리
        if (commander.lastUpvoteDate && !commander.upvoteDate) {
            commander.upvoteDate = commander.lastUpvoteDate;
            commander.upvoteCount = (commander.lastUpvoteDate === today) ? 1 : 0;
        }
        if (commander.lastDownvoteDate && !commander.downvoteDate) {
            commander.downvoteDate = commander.lastDownvoteDate;
            commander.downvoteCount = (commander.lastDownvoteDate === today) ? 1 : 0;
        }

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
        if (settings.voteReplyRooms.indexOf(chIdStr) !== -1) {
            cmd.reply("✅ [" + targetUser.name + "] 님을 " + (isUpvote ? "추천" : "비추천") + " 했습니다.");
        }
        return;
    }
    } catch (e) {
        Log.e("onCommand 오류: " + String(e));
    }
}

// ==========================================================
// 🔔 메시지 핸들러 (API2)
// ==========================================================
function onMessage(msg) { 
    try {
        let activeRooms = getActiveRooms();
        if (activeRooms.indexOf(msg.room) === -1) return;

        let hash = msg.author.hash;
        let currentName = msg.author.name;
        let chIdStr = String(msg.channelId);

        if (!hash) return; 

        // 1. 닉네임 로직 (⭐ [수정 #4, #6] 채널 기반 + 캐시)
        let historyObj = getNickHistory(chIdStr);
        if (!historyObj[hash]) historyObj[hash] = []; 
        let len = historyObj[hash].length;
        
        let lastRecordedName = "";
        if (len > 0) {
            let lastItem = historyObj[hash][len - 1];
            lastRecordedName = (typeof lastItem === "string") ? lastItem : lastItem.name;
        }

        if (len === 0 || lastRecordedName !== currentName) {
            historyObj[hash].push({ name: currentName, date: getTodayStr() });
            saveNickHistory(chIdStr); // ⭐ 캐시 내용을 파일에 저장
        }

        // 2. XP 및 유저 정보 업데이트 로직
        let cDb = getCommDb(chIdStr);
        let user = cDb[hash];
        if (!user) {
            user = { 
                name: currentName, xp: 0, totalXp: 0, level: 1, 
                upvotes: 0, downvotes: 0, features: [], 
                lastSeen: getDateTimeStr()
            };
            cDb[hash] = user;
        } else {
            user.name = currentName; 
            user.lastSeen = getDateTimeStr();
        }

        let content = msg.content;
        let bonusXp = 0;

        if (content.indexOf("선착순 선물게임을 시작합니다!") !== -1) {
            let match = content.match(/선착순\s*(\d+)명에게!/);
            if (match && match[1]) bonusXp = parseInt(match[1], 10) * 20;
        } 
        else if (content.indexOf("퀴즈 선물게임을 시작합니다!") !== -1) {
            let match = content.match(/정답자\s*(\d+)명에게!/);
            if (match && match[1]) bonusXp = parseInt(match[1], 10) * 20;
        }

        user.xp += (1 + bonusXp);
        if (!user.totalXp) user.totalXp = 0; // 기존 유저 호환
        user.totalXp += (1 + bonusXp);
        let leveledUp = false;

        while (user.xp >= getXpForNextLevel(user.level)) {
            user.xp -= getXpForNextLevel(user.level);
            user.level++;
            leveledUp = true;
            // msg.reply("🎉 [" + user.name + "] 님이 " + user.level + "레벨을 달성했습니다!");
        }

        if (!saveCounters[chIdStr]) saveCounters[chIdStr] = 0;
        saveCounters[chIdStr]++;
        if (saveCounters[chIdStr] % 10 === 0 || leveledUp || bonusXp > 0) {
            saveCommDb(chIdStr);
        }

        // 3. 채팅 카운트 로직
        let today = getTodayStr();
        if (!countCache) {
            let dataStr = FileStream.read(COUNT_FILE);
            try { countCache = dataStr ? JSON.parse(dataStr) : {}; } 
            catch (e) { countCache = {}; }
        }

        if (countCache.date !== today) {
            countCache = { date: today, rooms: {} };
            FileStream.write(COUNT_FILE, JSON.stringify(countCache));
        }

        if (!countCache.rooms[msg.room]) countCache.rooms[msg.room] = 0;
        countCache.rooms[msg.room]++;
        let currentCount = countCache.rooms[msg.room];

        // ⭐ [수정 #8] 저장 간격 10 → 5건으로 축소
        if (currentCount % 5 === 0) {
            FileStream.write(COUNT_FILE, JSON.stringify(countCache)); 
        }

        if (currentCount > 0 && currentCount % 100 === 0) {
            msg.reply("오늘 " + currentCount + "번째 채팅 돌파!"); 
        }

    } catch (e) {
        Log.e("ChatBot Error: " + e); 
    }
}

bot.addListener(Event.COMMAND, onCommand);
bot.addListener(Event.MESSAGE, onMessage);
bot.setCommandPrefix("!");