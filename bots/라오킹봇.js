/**
 * [라오킹 봇 - GraalJS 통합 v1.4]
 * - 환경: MessengerBot R (API2) - v0.7.40a (GraalJS) 이상
 * - 업데이트 내역:
 * v1.0: 기본 이식 (GraalJS)
 * v1.1: !문명추천 (삭제됨)
 * v1.2: 고정 일정(연대기) 추가 및 공지 범위(24h) 수정
 * v1.3: [신규] 생일 관리 및 알림 기능 추가 (!생일등록, !생일제거)
 * v1.4: [수정] 주기성 이벤트 명령어에 패배/예외 기간 처리 추가
 */

const bot = BotManager.getCurrentBot();

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
    { name: "전쟁의 북소리(13야도100개)", startTime: "2026-03-31T13:20:00+09:00", endTime: "2026-04-02T13:20:00+09:00" },
    { name: "단합의 장(전설퀘10개)", startTime: "2026-04-02T13:20:00+09:00", endTime: "2026-04-04T13:20:00+09:00" },
    { name: "투쟁(성역1개)", startTime: "2026-04-04T13:20:00+09:00", endTime: "2026-04-06T13:20:00+09:00" },
    { name: "만무일실([개인]야만인100마리)", startTime: "2026-04-06T13:20:00+09:00", endTime: "2026-04-07T13:20:00+09:00" },
    { name: "일촉즉발(14야도100개)", startTime: "2026-04-07T13:20:00+09:00", endTime: "2026-04-09T13:20:00+09:00" },
    { name: "발사직전(7관문)", startTime: "2026-04-09T13:20:00+09:00", endTime: "2026-04-10T13:20:00+09:00" },
    { name: "늑대와양(100만킬)", startTime: "2026-04-10T13:20:00+09:00", endTime: "2026-04-12T13:20:00+09:00" },
    { name: "포위(8관문)", startTime: "2026-04-12T13:20:00+09:00", endTime: "2026-04-14T13:20:00+09:00" },
    { name: "전쟁의 불바다(타진영200만킬)", startTime: "2026-04-14T13:20:00+09:00", endTime: "2026-04-16T13:20:00+09:00" },
    { name: "연이은 승리(15야도100개)", startTime: "2026-04-16T13:20:00+09:00", endTime: "2026-04-18T13:20:00+09:00" },
    { name: "지구라트의 이름으로(점령유지)", startTime: "2026-04-18T13:20:00+09:00", endTime: "2026-04-21T13:20:00+09:00" },
    { name: "성지 전쟁(타진영주둔지3개)", startTime: "2026-04-21T13:20:00+09:00", endTime: "2026-04-23T13:20:00+09:00" },
    { name: "총공격(타진영요새1개)", startTime: "2026-04-23T13:20:00+09:00", endTime: "2026-04-25T13:20:00+09:00" },
    { name: "지배자의 영광(성전3개)", startTime: "2026-04-25T13:20:00+09:00", endTime: "2026-04-28T13:20:00+09:00" }
];

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

// --- 3. 기능별 핸들러 ---

/** [기능 1] 공지 전파 */
function handleNoticeRelay(msg) {
    if (String(msg.channelId) !== NOTICE_SOURCE_ROOM_ID) return;
    const relayMessage = `[📢공지전파]\n작성자: ${msg.author.name}\n${msg.content}`;
    try {
        bot.send(NOTICE_DESTINATION_ROOM_NAME, relayMessage, msg.packageName);
    } catch (e) { Log.e(e); }
}

