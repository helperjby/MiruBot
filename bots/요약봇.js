/**
 * @description 채팅 로그 수집, 요약 및 통계 봇
 * @version v1.2.0
 *
 * - 모든 메시지를 인메모리 버퍼에 저장
 * - 50개 도달 또는 60초 경과 시 서버로 일괄 전송 (배치 flush)
 * - !요약 명령어로 최근 N시간 대화 요약 요청
 * - !채팅통계 명령어로 유저별 채팅 통계 조회
 * - !인물평 명령어로 유저별 LLM 인물평 조회
 *
 * 명령어
 * - !DB             : 현재 채팅방의 채팅 기록 ON/OFF 토글 (기본값: OFF)
 * - !요약            : 최근 4시간 요약
 * - !요약 <N>        : 최근 N시간 요약 (1~12)
 * - !채팅통계 <닉네임> : 유저별 채팅 통계 (일반/시간대별/요일별)
 * - !인물평 <닉네임>   : 유저별 LLM 인물평 분석
 *
 * 변경 이력
 * - v1.0.0 (2026-03-19) : 초기 버전 — 채팅 로그 수집, 배치 flush, !요약 명령어
 * - v1.1.0 (2026-03-20) : !채팅통계 명령어 추가 — 닉네임 검색(대소문자/공백 무시),
 *                         시간대별·요일별 바 차트, Gemini 인물평 분석
 * - v1.2.0 (2026-03-20) : 인물평을 !채팅통계에서 분리하여 !인물평 명령어로 독립
 */

/* ==================== 전역 상수/변수 ==================== */

const bot = BotManager.getCurrentBot();
const Thread = java.lang.Thread;
const Jsoup = org.jsoup.Jsoup;

const FASTAPI_BASE_URL = "http://192.168.0.133:8080";

// 배치 설정
const BATCH_SIZE = 50;          // 이 개수 이상 쌓이면 즉시 flush
const FLUSH_INTERVAL_MS = 60000; // 60초마다 타이머 flush
const DEFAULT_SUMMARY_HOURS = 4;
const MAX_SUMMARY_HOURS = 12;

// DB 기록 활성화된 채팅방 목록 (기본값: OFF)
const DB_ROOMS_PATH = "sdcard/bot/summary_db_rooms.json";
let dbEnabledRooms = null; // 인메모리 캐시: [channelId, ...]

function getDbEnabledRooms() {
    if (dbEnabledRooms !== null) return dbEnabledRooms;
    let data = FileStream.read(DB_ROOMS_PATH);
    if (!data) { dbEnabledRooms = []; return dbEnabledRooms; }
    try { dbEnabledRooms = JSON.parse(data); } catch (e) { dbEnabledRooms = []; }
    return dbEnabledRooms;
}

function saveDbEnabledRooms() {
    FileStream.write(DB_ROOMS_PATH, JSON.stringify(dbEnabledRooms));
}

function isDbEnabled(channelId) {
    return getDbEnabledRooms().indexOf(channelId) !== -1;
}

// 채팅방별 인메모리 버퍼: { channelId: [msg, ...] }
const chatBuffer = {};

// flush 중복 방지 플래그
let isFlushing = false;

/* ==================== 서버 통신 ==================== */

/**
 * FastAPI 서버에 POST 요청을 전송합니다 (동기).
 */
function postToServer(endpoint, payload) {
    let url = FASTAPI_BASE_URL + endpoint;
    let payloadJson = JSON.stringify(payload);

    try {
        let response = Jsoup.connect(url)
            .header("Content-Type", "application/json")
            .timeout(30000)
            .maxBodySize(1024 * 1024)
            .ignoreContentType(true)
            .requestBody(payloadJson)
            .method(org.jsoup.Connection.Method.POST)
            .ignoreHttpErrors(true)
            .execute();

        let statusCode = response.statusCode();
        let responseText = response.body();

        if (statusCode < 200 || statusCode >= 300) {
            let errorLog = responseText.length > 200 ? responseText.substring(0, 200) + "..." : responseText;
            Log.e("[요약봇] " + endpoint + " HTTP 오류: " + statusCode + " - " + errorLog);
            return { success: false, data: null, error: "HTTP " + statusCode };
        }

        let responseData;
        try {
            responseData = JSON.parse(responseText);
        } catch (e) {
            Log.e("[요약봇] " + endpoint + " JSON 파싱 오류: " + String(e));
            return { success: false, data: null, error: "파싱 오류" };
        }

        return { success: true, data: responseData, error: null };

    } catch (e) {
        Log.e("[요약봇] " + endpoint + " 연결 오류: " + String(e));
        return { success: false, data: null, error: "연결 실패" };
    }
}

