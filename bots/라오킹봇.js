/**
 * [라오킹 봇 - GraalJS 통합 v1.7]
 * - 환경: MessengerBot R (API2) - v0.7.40a (GraalJS) 이상
 * - 업데이트 내역:
 * v1.0: 기본 이식 (GraalJS)
 * v1.1: !문명추천 (삭제됨)
 * v1.2: 고정 일정(연대기) 추가 및 공지 범위(24h) 수정
 * v1.3: [신규] 생일 관리 및 알림 기능 추가 (!생일등록, !생일제거)
 * v1.4: [수정] 주기성 이벤트 명령어에 패배/예외 기간 처리 추가
 * v1.5: [개선] 브리핑 시스템 고도화 (!오늘, !내일), 시간순 통합 정렬, 09:00~09:00 고정 범위
 * v1.6: [신규] !연대기 명령어 추가 (남은 일정 조회, 시간조정)
 * v1.7: [연동] 유저 차단 시스템 — 관리봇 공유 차단 파일 기반 명령어 차단 체크 추가
 */

const bot = BotManager.getCurrentBot();

// --- 🚫 유저 차단 체크 (관리봇에서 관리하는 공유 파일) ---
const BLOCKED_USERS_PATH = "sdcard/bot/blocked_users.json";
function isBlocked(hash) {
    if (!hash) return false;
    let raw = FileStream.read(BLOCKED_USERS_PATH);
    if (!raw) return false;
    try { return !!JSON.parse(raw)[hash]; } catch (e) { return false; }
}

// --- 1. 전역 설정 ---

// 1-0. 명령어 허용 방 ID 리스트
const ALLOWED_COMMAND_ROOM_IDS = [
    "432337728912106", // 지통실
    "18301468764762222", // 수다방
    "18301469121654912"  // 공지방
];

// 1-1. 공지 전파 기능 설정
const NOTICE_SOURCE_ROOM_ID = "18301469121654912";
const NOTICE_DESTINATION_ROOM_NAME = "수다방";

// 1-2. KVK 컨텍스트
const KVK_CONTEXT = "영웅의 찬가(26/03/17 ~ 26/05/02)";

// 1-3. 일일 자동 공지 설정
const DAILY_ANNOUNCE_CONFIG = {
    ROOM_NAME: "수다방",
    ANNOUNCE_HOUR: 9,
    STATUS_FILE_PATH: "sdcard/msgbot/Bots/라오킹봇/last_announce.txt"
};

// 1-4. 데이터 파일 경로
const ONE_TIME_EVENTS_PATH = "sdcard/msgbot/Bots/라오킹봇/one_time_events.json";
const BIRTHDAY_EVENTS_PATH = "sdcard/msgbot/Bots/라오킹봇/birthday_events.json"; // [신규] 생일 데이터

// 1-5. 주기성 이벤트 리스트
const EVENTS_CONFIG = [
    {
        name: "폐허", 
        command: "폐허", 
        baseTime: "2026-03-18T00:20:00+09:00", // 폐허 개방 시간
        endTime: "2026-05-02T09:00:00+09:00",  // KVK 종료 시간
        periodHours: 40,
        periodMinutes: 0,
        warningMessage: "※폐허 불참 시 모략왕법에 근거해 불이익을 받을 수 있음※"
    },
    {
        name: "제단",
        command: "제단",
        baseTime: "2026-03-31T00:50:00+09:00", // 제단 개방 시간
        endTime: "2026-05-02T09:00:00+09:00",  // KVK 종료 시간
        periodHours: 86,
        periodMinutes: 0,
        warningMessage: "※제단 불참 시 모략왕법에 근거해 불이익을 받을 수 있음※",
        defeatPeriods: [
            /* (새로운 시즌이므로 임시 비활성화) 
               패배 등 예외 상황 발생 시 아래 주석을 풀고 기간을 설정하세요.
            {
                startTime: "2026-04-15T00:00:00+09:00", 
                endTime: "2026-05-02T09:00:00+09:00",
                message: "📅제단 일정표📅\n패배한 왕국에게 제단은 없습니다.ㅠ"
            }
            */
        ]
    }
];