/** [기능 2] 일일 자동 공지 (수정됨: 생일 추가) */
function checkAndSendDailySchedule(msg) {
    if (msg.room !== DAILY_ANNOUNCE_CONFIG.ROOM_NAME) return;
    
    const now = new Date();
    if (now.getHours() < DAILY_ANNOUNCE_CONFIG.ANNOUNCE_HOUR) return;
    
    const todayStr = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
    const lastSentDate = FileStream.read(DAILY_ANNOUNCE_CONFIG.STATUS_FILE_PATH);
    
    if (lastSentDate === todayStr) return;

    const searchStart = new Date(now.getTime());
    const searchEnd = new Date(now.getTime() + (24 * 60 * 60 * 1000));
    
    let scheduleItems = [];

    // 1. 주기성 이벤트(폐허, 제단)
    EVENTS_CONFIG.forEach(eventConfig => {
        const eventsInRange = findEventsInRange(eventConfig, searchStart, searchEnd);
        eventsInRange.forEach(time => {
            const timeStr = formatTimeHHMM(time);
            let prefix = "";
            if (time.getDate() !== now.getDate()) prefix = "(익일)";
            scheduleItems.push(`⚔️ ${eventConfig.name} ${prefix}${timeStr}`);
        });
    });

    // 2. 연대기 고정 일정
    FIXED_CHRONICLE_CONFIG.forEach(evt => {
        const startMs = new Date(evt.startTime).getTime();
        const endMs = new Date(evt.endTime).getTime();
        
        if (startMs >= searchStart.getTime() && startMs < searchEnd.getTime()) {
            const timeStr = formatTimeHHMM(new Date(startMs));
            let prefix = "";
            if (new Date(startMs).getDate() !== now.getDate()) prefix = "(익일)";
            scheduleItems.push(`📜 [시작] ${evt.name} ${prefix}${timeStr}`);
        }
        if (endMs >= searchStart.getTime() && endMs < searchEnd.getTime()) {
            const timeStr = formatTimeHHMM(new Date(endMs));
            let prefix = "";
            if (new Date(endMs).getDate() !== now.getDate()) prefix = "(익일)";
            scheduleItems.push(`🏁 [종료] ${evt.name} ${prefix}${timeStr}`);
        }
    });

    // 3. 단발성 이벤트
    try {
        const rawData = FileStream.read(ONE_TIME_EVENTS_PATH) || "[]";
        const oneTimeEvents = JSON.parse(rawData);
        const oneTimeEventsInRange = oneTimeEvents.filter(event => {
            return event.timestamp >= searchStart.getTime() && event.timestamp < searchEnd.getTime();
        });
        oneTimeEventsInRange.forEach(event => {
            const evtTime = new Date(event.timestamp);
            const timeStr = formatTimeHHMM(evtTime);
            let prefix = "";
            if (evtTime.getDate() !== now.getDate()) prefix = "(익일)";
            scheduleItems.push(`📅 ${event.name} ${prefix}${timeStr}`);
        });
    } catch (e) { Log.e(e); }

    // 4. [신규] 생일 체크 (오늘 날짜 기준)
    let birthdayMsg = "";
    try {
        const rawBirth = FileStream.read(BIRTHDAY_EVENTS_PATH) || "[]";
        const birthdays = JSON.parse(rawBirth);
        // 오늘 날짜 MMDD 구하기 (예: 11월 5일 -> "1105")
        const currentMMDD = String(now.getMonth() + 1).padStart(2, '0') + String(now.getDate()).padStart(2, '0');
        
        const todayBirthdays = birthdays.filter(b => b.date === currentMMDD);
        if (todayBirthdays.length > 0) {
            const names = todayBirthdays.map(b => b.name).join(', ');
            birthdayMsg = `\n🎉 오늘은 ${names}님의 생일입니다! 🎂`;
        }
    } catch (e) {
        Log.e(`[생일체크] 오류: ${e}`);
    }

    // 5. 최종 메시지 전송
    let replyMsg = `🔔 [오늘의 일정]\n`;
    
    if (scheduleItems.length > 0) {
        replyMsg += `\n${scheduleItems.join('\n')}`;
    } else {
        replyMsg += `\n예정된 주요 일정이 없습니다.`;
    }

    if (birthdayMsg) {
        replyMsg += `\n${birthdayMsg}`;
    }
    
    const success = bot.send(DAILY_ANNOUNCE_CONFIG.ROOM_NAME, replyMsg);
    if (success) {
        FileStream.write(DAILY_ANNOUNCE_CONFIG.STATUS_FILE_PATH, todayStr);
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

    // 2. 기존 일정 계산 로직 (기존 코드 그대로 유지)
    const periodMs = (config.periodHours * 3600000) + ((config.periodMinutes || 0) * 60000);
    const endDate = new Date(config.endTime);
    let nextTime = new Date(config.baseTime);
    
    while (nextTime.getTime() < now.getTime()) {
        nextTime.setTime(nextTime.getTime() + periodMs);
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
        cmd.reply(`[등록 완료] ${eventName} (${eventDate.toLocaleString()})`);
    } catch (e) { cmd.reply(`등록 실패: ${e.message}`); }
}

function handleDeleteEvent(cmd, eventName) {
    if (!eventName) { cmd.reply("삭제할 이름을 입력하세요."); return; }
    try {
        const rawData = FileStream.read(ONE_TIME_EVENTS_PATH) || "[]";
        const events = JSON.parse(rawData);
        const remaining = events.filter(e => e.name !== eventName);
        
        if (events.length === remaining.length) { cmd.reply("해당 일정이 없습니다."); return; }
        FileStream.write(ONE_TIME_EVENTS_PATH, JSON.stringify(remaining, null, 2));
        cmd.reply(`[삭제 완료] ${eventName}`);
    } catch (e) { cmd.reply(`오류: ${e.message}`); }
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

        // 3. 날짜순 정렬 (MMDD 문자열 비교)
        birthdays.sort((a, b) => a.date.localeCompare(b.date));

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
        Log.e(e); // 
        cmd.reply("생일 목록을 불러오는 중 오류가 발생했습니다.");
    }
}