/* ==================== 배치 flush ==================== */

/**
 * 모든 채널의 버퍼를 서버로 일괄 전송합니다.
 */
function flushAllBuffers() {
    if (isFlushing) return;
    isFlushing = true;

    try {
        // 모든 채널의 메시지를 하나의 배열로 합침
        let allMessages = [];
        let channelIds = Object.keys(chatBuffer);

        for (let i = 0; i < channelIds.length; i++) {
            let chId = channelIds[i];
            let msgs = chatBuffer[chId];
            if (msgs && msgs.length > 0) {
                for (let j = 0; j < msgs.length; j++) {
                    allMessages.push(msgs[j]);
                }
            }
        }

        if (allMessages.length === 0) {
            isFlushing = false;
            return;
        }

        Log.d("[요약봇] 배치 flush 시작: " + allMessages.length + "건");

        // 버퍼 비우기 (전송 전에 비워서 새 메시지가 유실되지 않게 함)
        for (let i = 0; i < channelIds.length; i++) {
            chatBuffer[channelIds[i]] = [];
        }

        let response = postToServer("/chat-logs/batch", { messages: allMessages });

        if (response.success) {
            Log.d("[요약봇] 배치 flush 완료: " + response.data.saved + "건 저장");
        } else {
            Log.e("[요약봇] 배치 flush 실패: " + response.error);
            // 실패 시 메시지 복원 (재전송 시도를 위해)
            for (let i = 0; i < allMessages.length; i++) {
                let msg = allMessages[i];
                if (!chatBuffer[msg.channel_id]) chatBuffer[msg.channel_id] = [];
                chatBuffer[msg.channel_id].push(msg);
            }
        }
    } catch (e) {
        Log.e("[요약봇] flushAllBuffers 오류: " + String(e));
    } finally {
        isFlushing = false;
    }
}

/**
 * 특정 채널의 버퍼 크기를 확인하고 임계치 초과 시 flush합니다.
 */
function checkAndFlush(channelId) {
    let buf = chatBuffer[channelId];
    if (buf && buf.length >= BATCH_SIZE) {
        new Thread(function () {
            try {
                flushAllBuffers();
            } catch (e) {
                Log.e("[요약봇] checkAndFlush 스레드 오류: " + String(e));
            }
        }).start();
    }
}

/* ==================== 타이머 flush (Event.TICK 활용) ==================== */

let tickCounter = 0;

bot.addListener(Event.TICK, function () {
    tickCounter++;
    // FLUSH_INTERVAL_MS / 1000 = 60초 = 60틱
    if (tickCounter >= (FLUSH_INTERVAL_MS / 1000)) {
        tickCounter = 0;
        new Thread(function () {
            try {
                flushAllBuffers();
            } catch (e) {
                Log.e("[요약봇] 타이머 flush 스레드 오류: " + String(e));
            }
        }).start();
    }
});

/* ==================== 이벤트 리스너 ==================== */

bot.addListener(Event.MESSAGE, function (msg) {
    try {
        // 카카오톡 메시지만 처리
        if (msg.packageName !== "com.kakao.talk") return;

        let channelId = String(msg.channelId);

        // DB 기록이 활성화된 방만 버퍼에 저장
        if (!isDbEnabled(channelId)) return;
        let userHash = msg.author.hash ? msg.author.hash.substring(0, 12) : null;
        let userName = msg.author.name;
        let roomName = msg.room;
        let content = msg.content;
        let logId = msg.logId ? String(msg.logId) : null;

        // 버퍼에 추가
        if (!chatBuffer[channelId]) chatBuffer[channelId] = [];

        chatBuffer[channelId].push({
            channel_id: channelId,
            room_name: roomName,
            user_hash: userHash,
            user_name: userName,
            content: content,
            log_id: logId,
            timestamp: Date.now()
        });

        // 개수 기반 flush 체크
        checkAndFlush(channelId);

    } catch (e) {
        Log.e("[요약봇] onMessage 오류: " + String(e));
    }
});

/* ==================== !요약 명령어 ==================== */

bot.setCommandPrefix("!");