// 1-9. 영웅의 찬가 연대기 고정 일정 (업데이트 됨)
const FIXED_CHRONICLE_CONFIG = [
    { name: "첫걸음(센터20개)", startTime: "2026-03-13T09:00:00+09:00", endTime: "2026-03-13T11:50:00+09:00" },
    { name: "눈에는 눈(주둔지1개)", startTime: "2026-03-13T11:50:00+09:00", endTime: "2026-03-15T11:50:00+09:00" },
    { name: "요지의 전쟁(아군요새)", startTime: "2026-03-15T11:50:00+09:00", endTime: "2026-03-17T11:50:00+09:00" },
    { name: "징벌(추적자3마리)", startTime: "2026-03-17T12:20:00+09:00", endTime: "2026-03-18T12:20:00+09:00" },
    { name: "복수(11야도100개)", startTime: "2026-03-18T12:20:00+09:00", endTime: "2026-03-20T12:20:00+09:00" },
    { name: "먹구름(4관문)", startTime: "2026-03-20T12:20:00+09:00", endTime: "2026-03-22T12:20:00+09:00" },
    { name: "순례(성전1개)", startTime: "2026-03-22T12:20:00+09:00", endTime: "2026-03-24T12:20:00+09:00" },
    { name: "갈등과 분쟁(12야도100개)", startTime: "2026-03-24T12:20:00+09:00", endTime: "2026-03-26T12:20:00+09:00" },
    { name: "협력(영웅퀘10개)", startTime: "2026-03-26T12:20:00+09:00", endTime: "2026-03-28T12:20:00+09:00" },
    { name: "전진(5관문)", startTime: "2026-03-28T12:20:00+09:00", endTime: "2026-03-29T12:20:00+09:00" },
    { name: "공략(깃발200개)", startTime: "2026-03-29T12:20:00+09:00", endTime: "2026-03-29T13:20:00+09:00" },
    { name: "접근 허가(6관문)", startTime: "2026-03-29T13:20:00+09:00", endTime: "2026-03-30T13:20:00+09:00" },
    { name: "희생자(추적자3마리)", startTime: "2026-03-30T13:20:00+09:00", endTime: "2026-03-31T13:20:00+09:00" },
    { name: "전쟁의 북소리(13야도100개)", startTime: "2026-03-31T16:32:00+09:00", endTime: "2026-04-02T16:32:00+09:00" },
    { name: "단합의 장(전설퀘10개)", startTime: "2026-04-02T16:32:00+09:00", endTime: "2026-04-04T16:32:00+09:00" },
    { name: "투쟁(성역1개)", startTime: "2026-04-04T16:32:00+09:00", endTime: "2026-04-06T16:32:00+09:00" },
    { name: "만무일실([개인]야만인100마리)", startTime: "2026-04-06T16:32:00+09:00", endTime: "2026-04-07T16:32:00+09:00" },
    { name: "일촉즉발(14야도100개)", startTime: "2026-04-07T16:32:00+09:00", endTime: "2026-04-09T16:32:00+09:00" },
    { name: "발사직전(7관문)", startTime: "2026-04-09T16:32:00+09:00", endTime: "2026-04-10T16:32:00+09:00" },
    { name: "늑대와양(100만킬)", startTime: "2026-04-10T16:32:00+09:00", endTime: "2026-04-12T16:32:00+09:00" },
    { name: "포위(8관문)", startTime: "2026-04-12T16:32:00+09:00", endTime: "2026-04-14T16:32:00+09:00" },
    { name: "전쟁의 불바다(타진영200만킬)", startTime: "2026-04-14T16:32:00+09:00", endTime: "2026-04-16T16:32:00+09:00" },
    { name: "연이은 승리(15야도100개)", startTime: "2026-04-16T16:32:00+09:00", endTime: "2026-04-18T16:32:00+09:00" },
    { name: "지구라트의 이름으로(점령유지)", startTime: "2026-04-18T16:32:00+09:00", endTime: "2026-04-21T16:32:00+09:00" },
    { name: "성지 전쟁(타진영주둔지3개)", startTime: "2026-04-21T16:32:00+09:00", endTime: "2026-04-23T16:32:00+09:00" },
    { name: "총공격(타진영요새1개)", startTime: "2026-04-23T16:32:00+09:00", endTime: "2026-04-25T16:32:00+09:00" },
    { name: "지배자의 영광(성전3개)", startTime: "2026-04-25T16:32:00+09:00", endTime: "2026-04-28T16:32:00+09:00" }
];

