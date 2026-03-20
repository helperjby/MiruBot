/**
 * [관리봇] 관리 유틸리티 스크립트 (API2, GraalJS 환경)
 *
 * 모든 명령어는 오너 전용입니다.
 * 오너 해시는 방마다 다르므로 파일 + 하드코딩 병합 관리합니다.
 * (!오너등록 으로 새 방에서 동적 추가 가능)
 *
 * @version 1.1.0
 * v1.0.0  2026-03-20  관리 기능 대폭 추가
 * v1.1.0  2026-03-20  권한 모델 변경
 *   - ADMIN_HASHES → OWNER_HASHES (관리봇은 오너 전용)
 *   - 오너 해시 파일 기반 동적 관리 (!오너등록)
 *   - 핑/방정보/내정보/관리도움만 공개, 나머지 전부 오너 전용
 */

// ==========================================================
// ⭐ 전역 상수 및 변수
// ==========================================================
const bot = BotManager.getCurrentBot();
const START_TIME = Date.now();
const VIEW_MORE_TRIGGER = "\u200b".repeat(500);

// --- 👑 오너 해시 (하드코딩 기본값, 방마다 다른 해시) ---
const OWNER_HASHES_DEFAULT = [
    "94c9c06f8ad592f0c4bbc2d75f8567d6b0ba2e3d40f32fe41ea94711ac23f27d",
    "2d391954f81d308f4e37a2fca10923c38f0759b1a928b6f57a475daa06106033",
    "e5a0e976d576ac81e83c32d98441d8eb1fa84fcf6598af66845ef9ae1fcede87"
];

// --- 파일 경로 ---
const OWNER_HASHES_PATH = "sdcard/bot/owner_hashes.json";
const BOT_ROOMS_PATH = "sdcard/bot/bot_rooms.json";

// ==========================================================
// ⭐ 오너 해시 관리
// ==========================================================

/**
 * 하드코딩 + 파일 병합된 오너 해시 목록 반환
 */
function getOwnerHashes() {
    let merged = OWNER_HASHES_DEFAULT.slice();
    let raw = FileStream.read(OWNER_HASHES_PATH);
    if (raw) {
        try {
            let fileHashes = JSON.parse(raw);
            if (Array.isArray(fileHashes)) {
                for (let i = 0; i < fileHashes.length; i++) {
                    if (!merged.includes(fileHashes[i])) {
                        merged.push(fileHashes[i]);
                    }
                }
            }
        } catch (e) { /* 파싱 실패 시 하드코딩만 사용 */ }
    }
    return merged;
}

function saveOwnerHashes(hashes) {
    FileStream.write(OWNER_HASHES_PATH, JSON.stringify(hashes));
}

function isOwner(hash) {
    return !!hash && getOwnerHashes().includes(hash);
}

// ==========================================================
// ⭐ 헬퍼 함수
// ==========================================================

/**
 * 방별 봇 적용 설정 (channelId 기반)
 * 형식: {
 *   "봇이름": ["channelId1", "channelId2", ...],
 *   "_roomNames": { "channelId1": "방이름1", ... }
 * }
 * 빈 배열 = 모든 방에서 동작, 미등록 = 전체 적용으로 간주
 */
function loadBotRooms() {
    let raw = FileStream.read(BOT_ROOMS_PATH);
    if (!raw) return null;
    try {
        return JSON.parse(raw);
    } catch (e) {
        return null;
    }
}

function saveBotRooms(data) {
    FileStream.write(BOT_ROOMS_PATH, JSON.stringify(data));
}

function isBotAssigned(botRooms, botName, channelId) {
    if (!botRooms || !botRooms[botName]) return true;
    return botRooms[botName].includes(channelId);
}

function updateRoomName(botRoomsData, channelId, roomName) {
    if (!botRoomsData._roomNames) botRoomsData._roomNames = {};
    botRoomsData._roomNames[channelId] = roomName;
}

function getRoomDisplayName(botRoomsData, channelId) {
    if (botRoomsData._roomNames && botRoomsData._roomNames[channelId]) {
        return botRoomsData._roomNames[channelId];
    }
    return channelId;
}