// --- 4. 메인 이벤트 리스너 ---

function onMessage(msg) {
    try {
        handleNoticeRelay(msg);
        checkAndSendDailySchedule(msg);
    } catch (e) { Log.e(e); }
}

function onCommand(cmd) {
    if (!ALLOWED_COMMAND_ROOM_IDS.includes(String(cmd.channelId))) return;

    try {
        let eventFound = false;
        for (const eventConfig of EVENTS_CONFIG) {
            if (cmd.command === eventConfig.command) {
                handleGenericSchedule(cmd, eventConfig);
                eventFound = true;
                break;
            }
        }
        if (eventFound) return;

        switch (cmd.command) {
            // 일정 관리
            case "일정등록": handleRegisterEvent(cmd, cmd.args.join(' ')); break;
            case "일정삭제": handleDeleteEvent(cmd, cmd.args.join(' ')); break;
            case "일정": handleShowEvents(cmd); break;
            
            // [신규] 생일 관리
            case "생일등록": handleRegisterBirthday(cmd, cmd.args.join(' ')); break;
            case "생일제거": handleDeleteBirthday(cmd, cmd.args.join(' ')); break;
            case "생일목록": handleShowBirthdays(cmd); break; // [추가됨]

            // 유틸리티
            
            // 미디어 전송
            case "크븝":
                try {
                    if (cmd.args[0] === "동맹구도") {
                        const sender = new MediaSender();
                        if (sender.send(cmd.channelId, IMAGE_PATHS["동맹구도"])) {
                            java.lang.Thread.sleep(1000); sender.returnToAppNow();
                        } else cmd.reply("전송 실패");
                    }
                } catch (e) { Log.e(e); }
                break;

            case "특성":
                try {
                    const paths = TALENT_IMAGE_PATHS[cmd.args[0]];
                    if (!paths) { cmd.reply("찾을 수 없는 사령관입니다."); return; }
                    const sender = new MediaSender();
                    if (sender.send(cmd.channelId, paths)) {
                        java.lang.Thread.sleep(1000); sender.returnToAppNow();
                    } else cmd.reply("전송 실패");
                } catch (e) { Log.e(e); }
                break;

            case "명령어":
                let help = "[라오킹 봇 v1.4]\n\n";
                EVENTS_CONFIG.forEach(e => help += `!${e.command} - ${e.name}\n`);
                help += "\n[일정]\n!일정등록, !일정삭제, !일정\n!생일등록 {닉네임}, {MMDD}\n!생일제거 {닉네임}\n";
                help += "\n[기타]\n!주둔지\n!크븝 동맹구도\n!특성 {이름}";
                cmd.reply(help);
                break;
        }
    } catch (e) { Log.e(e); cmd.reply("오류 발생"); }
}

// --- 5. 리스너 등록 ---
bot.addListener(Event.MESSAGE, onMessage);
bot.setCommandPrefix("!");
bot.addListener(Event.COMMAND, onCommand);
Log.i("--- 라오킹봇 v1.4 로드됨 ---");