// 1-9-1. 연대기 사전 파싱 (매 메시지마다 Date 파싱 방지)
const FIXED_CHRONICLE = FIXED_CHRONICLE_CONFIG.map(evt => ({
    name: evt.name,
    startMs: new Date(evt.startTime).getTime(),
    endMs: new Date(evt.endTime).getTime()
}));

// 1-7. 이벤트 명령어 Map (O(1) 조회)
const EVENT_COMMAND_MAP = new Map(EVENTS_CONFIG.map(e => [e.command, e]));

// 1-6. 이미지 경로 설정
const TALENT_IMAGE_PATHS = {
    "곤잘로": ["/storage/emulated/0/msgbot_media/[크기변환]곤잘로.png"],
    "영정": [
        "/storage/emulated/0/msgbot_media/[크기변환]영정1.png",
        "/storage/emulated/0/msgbot_media/[크기변환]영정2.png"
    ],
    "샤자르": ["/storage/emulated/0/msgbot_media/샤자르.png"],
    "백기": ["/storage/emulated/0/msgbot_media/백기.png"],
    "라그": ["/storage/emulated/0/msgbot_media/라그.png"],
    "아서": ["/storage/emulated/0/msgbot_media/아서.png"]
};
const IMAGE_PATHS = {
    "동맹구도": "/storage/emulated/0/msgbot_media/오를레앙동맹구도.jpg"
};


// --- 2. 헬퍼 함수 ---

function formatTimeHHMM(d) {
    const h = String(d.getHours()).padStart(2, '0');
    const m = String(d.getMinutes()).padStart(2, '0');
    return `${h}:${m}`;
}

/** 시간 범위 내 주기성 이벤트 탐색 */
function findEventsInRange(config, rangeStart, rangeEnd) {
    let events = [];
    const startMs = rangeStart.getTime();
    const endMs = rangeEnd.getTime();
    const periodMs = (config.periodHours * 3600000) + ((config.periodMinutes || 0) * 60000);
    
    let baseTime = new Date(config.baseTime);
    const configEndTime = new Date(config.endTime).getTime();

    if (baseTime.getTime() < startMs) {
        const diff = startMs - baseTime.getTime();
        const cycles = Math.floor(diff / periodMs); 
        baseTime.setTime(baseTime.getTime() + (cycles * periodMs));
    }

    while (baseTime.getTime() < endMs) {
        const currentMs = baseTime.getTime();
        if (currentMs >= startMs && currentMs < endMs && currentMs < configEndTime) {
            events.push(new Date(currentMs));
        }
        baseTime.setTime(currentMs + periodMs);
    }
    return events;
}

/** 당일 09:00 ~ 익일 09:00 범위 계산 */
function getDayRange(baseDate) {
    const start = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate(), 9, 0, 0, 0);
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    return { start, end };
}

/** 범위 내 모든 일정을 시간순으로 수집 */
function collectScheduleItems(rangeStart, rangeEnd) {
    const items = [];
    const rangeStartMs = rangeStart.getTime();
    const rangeEndMs = rangeEnd.getTime();

    // 1. 주기성 이벤트
    EVENTS_CONFIG.forEach(config => {
        findEventsInRange(config, rangeStart, rangeEnd).forEach(time => {
            items.push({ timestamp: time.getTime(), label: `⚔️ ${config.name}` });
        });
    });

    // 2. 연대기 고정 일정
    FIXED_CHRONICLE.forEach(evt => {
        if (evt.startMs >= rangeStartMs && evt.startMs < rangeEndMs) {
            items.push({ timestamp: evt.startMs, label: `📜 ${evt.name} 시작` });
        }
        if (evt.endMs >= rangeStartMs && evt.endMs < rangeEndMs) {
            items.push({ timestamp: evt.endMs, label: `🏁 ${evt.name} 종료` });
        }
    });

    // 3. 단발성 이벤트
    try {
        const rawData = FileStream.read(ONE_TIME_EVENTS_PATH) || "[]";
        JSON.parse(rawData).forEach(event => {
            if (event.timestamp >= rangeStartMs && event.timestamp < rangeEndMs) {
                items.push({ timestamp: event.timestamp, label: `📅 ${event.name}` });
            }
        });
    } catch (e) { Log.e("[라오킹봇] 단발성 이벤트 파싱 오류: " + e); }

    // 시간순 정렬
    items.sort((a, b) => a.timestamp - b.timestamp);

    // 4. 생일 (rangeStart 날짜 기준)
    let birthdayNames = [];
    try {
        const rawBirth = FileStream.read(BIRTHDAY_EVENTS_PATH) || "[]";
        const birthdays = JSON.parse(rawBirth);
        const mmdd = String(rangeStart.getMonth() + 1).padStart(2, '0') + String(rangeStart.getDate()).padStart(2, '0');
        birthdayNames = birthdays.filter(b => b.date === mmdd).map(b => b.name);
    } catch (e) { Log.e("[라오킹봇] 생일 데이터 파싱 오류: " + e); }

    return { items, birthdayNames };
}