bot.addListener(Event.COMMAND, function (cmd) {
    try {
        // --- !DB 토글 명령어 ---
        if (cmd.command === "DB") {
            let channelId = String(cmd.channelId);
            let rooms = getDbEnabledRooms();
            let idx = rooms.indexOf(channelId);

            if (idx === -1) {
                rooms.push(channelId);
                saveDbEnabledRooms();
                cmd.reply("Chat DB가 활성화되었습니다.");
            } else {
                rooms.splice(idx, 1);
                saveDbEnabledRooms();
                cmd.reply("Chat DB가 비활성화되었습니다.");
            }
            return;
        }

        // --- !채팅통계 명령어 ---
        if (cmd.command === "채팅통계") {
            if (cmd.args.length === 0) {
                cmd.reply("사용법: !채팅통계 닉네임");
                return;
            }

            let nickname = cmd.args.join(" ");
            let channelId = String(cmd.channelId);
            cmd.reply("'" + nickname + "'님의 채팅 통계를 조회하는 중...");

            new Thread(function () {
                try {
                    // 조회 전 버퍼 flush
                    flushAllBuffers();

                    let response = postToServer("/chat-stats", {
                        channel_id: channelId,
                        nickname: nickname
                    });

                    if (response.success && response.data) {
                        if (response.data.success && response.data.stats_text) {
                            let viewMore = "\u200b".repeat(500);
                            cmd.reply(response.data.stats_text.split("\n")[0] + "\n" + viewMore + "\n" + response.data.stats_text.substring(response.data.stats_text.indexOf("\n") + 1));
                        } else {
                            cmd.reply(response.data.message || "통계를 조회할 수 없습니다.");
                        }
                    } else {
                        cmd.reply("통계 요청에 실패했습니다.");
                        Log.e("[요약봇] 통계 API 실패: " + response.error);
                    }
                } catch (e) {
                    Log.e("[요약봇] 통계 스레드 오류: " + String(e));
                    cmd.reply("통계 조회 중 오류가 발생했습니다.");
                }
            }).start();

            return;
        }

        // --- !인물평 명령어 ---
        if (cmd.command === "인물평") {
            if (cmd.args.length === 0) {
                cmd.reply("사용법: !인물평 닉네임");
                return;
            }

            let nickname = cmd.args.join(" ");
            let channelId = String(cmd.channelId);
            cmd.reply("'" + nickname + "'님의 인물평을 분석하는 중...");

            new Thread(function () {
                try {
                    // 조회 전 버퍼 flush
                    flushAllBuffers();

                    let response = postToServer("/chat-personality", {
                        channel_id: channelId,
                        nickname: nickname
                    });

                    if (response.success && response.data) {
                        if (response.data.success && response.data.personality_text) {
                            let viewMore = "\u200b".repeat(500);
                            cmd.reply(response.data.personality_text.split("\n")[0] + "\n" + viewMore + "\n" + response.data.personality_text.substring(response.data.personality_text.indexOf("\n") + 1));
                        } else {
                            cmd.reply(response.data.message || "인물평을 조회할 수 없습니다.");
                        }
                    } else {
                        cmd.reply("인물평 요청에 실패했습니다.");
                        Log.e("[요약봇] 인물평 API 실패: " + response.error);
                    }
                } catch (e) {
                    Log.e("[요약봇] 인물평 스레드 오류: " + String(e));
                    cmd.reply("인물평 조회 중 오류가 발생했습니다.");
                }
            }).start();

            return;
        }

        if (cmd.command !== "요약") return;

        // 시간 인자 파싱
        let hours = DEFAULT_SUMMARY_HOURS;
        if (cmd.args.length > 0) {
            let parsed = parseFloat(cmd.args[0]);
            if (!isNaN(parsed) && parsed >= 1 && parsed <= MAX_SUMMARY_HOURS) {
                hours = parsed;
            }
        }

        let channelId = String(cmd.channelId);
        cmd.reply("최근 " + hours + "시간 대화를 요약하는 중...");

        // flush 먼저 실행 (인메모리 → DB 동기화)
        // 이후 서버에 요약 요청
        new Thread(function () {
            try {
                // 요약 전에 현재 버퍼를 flush
                flushAllBuffers();

                let response = postToServer("/summarize-chat", {
                    channel_id: channelId,
                    hours: hours
                });

                if (response.success && response.data) {
                    if (response.data.success && response.data.summary) {
                        let header = "[ 최근 " + hours + "시간 대화 요약 (" + response.data.count + "건) ]";
                        let viewMore = "\u200b".repeat(500);
                        cmd.reply(header + "\n" + viewMore + "\n" + response.data.summary);
                    } else {
                        cmd.reply(response.data.message || "요약할 대화가 없습니다.");
                    }
                } else {
                    cmd.reply("요약 요청에 실패했습니다.");
                    Log.e("[요약봇] 요약 API 실패: " + response.error);
                }
            } catch (e) {
                Log.e("[요약봇] 요약 스레드 오류: " + String(e));
                cmd.reply("요약 중 오류가 발생했습니다.");
            }
        }).start();

    } catch (e) {
        Log.e("[요약봇] onCommand 오류: " + String(e));
    }
});

Log.i("[요약봇] v1.2.0 로드 완료.");