function formatUptime(ms) {
    let sec = Math.floor(ms / 1000);
    let d = Math.floor(sec / 86400);
    sec %= 86400;
    let h = Math.floor(sec / 3600);
    sec %= 3600;
    let m = Math.floor(sec / 60);
    let s = sec % 60;
    let parts = [];
    if (d > 0) parts.push(d + "일");
    if (h > 0) parts.push(h + "시간");
    if (m > 0) parts.push(m + "분");
    parts.push(s + "초");
    return parts.join(" ");
}

// ==========================================================
// ⭐ 리스너 충돌 방지 및 클린업
// ==========================================================
function onStartCompile() {
    bot.removeAllListeners(Event.COMMAND);
    Log.i("관리봇: 이전 리스너가 성공적으로 제거되었습니다.");
}

// ==========================================================
// ⭐ API2 Command 이벤트 핸들러
// ==========================================================

// 공개 명령어 (오너 아니어도 사용 가능)
const PUBLIC_COMMANDS = ["핑", "테스트", "여기", "방정보", "나", "내정보", "관리도움", "관리명령어"];

function onCommand(cmd) {
    try {
    let hash = cmd.author.hash;
    let owner = isOwner(hash);

    // 공개 명령어가 아니면 오너 체크
    if (!PUBLIC_COMMANDS.includes(cmd.command) && !owner) {
        return; // 오너가 아니면 무시 (에러 메시지 없이)
    }

    switch (cmd.command) {
        // ------------------------------------
        // 1. 기본 생존 확인 [공개]
        // ------------------------------------
        case "핑":
        case "테스트": {
            cmd.reply("퐁!");
            break;
        }

        // ------------------------------------
        // 2. 방 정보 [공개]
        // ------------------------------------
        case "여기":
        case "방정보": {
            cmd.reply([
                "--- 현재 방 정보 ---",
                `• 방 이름: ${cmd.room}`,
                `• 채널 ID: ${cmd.channelId}`,
                `• 그룹채팅: ${cmd.isGroupChat}`,
                `• 메시지 Log ID: ${cmd.logId}`
            ].join("\n"));
            break;
        }

        // ------------------------------------
        // 3. 내 정보 [공개]
        // ------------------------------------
        case "나":
        case "내정보": {
            let userHash = cmd.author.hash;
            let hashInfo = userHash
                ? `• 유저 해시: ${userHash}`
                : "• 유저 해시: 확인 불가 (Android 11 미만)";
            cmd.reply([
                "--- 내 정보 ---",
                `• 이름: ${cmd.author.name}`,
                hashInfo,
                `• 오너: ${owner ? "✅" : "❌"}`
            ].join("\n"));
            break;
        }

        // ------------------------------------
        // 4. 봇 목록 [오너]
        // ------------------------------------
        case "봇목록": {
            let botList = BotManager.getBotList();
            let lines = ["--- 설치된 봇 목록 ---"];
            for (let i = 0; i < botList.length; i++) {
                let b = botList[i];
                let power = b.getPower() ? "🟢" : "🔴";
                lines.push(`${power} ${b.getName()}`);
            }
            cmd.reply(lines.join("\n"));
            break;
        }

        // ------------------------------------
        // 5. 응답체크 [오너]
        // ------------------------------------
        case "응답체크": {
            let currentRoom = cmd.room;
            let currentChId = String(cmd.channelId);
            let allBots = BotManager.getBotList();
            let botRooms = loadBotRooms();

            let lines = [`[${currentRoom}] 봇 응답 상태\n`];

            for (let j = 0; j < allBots.length; j++) {
                let targetBot = allBots[j];
                let botName = targetBot.getName();
                let power = targetBot.getPower();
                let session = targetBot.canReply(currentRoom);
                let assigned = isBotAssigned(botRooms, botName, currentChId);

                let status;
                if (!power) {
                    status = "🔴 전원 꺼짐";
                } else if (!assigned) {
                    status = "⬜ 미적용 (이 방에서 동작 안 함)";
                } else if (!session) {
                    status = "🟡 세션 없음 (채팅 기록 필요)";
                } else {
                    status = "🟢 정상 동작";
                }

                lines.push(`• ${botName} : ${status}`);
            }

            if (!botRooms) {
                lines.push("\n💡 방별 적용 설정 미등록 상태입니다.");
                lines.push("!적용설정 으로 봇별 적용 방을 관리할 수 있습니다.");
            }

            cmd.reply(lines.join("\n"));
            break;
        }

        // ------------------------------------
        // 6. 봇 켜기/끄기 [오너]
        // ------------------------------------
        case "봇켜기":
        case "봇끄기": {
            let name = cmd.args.join(" ");
            if (!name) {
                cmd.reply(`❌ 봇 이름을 입력해주세요.\n(예: !${cmd.command} 채팅봇)`);
                break;
            }

            let target = BotManager.getBot(name);
            if (!target) {
                cmd.reply(`❌ "${name}" 봇을 찾을 수 없습니다.`);
                break;
            }

            let turnOn = (cmd.command === "봇켜기");
            target.setPower(turnOn);
            cmd.reply(`✅ ${name} 봇을 ${turnOn ? "켰습니다" : "껐습니다"}.`);
            break;
        }

        // ------------------------------------
        // 7. 컴파일 [오너]
        // ------------------------------------
        case "컴파일": {
            let compileName = cmd.args.join(" ");
            if (!compileName) {
                cmd.reply("❌ 봇 이름을 입력해주세요.\n(예: !컴파일 채팅봇)");
                break;
            }

            let compileTarget = BotManager.getBot(compileName);
            if (!compileTarget) {
                cmd.reply(`❌ "${compileName}" 봇을 찾을 수 없습니다.`);
                break;
            }

            let success = compileTarget.compile();
            if (success) {
                cmd.reply(`✅ ${compileName} 봇 컴파일 성공.`);
            } else {
                cmd.reply(`❌ ${compileName} 봇 컴파일 실패. 로그를 확인해주세요.`);
            }
            break;
        }

        // ------------------------------------
        // 8. 로그 조회 [오너]
        // ------------------------------------
        case "로그": {
            let logBotName = cmd.args.length > 0 ? cmd.args[0] : "관리봇";
            let lineCount = 10;
            if (cmd.args.length > 1) {
                let parsed = parseInt(cmd.args[cmd.args.length - 1]);
                if (!isNaN(parsed) && parsed > 0) lineCount = Math.min(parsed, 30);
            }

            let logPath = `sdcard/msgbot/Bots/${logBotName}/log.json`;
            let logRaw = FileStream.read(logPath);

            if (!logRaw) {
                cmd.reply(`❌ "${logBotName}" 로그 파일을 찾을 수 없습니다.`);
                break;
            }

            try {
                let logData = JSON.parse(logRaw);
                if (!Array.isArray(logData) || logData.length === 0) {
                    cmd.reply(`📋 "${logBotName}" 로그가 비어있습니다.`);
                    break;
                }

                let recent = logData.slice(-lineCount);
                let lines = [`--- ${logBotName} 최근 로그 (${recent.length}건) ---`];

                for (let k = 0; k < recent.length; k++) {
                    let entry = recent[k];
                    let type = entry.type || "?";
                    let content = entry.content || String(entry);
                    if (content.length > 100) content = content.substring(0, 100) + "...";
                    lines.push(`[${type}] ${content}`);
                }

                cmd.reply(lines.join("\n"));
            } catch (e) {
                cmd.reply(`❌ 로그 파싱 실패: ${e.message}`);
            }
            break;
        }

        // ------------------------------------
        // 9. 업타임 [오너]
        // ------------------------------------
        case "업타임": {
            let uptimeBotName = cmd.args.join(" ");

            if (!uptimeBotName) {
                let elapsed = Date.now() - START_TIME;
                cmd.reply(`⏱ 관리봇 업타임: ${formatUptime(elapsed)}`);
            } else {
                let uptimeTarget = BotManager.getBot(uptimeBotName);
                if (!uptimeTarget) {
                    cmd.reply(`❌ "${uptimeBotName}" 봇을 찾을 수 없습니다.`);
                    break;
                }
                let power = uptimeTarget.getPower();
                cmd.reply([
                    `⏱ ${uptimeBotName} 상태`,
                    `• 전원: ${power ? "🟢 켜짐" : "🔴 꺼짐"}`,
                    "",
                    `💡 관리봇 업타임: ${formatUptime(Date.now() - START_TIME)}`,
                    "(개별 봇 업타임은 각 봇 내부에서만 측정 가능)"
                ].join("\n"));
            }
            break;
        }

        // ------------------------------------
        // 10. 메모리 [오너]
        // ------------------------------------
        case "메모리": {
            let runtime = java.lang.Runtime.getRuntime();
            let total = runtime.totalMemory();
            let free = runtime.freeMemory();
            let max = runtime.maxMemory();
            let used = total - free;

            let toMB = function(bytes) {
                return (bytes / (1024 * 1024)).toFixed(1);
            };

            cmd.reply([
                "--- JVM 메모리 상태 ---",
                `• 사용 중: ${toMB(used)} MB`,
                `• 할당됨: ${toMB(total)} MB`,
                `• 최대:   ${toMB(max)} MB`,
                `• 여유:   ${toMB(free)} MB`,
                `• 사용률: ${(used / max * 100).toFixed(1)}%`
            ].join("\n"));
            break;
        }

        // ------------------------------------
        // 11. 봇상태 종합 대시보드 [오너]
        // ------------------------------------
        case "봇상태": {
            let allBotsDash = BotManager.getBotList();
            let currentRoomDash = cmd.room;
            let currentChIdDash = String(cmd.channelId);
            let botRoomsDash = loadBotRooms();

            let lines = [
                "=== 봇 종합 상태 ===",
                `📍 현재 방: ${currentRoomDash}`,
                `⏱ 관리봇 업타임: ${formatUptime(Date.now() - START_TIME)}`,
                ""
            ];

            for (let i = 0; i < allBotsDash.length; i++) {
                let b = allBotsDash[i];
                let bName = b.getName();
                let power = b.getPower();
                let session = b.canReply(currentRoomDash);
                let assigned = isBotAssigned(botRoomsDash, bName, currentChIdDash);

                let powerIcon = power ? "🟢" : "🔴";
                let roomStatus;
                if (!assigned) {
                    roomStatus = "미적용";
                } else if (session) {
                    roomStatus = "응답가능";
                } else {
                    roomStatus = "세션없음";
                }

                lines.push(`${powerIcon} ${bName} [${roomStatus}]`);
            }

            let rt = java.lang.Runtime.getRuntime();
            let usedMem = rt.totalMemory() - rt.freeMemory();
            let maxMem = rt.maxMemory();
            lines.push("");
            lines.push(`💾 메모리: ${(usedMem / (1024 * 1024)).toFixed(1)}/${(maxMem / (1024 * 1024)).toFixed(1)} MB (${(usedMem / maxMem * 100).toFixed(0)}%)`);

            cmd.reply(lines.join("\n"));
            break;
        }

        // ------------------------------------
        // 12. 적용설정 [오너]
        // ------------------------------------
        case "적용설정": {
            // !적용설정              — 현재 설정 조회
            // !적용설정 초기화        — 봇 목록 기반 설정 생성
            // !적용설정 추가 <봇이름>  — 현재 방에 봇 적용
            // !적용설정 제거 <봇이름>  — 현재 방에서 봇 제거
            let subCmd = cmd.args.length > 0 ? cmd.args[0] : "";
            let botRoomsData = loadBotRooms() || {};
            let chId = String(cmd.channelId);

            if (subCmd === "초기화") {
                let bots = BotManager.getBotList();
                let newData = { _roomNames: botRoomsData._roomNames || {} };
                for (let i = 0; i < bots.length; i++) {
                    let bName = bots[i].getName();
                    newData[bName] = botRoomsData[bName] || [];
                }
                updateRoomName(newData, chId, cmd.room);
                saveBotRooms(newData);
                cmd.reply("✅ 봇 적용설정이 초기화되었습니다.\n각 봇의 적용 방을 !적용설정 추가 <봇이름> 으로 등록해주세요.");
                break;
            }

            if (subCmd === "추가" || subCmd === "제거") {
                if (cmd.args.length < 2) {
                    cmd.reply(`❌ 사용법: !적용설정 ${subCmd} <봇이름>\n(현재 방에 자동 적용됩니다)`);
                    break;
                }
                let setBotName = cmd.args.slice(1).join(" ");

                if (!botRoomsData[setBotName]) botRoomsData[setBotName] = [];
                if (!botRoomsData._roomNames) botRoomsData._roomNames = {};
                updateRoomName(botRoomsData, chId, cmd.room);

                if (subCmd === "추가") {
                    if (!botRoomsData[setBotName].includes(chId)) {
                        botRoomsData[setBotName].push(chId);
                    }
                    saveBotRooms(botRoomsData);
                    cmd.reply(`✅ ${setBotName}에 현재 방(${cmd.room})을 추가했습니다.`);
                } else {
                    let idx = botRoomsData[setBotName].indexOf(chId);
                    if (idx >= 0) {
                        botRoomsData[setBotName].splice(idx, 1);
                        saveBotRooms(botRoomsData);
                        cmd.reply(`✅ ${setBotName}에서 현재 방(${cmd.room})을 제거했습니다.`);
                    } else {
                        cmd.reply(`❌ ${setBotName}에 현재 방이 등록되어 있지 않습니다.`);
                    }
                }
                break;
            }

            // 기본: 현재 설정 조회
            let keys = Object.keys(botRoomsData).filter(function(k) { return k !== "_roomNames"; });
            if (keys.length === 0) {
                cmd.reply("📋 방별 적용 설정이 없습니다.\n!적용설정 초기화 로 시작하세요.");
                break;
            }

            let lines = ["--- 방별 봇 적용 설정 ---"];
            for (let i = 0; i < keys.length; i++) {
                let chIds = botRoomsData[keys[i]];
                if (chIds.length === 0) {
                    lines.push(`• ${keys[i]}: (미설정 — 전체 방)`);
                } else {
                    let names = [];
                    for (let c = 0; c < chIds.length; c++) {
                        names.push(getRoomDisplayName(botRoomsData, chIds[c]));
                    }
                    lines.push(`• ${keys[i]}: ${names.join(", ")}`);
                }
            }
            lines.push("");
            lines.push("!적용설정 추가 <봇> — 현재 방에 적용");
            lines.push("!적용설정 제거 <봇> — 현재 방에서 제거");
            lines.push("!적용설정 초기화");
            cmd.reply(lines.join("\n"));
            break;
        }

        // ------------------------------------
        // 13. 오너등록 [오너] — 새 방에서 해시 추가
        // ------------------------------------
        case "오너등록": {
            // 이미 오너인 경우: 현재 방의 해시가 파일에 없으면 추가
            let currentHashes = getOwnerHashes();
            if (currentHashes.includes(hash)) {
                cmd.reply("✅ 이미 등록된 오너 해시입니다.\n현재 방 해시: " + hash);
                break;
            }

            // 여기 도달 불가 (isOwner 통과했으므로) — 안전장치
            cmd.reply("❌ 오너 인증 실패.");
            break;
        }

        case "오너해시추가": {
            // 기존 오너가 새 방에서 실행 → 현재 해시를 파일에 저장
            // (이 명령어 자체가 오너 전용이므로, 이미 알려진 해시로 인증된 상태)
            let fileRaw = FileStream.read(OWNER_HASHES_PATH);
            let fileHashes = [];
            if (fileRaw) {
                try { fileHashes = JSON.parse(fileRaw); } catch (e) { fileHashes = []; }
            }

            if (!fileHashes.includes(hash)) {
                fileHashes.push(hash);
                saveOwnerHashes(fileHashes);
                cmd.reply(`✅ 현재 방의 해시를 오너 목록에 추가했습니다.\n해시: ${hash}`);
            } else {
                cmd.reply("✅ 이미 등록된 해시입니다.");
            }
            break;
        }

        // ------------------------------------
        // 14. 유저 해시 검색 [오너]
        // ------------------------------------
        case "해시검색": {
            let targetName = cmd.args.join(" ");
            if (!targetName) {
                cmd.reply("❌ 검색할 닉네임을 입력해주세요.\n(예: !해시검색 홍길동)");
                break;
            }

            let channelIdStr = String(cmd.channelId);
            let foundHash = null;

            let commDbPath = `sdcard/bot/comm_db_${channelIdStr}.json`;
            let commDbString = FileStream.read(commDbPath);
            if (commDbString) {
                try {
                    let commDb = JSON.parse(commDbString);
                    for (let h in commDb) {
                        if (h === "_meta") continue;
                        if (commDb[h].name === targetName) {
                            foundHash = h;
                            break;
                        }
                    }
                } catch (e) { /* 파싱 실패 시 무시 */ }
            }

            if (foundHash) {
                cmd.reply(`🔍 현재 방에서 찾은 [${targetName}]님의 해시값:\n${foundHash}`);
            } else {
                cmd.reply(`❌ 현재 방(${cmd.room})에서 [${targetName}]님의 기록을 찾을 수 없습니다.\n(대상이 한 번이라도 채팅을 쳐야 기록됩니다.)`);
            }
            break;
        }

        // ------------------------------------
        // 15. 권한테스트 [오너]
        // ------------------------------------
        case "권한테스트": {
            let testPath = "sdcard/bot/permission_test.txt";
            let testContent = "MessengerBot R test " + Date.now();

            try {
                FileStream.write(testPath, testContent);
                let readData = FileStream.read(testPath);

                if (readData === testContent) {
                    FileStream.remove(testPath);
                    cmd.reply("✅ 파일 권한 테스트 성공\n(쓰기, 읽기, 삭제 완료)");
                } else {
                    cmd.reply("❌ 테스트 실패 (Read)\n- 쓰기 후 읽은 데이터가 다릅니다.");
                }
            } catch (e) {
                cmd.reply(`❌ 테스트 실패 (Exception)\n- 오류: ${e.message}`);
                Log.e("권한테스트 실패: " + e.message);
            }
            break;
        }

        // ------------------------------------
        // 16. 객체 덤프 [오너]
        // ------------------------------------
        case "객체확인":
        case "덤프": {
            let lines = ["[CMD 객체 속성 덤프]", "=".repeat(15), ""];

            for (let prop in cmd) {
                try {
                    let type = typeof cmd[prop];
                    lines.push(`• ${prop} (${type})`);
                } catch (e) {
                    lines.push(`• ${prop} (접근 오류)`);
                }
            }

            cmd.reply(lines.join("\n") + "\n" + VIEW_MORE_TRIGGER + "(상세 내용은 '더보기' 확인)");
            break;
        }

        // ------------------------------------
        // 17. 도움말 [공개]
        // ------------------------------------
        case "관리도움":
        case "관리명령어": {
            let lines = [
                "=== 관리봇 명령어 ===",
                "",
                "📌 공개",
                "• !핑 — 생존 확인",
                "• !방정보 — 현재 방 정보",
                "• !내정보 — 내 정보 + 오너 여부",
                ""
            ];

            if (owner) {
                lines.push(
                    "📊 모니터링 (오너)",
                    "• !봇목록 — 설치된 봇 목록",
                    "• !응답체크 — 현재 방 봇 응답 상태",
                    "• !봇상태 — 종합 대시보드",
                    "• !업타임 [봇이름] — 업타임 확인",
                    "• !메모리 — JVM 메모리 상태",
                    "",
                    "🔧 제어 (오너)",
                    "• !봇켜기 <이름> — 봇 전원 ON",
                    "• !봇끄기 <이름> — 봇 전원 OFF",
                    "• !컴파일 <이름> — 봇 재컴파일",
                    "• !로그 [봇이름] [줄수] — 최근 로그",
                    "• !적용설정 [추가|제거] <봇> — 현재 방 기준 적용 관리",
                    "• !오너해시추가 — 새 방 해시 등록",
                    "",
                    "🔍 유틸 (오너)",
                    "• !해시검색 <닉네임> — 유저 해시 조회",
                    "• !권한테스트 — 파일 I/O 확인",
                    "• !덤프 — CMD 객체 속성 확인"
                );
            }

            cmd.reply(lines.join("\n"));
            break;
        }
    }
    } catch (e) {
        Log.e("onCommand 오류: " + String(e));
    }
}

// ==========================================================
// ⭐ 리스너 등록 및 초기화
// ==========================================================
bot.setCommandPrefix("!");
bot.addListener(Event.COMMAND, onCommand);

Log.i("관리봇 v1.1.0 로드 완료.");