/** 브리핑 메시지 포맷 */
function formatBriefing(rangeStart, items, birthdayNames) {
    const mm = String(rangeStart.getMonth() + 1).padStart(2, '0');
    const dd = String(rangeStart.getDate()).padStart(2, '0');
    let msg = `🔔 [${mm}/${dd} 일정]\n`;

    if (items.length > 0) {
        items.forEach(item => {
            const timeStr = formatTimeHHMM(new Date(item.timestamp));
            msg += `\n${timeStr}  ${item.label}`;
        });
    } else {
        msg += `\n예정된 주요 일정이 없습니다.`;
    }

    if (birthdayNames.length > 0) {
        msg += `\n\n🎂 오늘은 ${birthdayNames.join(', ')}님의 생일입니다!`;
    }

    return msg;
}

// --- 3. 기능별 핸들러 ---

/** [기능 1] 공지 전파 */
function handleNoticeRelay(msg) {
    if (String(msg.channelId) !== NOTICE_SOURCE_ROOM_ID) return;
    const relayMessage = `[📢공지전파]\n작성자: ${msg.author.name}\n${msg.content}`;
    try {
        bot.send(NOTICE_DESTINATION_ROOM_NAME, relayMessage, msg.packageName);
    } catch (e) { Log.e("[라오킹봇] 공지 전파 오류: " + e); }
}

/** [기능 2] 일일 자동 공지 (09:00~익일 09:00 고정 범위) */
function checkAndSendDailySchedule(msg) {
    if (msg.room !== DAILY_ANNOUNCE_CONFIG.ROOM_NAME) return;

    const now = new Date();
    if (now.getHours() < DAILY_ANNOUNCE_CONFIG.ANNOUNCE_HOUR) return;

    const todayStr = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
    const lastSentDate = FileStream.read(DAILY_ANNOUNCE_CONFIG.STATUS_FILE_PATH);
    if (lastSentDate === todayStr) return;

    const { start, end } = getDayRange(now);
    const { items, birthdayNames } = collectScheduleItems(start, end);
    const replyMsg = formatBriefing(start, items, birthdayNames);

    try {
        const success = bot.send(DAILY_ANNOUNCE_CONFIG.ROOM_NAME, replyMsg);
        if (success) {
            FileStream.write(DAILY_ANNOUNCE_CONFIG.STATUS_FILE_PATH, todayStr);
        }
    } catch (e) {
        Log.e("[라오킹봇] 일일 공지 전송 실패 (세션 미확보?): " + e);
    }
}

/** 주기성 이벤트 명령어 (수정됨: 패배/예외 기간 처리 추가) */
function handleGenericSchedule(cmd, config) {
    const now = new Date();

    // 1. [신규 로직] 패배(예외) 기간인지 먼저 확인
    if (config.defeatPeriods && Array.isArray(config.defeatPeriods)) {
        for (let period of config.defeatPeriods) {
            const sTime = new Date(period.startTime).getTime();
            const eTime = new Date(period.endTime).getTime();
            const nowTime = now.getTime();

            // 현재 시간이 설정된 기간 사이라면
            if (nowTime >= sTime && nowTime <= eTime) {
                cmd.reply(period.message);
                return; // 기존 계산 로직을 수행하지 않고 여기서 종료
            }
        }
    }

    // 2. 기존 일정 계산 로직 (Math.ceil로 한 번에 점프)
    const periodMs = (config.periodHours * 3600000) + ((config.periodMinutes || 0) * 60000);
    const endDate = new Date(config.endTime);
    let nextTime = new Date(config.baseTime);

    const diff = now.getTime() - nextTime.getTime();
    if (diff > 0) {
        const cycles = Math.ceil(diff / periodMs);
        nextTime.setTime(nextTime.getTime() + cycles * periodMs);
    }

    if (nextTime.getTime() >= endDate.getTime()) {
        cmd.reply(`[${config.name} 일정표]\n예정된 ${config.name} 일정이 없습니다.`);
        return;
    }
    
    const timeDiff = nextTime.getTime() - now.getTime();
    const d = Math.floor(timeDiff / 86400000);
    const h = Math.floor((timeDiff % 86400000) / 3600000);
    const m = Math.floor((timeDiff % 3600000) / 60000);
    const countdown = `${String(d).padStart(2, '0')}일 ${String(h).padStart(2, '0')}시간 ${String(m).padStart(2, '0')}분`;
    const days = ['일', '월', '화', '수', '목', '금', '토'];
    
    const formatDate = (timestamp) => {
        if (timestamp >= endDate.getTime()) return null;
        const d_inner = new Date(timestamp);
        return `${d_inner.getMonth() + 1}월 ${d_inner.getDate()}일(${days[d_inner.getDay()]}) ${String(d_inner.getHours()).padStart(2, '0')}:${String(d_inner.getMinutes()).padStart(2, '0')}`;
    };
    
    const schedule1 = formatDate(nextTime.getTime());
    const schedule2 = formatDate(nextTime.getTime() + periodMs);
    const schedule3 = formatDate(nextTime.getTime() + (2 * periodMs));
    
    let reply = `📅${config.name} 일정표📅\n다음 ${config.name}까지 남은 시간 ${countdown}\n`;
    if (schedule1) reply += `${schedule1}\n`;
    if (schedule2) reply += `${schedule2}\n`;
    if (schedule3) reply += `${schedule3}\n`;
    if (config.warningMessage) reply += config.warningMessage;
    
    cmd.reply(reply.trim());
}

/** 일정 등록/삭제/조회 */
function handleRegisterEvent(cmd, fullArgs) {
    try {
        const parts = fullArgs.split(',');
        if (parts.length < 2) throw new Error("형식 오류 (예: !일정등록 이름, YY/MM/DD HH:MM)");
        
        const eventName = parts[0].trim();
        const dateTimeString = parts.slice(1).join(',').trim();
        const dateParts = dateTimeString.split(' ');
        
        if (dateParts.length < 2) throw new Error("날짜/시간 형식 오류");
        const ymd = dateParts[0].split('/');
        const hm = dateParts[1].split(':');
        if (ymd.length < 3 || hm.length < 2) throw new Error("형식 오류");
        
        const eventDate = new Date(parseInt("20" + ymd[0]), parseInt(ymd[1]) - 1, parseInt(ymd[2]), parseInt(hm[0]), parseInt(hm[1]));
        if (isNaN(eventDate.getTime())) throw new Error("유효하지 않은 날짜");
        
        const rawData = FileStream.read(ONE_TIME_EVENTS_PATH) || "[]";
        const events = JSON.parse(rawData);
        
        if (events.find(e => e.name === eventName)) throw new Error(`이미 존재함: ${eventName}`);
        
        events.push({ name: eventName, timestamp: eventDate.getTime() });
        FileStream.write(ONE_TIME_EVENTS_PATH, JSON.stringify(events, null, 2));
        Log.i("[라오킹봇] 일정 등록: " + eventName + " (by " + cmd.author.name + ")");
        cmd.reply(`[등록 완료] ${eventName} (${eventDate.toLocaleString()})`);
    } catch (e) { Log.e("[라오킹봇] 일정 등록 실패: " + e.message); cmd.reply(`등록 실패: ${e.message}`); }
}

function handleDeleteEvent(cmd, eventName) {
    if (!eventName) { cmd.reply("삭제할 이름을 입력하세요."); return; }
    try {
        const rawData = FileStream.read(ONE_TIME_EVENTS_PATH) || "[]";
        const events = JSON.parse(rawData);
        const remaining = events.filter(e => e.name !== eventName);
        
        if (events.length === remaining.length) { cmd.reply("해당 일정이 없습니다."); return; }
        FileStream.write(ONE_TIME_EVENTS_PATH, JSON.stringify(remaining, null, 2));
        Log.i("[라오킹봇] 일정 삭제: " + eventName + " (by " + cmd.author.name + ")");
        cmd.reply(`[삭제 완료] ${eventName}`);
    } catch (e) { Log.e("[라오킹봇] 일정 삭제 오류: " + e.message); cmd.reply(`오류: ${e.message}`); }
}

function handleShowEvents(cmd) {
    try {
        const rawData = FileStream.read(ONE_TIME_EVENTS_PATH) || "[]";
        const events = JSON.parse(rawData);
        const now = new Date().getTime();
        const upcoming = events.filter(e => e.timestamp >= now).sort((a, b) => a.timestamp - b.timestamp);
        
        if (upcoming.length === 0) { cmd.reply("등록된 일정이 없습니다."); return; }
        
        let replyMsg = "📅 등록된 일정 📅\n\n";
        upcoming.forEach(e => replyMsg += `[${e.name}] ${new Date(e.timestamp).toLocaleString()}\n`);
        cmd.reply(replyMsg.trim());
    } catch (e) { cmd.reply(`오류: ${e.message}`); }
}

/** [신규] 생일 등록 핸들러 */
function handleRegisterBirthday(cmd, fullArgs) {
    try {
        // 입력: 닉네임, 0204
        const parts = fullArgs.split(',').map(s => s.trim());
        if (parts.length !== 2) throw new Error("형식 오류 (예: !생일등록 닉네임, 0204)");
        
        const name = parts[0];
        const dateStr = parts[1];
        
        // MMDD 형식 검사 (숫자 4자리)
        if (!/^\d{4}$/.test(dateStr)) throw new Error("날짜는 4자리 숫자(MMDD)여야 합니다.");
        
        const rawData = FileStream.read(BIRTHDAY_EVENTS_PATH) || "[]";
        const birthdays = JSON.parse(rawData);
        
        // 중복 닉네임 확인 (덮어쓰기 or 에러 처리 -> 여기선 에러)
        if (birthdays.find(b => b.name === name)) {
            cmd.reply(`이미 등록된 닉네임입니다: ${name}`);
            return;
        }
        
        birthdays.push({ name: name, date: dateStr });
        // 날짜순 정렬 (선택 사항)
        birthdays.sort((a, b) => a.date.localeCompare(b.date));
        
        FileStream.write(BIRTHDAY_EVENTS_PATH, JSON.stringify(birthdays, null, 2));
        cmd.reply(`[생일 등록] ${name}님 (${dateStr.substring(0,2)}월 ${dateStr.substring(2)}일)`);
        
    } catch (e) { cmd.reply(`등록 실패: ${e.message}`); }
}

/** [신규] 생일 제거 핸들러 */
function handleDeleteBirthday(cmd, name) {
    if (!name) { cmd.reply("삭제할 닉네임을 입력하세요."); return; }
    try {
        const rawData = FileStream.read(BIRTHDAY_EVENTS_PATH) || "[]";
        const birthdays = JSON.parse(rawData);
        const remaining = birthdays.filter(b => b.name !== name);
        
        if (birthdays.length === remaining.length) { cmd.reply("해당 닉네임의 생일 정보가 없습니다."); return; }
        
        FileStream.write(BIRTHDAY_EVENTS_PATH, JSON.stringify(remaining, null, 2));
        cmd.reply(`[생일 삭제] ${name}님`);
    } catch (e) { cmd.reply(`오류: ${e.message}`); }
}
/** [신규] 생일 목록 조회 핸들러 */
function handleShowBirthdays(cmd) {
    try {
        // 1. 파일 읽기
        let rawData = FileStream.read(BIRTHDAY_EVENTS_PATH) || "[]"; // 
        let birthdays = JSON.parse(rawData);

        // 2. 데이터 확인
        if (birthdays.length === 0) {
            cmd.reply("등록된 생일 정보가 없습니다."); // 
            return;
        }

        // 3. (정렬 불필요: 등록 시 이미 날짜순 정렬됨)

        // 4. 메시지 포맷팅
        let msg = "🎂 [생일 목록] 🎂\n\n";
        for (let i = 0; i < birthdays.length; i++) {
            let b = birthdays[i];
            let month = b.date.substring(0, 2);
            let day = b.date.substring(2);
            msg += `${month}월 ${day}일 - ${b.name}\n`;
        }

        // 5. 전송
        cmd.reply(msg.trim()); // 

    } catch (e) {
        Log.e("[라오킹봇] 생일 목록 조회 오류: " + e);
        cmd.reply("생일 목록을 불러오는 중 오류가 발생했습니다.");
    }
}

/** 수동 브리핑: !오늘 */
function handleToday(cmd) {
    const { start, end } = getDayRange(new Date());
    const { items, birthdayNames } = collectScheduleItems(start, end);
    cmd.reply(formatBriefing(start, items, birthdayNames));
}

/** 수동 브리핑: !내일 */
function handleTomorrow(cmd) {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const { start, end } = getDayRange(tomorrow);
    const { items, birthdayNames } = collectScheduleItems(start, end);
    cmd.reply(formatBriefing(start, items, birthdayNames));
}

/** 연대기: !연대기, !연대기 시간조정 +-hhmm */
function handleChronicle(cmd) {
    // 시간조정 서브커맨드
    if (cmd.args[0] === "시간조정") {
        const raw = cmd.args[1];
        if (!raw || !/^[+-]\d{4}$/.test(raw)) {
            cmd.reply("❌ 형식: !연대기 시간조정 +hhmm 또는 -hhmm");
            return;
        }
        const sign = raw[0] === '+' ? 1 : -1;
        const hh = parseInt(raw.substring(1, 3), 10);
        const mm = parseInt(raw.substring(3, 5), 10);
        const deltaMs = sign * (hh * 60 + mm) * 60 * 1000;

        // 현재 진행중인 연대기 찾기
        const now = Date.now();
        let currentIdx = -1;
        for (let i = 0; i < FIXED_CHRONICLE.length; i++) {
            if (FIXED_CHRONICLE[i].startMs <= now && FIXED_CHRONICLE[i].endMs > now) {
                currentIdx = i;
                break;
            }
        }

        // 진행중인 것이 없으면 아직 시작 안 한 첫 항목 기준
        const startIdx = currentIdx >= 0 ? currentIdx + 1 : FIXED_CHRONICLE.findIndex(e => e.startMs > now);
        if (startIdx < 0 || startIdx >= FIXED_CHRONICLE.length) {
            cmd.reply("❌ 조정할 남은 연대기가 없습니다.");
            return;
        }

        const firstChanged = FIXED_CHRONICLE[startIdx];
        const oldStartStr = formatTimeHHMM(new Date(firstChanged.startMs));

        // 시간 조정 적용
        for (let i = startIdx; i < FIXED_CHRONICLE.length; i++) {
            FIXED_CHRONICLE[i].startMs += deltaMs;
            FIXED_CHRONICLE[i].endMs += deltaMs;
            // CONFIG 원본도 동기화
            FIXED_CHRONICLE_CONFIG[i].startTime = new Date(FIXED_CHRONICLE[i].startMs).toISOString();
            FIXED_CHRONICLE_CONFIG[i].endTime = new Date(FIXED_CHRONICLE[i].endMs).toISOString();
        }

        const newStartStr = formatTimeHHMM(new Date(firstChanged.startMs));
        const displaySign = sign > 0 ? "+" : "-";
        const displayHH = String(hh).padStart(2, '0');
        const displayMM = String(mm).padStart(2, '0');
        cmd.reply(
            `✅ 연대기 시간이 ${displaySign}${displayHH}:${displayMM}만큼 조정됐습니다.\n` +
            `수정내역 ${firstChanged.name} ${oldStartStr}시작 -> ${newStartStr}시작`
        );
        return;
    }

    // 남은 연대기 목록 출력
    const now = Date.now();
    const upcoming = [];
    for (let i = 0; i < FIXED_CHRONICLE.length; i++) {
        if (FIXED_CHRONICLE[i].endMs > now) {
            upcoming.push({ idx: i, evt: FIXED_CHRONICLE[i] });
        }
    }

    if (upcoming.length === 0) {
        cmd.reply("📜 남은 연대기 일정이 없습니다.");
        return;
    }

    // 헤더: 전체 기간
    const firstStart = new Date(FIXED_CHRONICLE[0].startMs);
    const lastEnd = new Date(FIXED_CHRONICLE[FIXED_CHRONICLE.length - 1].endMs);
    const fs = `${String(firstStart.getFullYear()).slice(2)}.${String(firstStart.getMonth() + 1).padStart(2, '0')}.${String(firstStart.getDate()).padStart(2, '0')}`;
    const le = `${String(lastEnd.getFullYear()).slice(2)}.${String(lastEnd.getMonth() + 1).padStart(2, '0')}.${String(lastEnd.getDate()).padStart(2, '0')}`;
    let msg = `영웅의 찬가 ${fs} ~ ${le}\n남은 연대기 일정입니다.\n` + "\u200b".repeat(500);

    upcoming.forEach(({ idx, evt }) => {
        const start = new Date(evt.startMs);
        const end = new Date(evt.endMs);
        const sm = String(start.getMonth() + 1).padStart(2, '0');
        const sd = String(start.getDate()).padStart(2, '0');
        const em = String(end.getMonth() + 1).padStart(2, '0');
        const ed = String(end.getDate()).padStart(2, '0');
        const status = (evt.startMs <= now) ? "  ⬅️ 진행중" : "";
        msg += `\n${idx + 1}. ${evt.name}${status}`;
        msg += `\n   ${sm}/${sd} ${formatTimeHHMM(start)} ~ ${em}/${ed} ${formatTimeHHMM(end)}`;
    });

    cmd.reply(msg);
}

// --- 4. 메인 이벤트 리스너 ---

function onMessage(msg) {
    if (!msg || msg.room == null) return;
    try {
        handleNoticeRelay(msg);
        checkAndSendDailySchedule(msg);
    } catch (e) { Log.e("[라오킹봇] onMessage 오류: " + e); }
}

function onCommand(cmd) {
    if (!cmd || cmd.channelId == null) return;
    if (!ALLOWED_COMMAND_ROOM_IDS.includes(String(cmd.channelId))) return;

    // 차단된 유저는 명령어 무시
    let cmdHash = cmd.author.hash ? cmd.author.hash.substring(0, 12) : null;
    if (isBlocked(cmdHash)) return;

    try {
        const eventConfig = EVENT_COMMAND_MAP.get(cmd.command);
        if (eventConfig) { handleGenericSchedule(cmd, eventConfig); return; }

        switch (cmd.command) {
            // 일정 관리
            case "일정등록": handleRegisterEvent(cmd, cmd.args.join(' ')); break;
            case "일정삭제": handleDeleteEvent(cmd, cmd.args.join(' ')); break;
            case "일정": handleShowEvents(cmd); break;
            
            // [신규] 생일 관리
            case "생일등록": handleRegisterBirthday(cmd, cmd.args.join(' ')); break;
            case "생일제거": handleDeleteBirthday(cmd, cmd.args.join(' ')); break;
            case "생일목록": handleShowBirthdays(cmd); break; // [추가됨]

            // 브리핑
            case "오늘": handleToday(cmd); break;
            case "내일": handleTomorrow(cmd); break;
            case "연대기": handleChronicle(cmd); break;

            // 미디어 전송
            case "크븝":
                try {
                    if (cmd.args[0] === "동맹구도") {
                        const sender = new MediaSender();
                        if (sender.send(cmd.channelId, IMAGE_PATHS["동맹구도"])) {
                            java.lang.Thread.sleep(1000); sender.returnToAppNow();
                        } else cmd.reply("전송 실패");
                    }
                } catch (e) { Log.e("[라오킹봇] 크븝 이미지 전송 오류: " + e); }
                break;

            case "특성":
                try {
                    const paths = TALENT_IMAGE_PATHS[cmd.args[0]];
                    if (!paths) { cmd.reply("찾을 수 없는 사령관입니다."); return; }
                    const sender = new MediaSender();
                    if (sender.send(cmd.channelId, paths)) {
                        java.lang.Thread.sleep(1000); sender.returnToAppNow();
                    } else cmd.reply("전송 실패");
                } catch (e) { Log.e("[라오킹봇] 특성 이미지 전송 오류: " + e); }
                break;

            case "명령어":
                let help = "[라오킹 봇 v1.6]\n\n";
                EVENTS_CONFIG.forEach(e => help += `!${e.command} - ${e.name}\n`);
                help += "\n[브리핑]\n!오늘 - 오늘의 일정\n!내일 - 내일의 일정\n!연대기 - 남은 연대기 일정\n!연대기 시간조정 {+-hhmm}\n";
                help += "\n[일정]\n!일정등록, !일정삭제, !일정\n!생일등록 {닉네임}, {MMDD}\n!생일제거 {닉네임}\n!생일목록\n";
                help += "\n[기타]\n!크븝 동맹구도\n!특성 {이름}";
                cmd.reply(help);
                break;
        }
    } catch (e) { Log.e("[라오킹봇] onCommand 오류 (!" + cmd.command + "): " + e); cmd.reply("오류 발생"); }
}

// --- 5. 리스너 등록 ---
bot.addListener(Event.MESSAGE, onMessage);
bot.setCommandPrefix("!");
bot.addListener(Event.COMMAND, onCommand);
Log.i("--- 라오킹봇 v1.5 로드됨 ---");