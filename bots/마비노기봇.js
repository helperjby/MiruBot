/*
 * 마비노기봇 (Mabinogi Bot) - v2.9 (Hehee Code Review 반영)
 * - 말티즈 이미지 전송 누락(씹힘) 현상 해결 (전송 전후 딜레이 대폭 증가)
 * - 이미지 다운로드 시 URL 확장자 파싱 오류 수정 (쿼리스트링 제거)
 * - (v2.9) MediaSender 캐시 자동 정리 (하루 1회 + 컴파일 시)
 * > [개선] 캐시 삭제 시 생성된 지 10분 이상 지난 파일만 삭제하여 전송 대기 중인 파일 보호
 * - (v2.9) 이미지 다운로드 maxBodySize 10MB 제한 (무제전 → 제한)
 * > [개선] 모든 FileOutputStream에 try-finally 적용하여 자원 누수 완벽 방지
 * - (v2.9) 알림 로그 파일(mabi_noti_log.txt) 1MB 초과 시 자동 로테이션
 */

// --- [모듈 및 전역 설정: 전역이므로 const 사용 가능] ---
const bot = BotManager.getCurrentBot();

const Jsoup = org.jsoup.Jsoup;
const File = java.io.File;
const FileOutputStream = java.io.FileOutputStream;

const FASTAPI_BASE_URL = "http://192.168.0.133:8080"; 
const DB_PATH = "sdcard/msgbot/mabi_config.json";
const RUNE_INFO_JSON_PATH = "sdcard/msgbot/Bots/마비노기봇/runeinfo.json";
const RUNEWORD_JSON_PATH = "sdcard/msgbot/Bots/마비노기봇/runeword.json";

const ALLOWED_ROOM_NAMES = ["지통실", "말티즈"];
const TARGET_APP_PACKAGES = ["life.mabimobi.app", "com.android.chrome"];

const ADMIN_HASHES = ["e5a0e976d576", "cef61879db01"];

const ALERT_ROOM_MAP = {
    "칼릭스": ["말티즈"], 
    "데이안": [], 
    "던컨": [], 
    "아이라": [], 
    "메이븐": [],
    "라사": [], 
    "알리사": []
};

// --- [상태 저장용 전역 변수 (도배 방지)] ---
let lastAbyssScheduledTime = 0;
let lastAbyssNowSent = 0;
const ConcurrentHashMap = Java.type("java.util.concurrent.ConcurrentHashMap");
let lastDeepHoleTimeMap = new ConcurrentHashMap();  // 심층 구멍 쿨타임 관리 (thread-safe)

// --- [캐시 정리] ---
let lastCacheCleanDate = "";

/**
 * @description 미디어 캐시 폴더 정리 로직
 * 현재 전송 대기 중인 파일이 삭제되는 것을 막기 위해, 생성된 지 10분이 지난 파일만 삭제합니다.
 */
function cleanupMediaCache() {
    try {
        let sender = new MediaSender();
        let dirFile = new File(sender.getBaseDirectory());
        if (!dirFile.exists()) return;

        let files = dirFile.listFiles();
        if (!files || files.length === 0) return;

        let deleted = 0;
        let nowMillis = Date.now();
        const TEN_MINUTES_IN_MILLIS = 10 * 60 * 1000;

        for (let i = 0; i < files.length; i++) {
            try {
                // 생성(마지막 수정)된 지 10분이 지난 파일만 삭제
                if (nowMillis - files[i].lastModified() > TEN_MINUTES_IN_MILLIS) {
                    files[i].delete();
                    deleted++;
                }
            } catch (e) {}
        }
        if (deleted > 0) Log.i("[마비노기봇] 캐시 정리: " + deleted + "개 이전 파일 삭제 완료");
    } catch (e) {
        Log.e("[마비노기봇] 캐시 정리 오류: " + e);
    }
}

function onStartCompile() {
    cleanupMediaCache();
}

// --- [config 캐싱] ---
let cachedConfig = null;
let cachedConfigTime = 0;
const CONFIG_CACHE_TTL = 60000; // 1분

// --- [헬퍼 함수] ---

function truncHash(h) {
    return h ? h.substring(0, 12) : null;
}

function isAdmin(hash) {
    return !!hash && ADMIN_HASHES.includes(truncHash(hash));
}

let formatNumber = function(num) {
    return String(num || 0).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
};

function getRuneInfo() {
    let data = FileStream.read(RUNE_INFO_JSON_PATH);
    if (!data) return []; 
    try {
        return JSON.parse(data);
    } catch (e) {
        Log.e("[마비노기봇] 룬 정보 파싱 오류: " + e);
        return [];
    }
}

function readConfig() {
    let now = Date.now();
    if (cachedConfig && (now - cachedConfigTime < CONFIG_CACHE_TTL)) {
        return cachedConfig;
    }

    let defaultAlerts = { abyss: true, deepHole: true, notice: true };
    let defaultConfig = { lastAutoMalteseDate: "", alerts: defaultAlerts };
    let data = FileStream.read(DB_PATH);
    if (!data) {
        FileStream.write(DB_PATH, JSON.stringify(defaultConfig));
        cachedConfig = defaultConfig;
        cachedConfigTime = now;
        return defaultConfig;
    }
    try {
        cachedConfig = JSON.parse(data);
    } catch (e) {
        cachedConfig = defaultConfig;
    }
    // alerts 누락 키 머지
    if (!cachedConfig.alerts) cachedConfig.alerts = {};
    for (let k in defaultAlerts) {
        if (cachedConfig.alerts[k] === undefined) {
            cachedConfig.alerts[k] = defaultAlerts[k];
        }
    }
    cachedConfigTime = now;
    return cachedConfig;
}

function writeConfig(config) {
    FileStream.write(DB_PATH, JSON.stringify(config, null, 2));
    cachedConfig = config;
    cachedConfigTime = Date.now();
}

function getRunewordString(categoryName, dataList) {
    if (!dataList || dataList.length === 0) return "";
    
    let title = categoryName;
    if (categoryName.includes("공격력")) title = "공격력 도감";
    else if (categoryName.includes("최대체력")) title = "체력 도감";
    else if (categoryName.includes("기타")) title = "기타 도감";

    let result = "[" + title + "]\n";
    
    for (let i = 0; i < dataList.length; i++) {
        let item = dataList[i];
        result += (i + 1) + ". " + item.도감명 + "\n";
        result += "- 능력치: " + item.능력치 + "\n";
        result += "- 구성: " + item.구성 + "\n\n";
    }
    return result;
}

// ==========================================
// 말티즈 닉네임 단일 검색 로직
// ==========================================
function sendMalteseSearch(channelId, query) {
    new java.lang.Thread(function() {
        try {
            let sender = new MediaSender();
            let baseDir = sender.getBaseDirectory();

            // 폴더가 없으면 생성
            let dirFile = new File(baseDir);
            if (!dirFile.exists()) dirFile.mkdirs();

            let apiUrl = FASTAPI_BASE_URL + "/images/search/maltese?query=" + encodeURIComponent(query);
            
            let response = Jsoup.connect(apiUrl)
                .timeout(10000)
                .ignoreContentType(true)
                .method(org.jsoup.Connection.Method.GET)
                .ignoreHttpErrors(true)
                .execute();

            if (response.statusCode() !== 200) {
                bot.send(channelId, "❌ 검색 서버 오류가 발생했습니다.");
                return;
            }

            let data = JSON.parse(response.body());

            if (!data.found || data.count === 0) {
                bot.send(channelId, "🔍 '" + query + "' 검색 결과가 없습니다.");
                return;
            }

            if (data.mode === "partial_multiple") {
                let limit = 10; 
                let fileList = data.file_names.map(function(name) {
                    return name.replace(".jpg", "").replace(".png", "");
                });
                
                let listStr = fileList.slice(0, limit).join(", ");
                if (fileList.length > limit) listStr += " 등...";

                bot.send(channelId, "🔍 검색 결과 " + data.count + "건이 있습니다.\n" + listStr);
                return;
            }

            if (data.urls && data.urls.length > 0) {
                let imgUrl = data.urls[0];
                
                let cleanUrl = imgUrl.split("?")[0];
                let extIdx = cleanUrl.lastIndexOf(".");
                let ext = (extIdx !== -1) ? cleanUrl.substring(extIdx) : ".jpg";
                if (ext.length > 5 || ext.includes("/")) ext = ".jpg";
                
                let fileName = "search_" + Date.now() + ext;
                let savePath = baseDir + "/" + fileName;

                let imgRes = Jsoup.connect(imgUrl).timeout(30000).maxBodySize(10 * 1024 * 1024).ignoreContentType(true).execute();

                // [개선] FileOutputStream 자원 누수 완벽 차단
                let fos = null;
                try {
                    fos = new FileOutputStream(savePath);
                    fos.write(imgRes.bodyAsBytes());
                } finally {
                    if (fos != null) fos.close();
                }

                // 1. 텍스트 메시지를 먼저 발송
                let foundName = data.file_names[0].replace(/\..+$/, "");
                bot.send(channelId, "🐶 [" + foundName + "] 님의 스텔라그램입니다.");

                // 카카오톡이 텍스트를 처리할 시간을 충분히 줌 (2500ms)
                java.lang.Thread.sleep(2500);

                let javaPaths = java.lang.reflect.Array.newInstance(java.lang.String, 1);
                javaPaths[0] = savePath;
                let success = sender.send(channelId, javaPaths);

                if (success) {
                    Log.i("[마비노기봇] 말티즈 검색 이미지 전송 성공");
                    // 카카오톡 내부에서 이미지 전송이 완료될 때까지 대기 (4000ms)
                    java.lang.Thread.sleep(4000);
                    sender.returnToAppNow();
                } else {
                    Log.e("[마비노기봇] 말티즈 검색 MediaSender 전송 실패 (return: false)");
                }

            }
        } catch (e) {
            Log.e("[마비노기봇] 랭킹 검색 실패: " + e);
            bot.send(channelId, "❌ 검색 중 오류가 발생했습니다.");
        }
    }).start();
}

// ==========================================
// 다중/랜덤 이미지 전송부
// ==========================================
function sendMalteseImages(channelId, count, isAutoDaily) {
    new java.lang.Thread(function() {
        try {
            let sender = new MediaSender();
            let baseDir = sender.getBaseDirectory();
            let apiUrl = FASTAPI_BASE_URL + "/images/random/maltese?count=" + count + "&_ts=" + Date.now();

            let dirFile = new File(baseDir);
            if (!dirFile.exists()) dirFile.mkdirs();

            let response = Jsoup.connect(apiUrl).timeout(30000).ignoreContentType(true).execute();
            let imageUrls = JSON.parse(response.body()).urls;
            if (!imageUrls || imageUrls.length === 0) {
                Log.e("[마비노기봇] 말티즈 API 응답에 URL이 없습니다.");
                return;
            }
            Log.i("[마비노기봇] 말티즈 이미지 " + imageUrls.length + "장 다운로드 시작");

            let localPaths = [];
            for (let i = 0; i < imageUrls.length; i++) {
                try {
                    let cleanUrl = imageUrls[i].split("?")[0];
                    let extIdx = cleanUrl.lastIndexOf(".");
                    let ext = (extIdx !== -1) ? cleanUrl.substring(extIdx) : ".jpg";
                    if (ext.length > 5 || ext.includes("/")) ext = ".jpg";

                    let savePath = baseDir + "/maltese_" + Date.now() + "_" + i + ext;
                    let imgRes = Jsoup.connect(imageUrls[i]).timeout(30000).ignoreContentType(true).maxBodySize(10 * 1024 * 1024).execute();
                    let bytes = imgRes.bodyAsBytes();
                    let fos = null;
                    try {
                        fos = new FileOutputStream(savePath);
                        fos.write(bytes);
                    } finally {
                        if (fos != null) fos.close();
                    }
                    localPaths.push(savePath);
                } catch (downErr) {
                    Log.e("[마비노기봇] 이미지 다운로드 실패(" + i + "): " + downErr);
                }
            }

            if (localPaths.length === 0) return;

            if (isAutoDaily) {
                bot.send(channelId, "오늘의 말텔라그램🐶");
                // 텍스트 전송과 이미지 공유 인텐트 간 충돌 방지
                java.lang.Thread.sleep(2500);
            }

            let javaPaths = java.lang.reflect.Array.newInstance(java.lang.String, localPaths.length);
            for (let j = 0; j < localPaths.length; j++) {
                javaPaths[j] = localPaths[j];
            }

            let success = sender.send(channelId, javaPaths);

            if (success) {
                Log.i("[마비노기봇] 말티즈 MediaSender 전송 성공 (" + localPaths.length + "장)");
                // 묶어보내기 렌더링 대기
                java.lang.Thread.sleep(4000);
                sender.returnToAppNow();
            } else {
                Log.e("[마비노기봇] 말티즈 MediaSender 전송 실패 (return: false)");
            }

        } catch (e) {
            Log.e("[마비노기봇] 말티즈 이미지 전송 오류: " + e);
        }
    }).start();
}

function onMessage(msg) {
    try {
        if (msg.room !== "말티즈") return;

        // 하루 1회 캐시 정리
        let now = new Date();
        let todayStr = now.getFullYear() + "-" + (now.getMonth() + 1) + "-" + now.getDate();
        if (lastCacheCleanDate !== todayStr) {
            lastCacheCleanDate = todayStr;
            cleanupMediaCache();
        }

        let hour = now.getHours();
        if (hour < 9 || hour > 11) return;

        let config = readConfig();
        if (config.lastAutoMalteseDate !== todayStr) {
            config.lastAutoMalteseDate = todayStr;
            writeConfig(config);
            sendMalteseImages(msg.channelId, 2, true);
        }
    } catch (e) {
        Log.e("[마비노기봇] onMessage 오류: " + String(e));
    }
}

function onCommand(cmd) {
    try {
        if (!ALLOWED_ROOM_NAMES.includes(cmd.room)) return;
        let config = readConfig();

        switch (cmd.command) {
            case "명령어":
                let helpMsg = "🐶미루봇 v2.9 기능 안내\n" +
                            "\u200b".repeat(500) +
                            "\n----------------------------\n" +
                            "[길원 얼굴 익히기]\n" +
                            "• !말티즈 : 랜덤 이미지 1장 전송\n" +
                            "• !말티즈 [숫자] : 1~8장 랜덤 전송\n" +
                            "• !말티즈 [닉네임] : 유저의 스텔라그램 조회\n\n" +
                            "• 스텔라그램 업데이트 방법:\n" +
                            " 1) 아래 링크의 폴더에 최신 이미지를 업로드합니다.\n" +
                            " 2) 파일명을 반드시 닉네임으로 저장합니다.\n" +
                            " 3) https://1drv.ms/f/c/773af9826b9658fb/IgAWUCrXEKZeRqJKSGEksOTRAXK_1oYowPNMIrejuL2TA1s \n\n" +
                            "📊 [정보 조회]\n" +
                            "• !룬워드 : 전체 룬워드 도감 조회\n" +
                            "• !룬워드 [공격력/체력/기타] : 종류별 룬워드 조회\n" +
                            "• !룬정보 [이름] : 룬 등급 및 효과 조회\n" +
                            "• !룬비교 [A],[B],[C] : 두 개 이상의 룬 비교\n" +
                            "• !초월 : 초월 재료 표 이미지 전송\n\n" +
                            "🎮 [엔터테인먼트]\n" +
                            "• !운세, !열쇠운세 : 오늘의 운세와 추천 장소를 점쳐봅니다.\n\n" +
                            "⚙️ [알림 설정]\n" +
                            "• !알람리스트 : 알림 ON/OFF 상태 확인\n" +
                            "• !어구알람 : 어비스 구멍 알람 ON/OFF (관리자)\n" +
                            "• !심구알람 : 심층 구멍 알람 ON/OFF (관리자)\n" +
                            "• !공지알람 : 공지사항 알람 ON/OFF (관리자)\n\n" +
                            "✨ [상시 기능]\n" +
                            "• URL 요약: 뉴스, 게임 정보 등 WEB 및 YOUTUBE 링크를 자동으로 요약합니다.\n" +
                            "• 말텔라그램: 매일 오전 9시 랜덤한 두명의 스텔라그램을 보여줍니다.\n" +
                            "• 심구 및 어구 알림: 심층 구멍과 어비스 구멍이 등장하면 톡방에 알림을 보냅니다.";

                cmd.reply(helpMsg);
                break;
            case "열쇠운세":
            case "운세": 
                let senderName = (typeof cmd.author === 'object') ? cmd.author.name : cmd.author;
                if (!senderName) senderName = "모험가";

                new java.lang.Thread(function() {
                    try {
                        let url = FASTAPI_BASE_URL + "/game/fortune?user_id=" + encodeURIComponent(senderName);
                        
                        let res = Jsoup.connect(url)
                            .timeout(5000)
                            .ignoreContentType(true)
                            .method(org.jsoup.Connection.Method.GET)
                            .execute();

                        if (res.statusCode() === 200) {
                            let data = JSON.parse(res.body());
                            
                            if (data.status === "cooldown") {
                                cmd.reply("⏳ " + senderName + "님, " + data.message);
                                
                            } else if (data.status === "error") {
                                cmd.reply("❌ 서버 오류: " + data.message);
                                
                            } else {
                                cmd.reply("🔮 " + senderName + "님의 기운을 확인 중입니다...");
                                java.lang.Thread.sleep(1000);

                                let resultMsg = 
                                    "🔮 열쇠의 기운 확인 결과 🔮\n" +
                                    "👤 " + senderName + "님에게 느껴지는 기운은.. \n" +
                                    "\n" +
                                    "🎯 운세 등급: " + data.fortune_grade + "\n" +
                                    "💭 해석: " + data.fortune_msg + "\n" +
                                    "📍 추천 장소: " + data.recommend_place;

                                cmd.reply(resultMsg);
                            }
                        } else {
                            cmd.reply("❌ 운세 서버 접속에 실패했습니다. (Code: " + res.statusCode() + ")");
                        }
                    } catch (e) {
                        Log.e("[마비노기봇] 열쇠운세 오류: " + e);
                        cmd.reply("❌ 처리 중 오류가 발생했습니다.\n" + e);
                    }
                }).start();
                break;

            case "말티즈":
                if (cmd.args.length > 0) {
                    let arg = cmd.args[0];
                    let num = parseInt(arg);
                    if (isNaN(num)) { 
                        sendMalteseSearch(cmd.channelId, arg);
                    } else {
                        sendMalteseImages(cmd.channelId, Math.min(num, 8), false);
                    }
                } else {
                    sendMalteseImages(cmd.channelId, 1, false);
                }
                break;

            case "룬워드":
                let jsonRaw = FileStream.read(RUNEWORD_JSON_PATH);
                if (!jsonRaw) {
                    cmd.reply("❌ 룬워드 데이터 파일(runeword.json)을 찾을 수 없습니다.");
                    return;
                }

                let runeData;
                try {
                    runeData = JSON.parse(jsonRaw);
                } catch (e) {
                    cmd.reply("❌ 데이터 파싱 오류: JSON 형식이 올바르지 않습니다.");
                    return;
                }

                let subCmd = cmd.args[0]; 
                let viewMore = "\u200b".repeat(500); 
                let resultMsg = "";
                let headEmoji = "📖";

                if (!subCmd) {
                    resultMsg = headEmoji + " 전체 룬워드 정보입니다.\n" + viewMore + "\n";
                    resultMsg += getRunewordString("공격력 도감", runeData["1_공격력_도감"]);
                    resultMsg += "--------------------------------------\n\n";
                    resultMsg += getRunewordString("체력 도감", runeData["2_최대체력_도감"]);
                    resultMsg += "--------------------------------------\n\n";
                    resultMsg += getRunewordString("기타 도감", runeData["3_기타핵심_도감"]);

                } else if (subCmd === "공격력" || subCmd === "공") {
                    resultMsg = headEmoji + " 공격력 룬워드 정보입니다.\n" + viewMore + "\n";
                    resultMsg += getRunewordString("공격력 도감", runeData["1_공격력_도감"]);

                } else if (subCmd === "체력" || subCmd === "피") {
                    resultMsg = headEmoji + " 체력 룬워드 정보입니다.\n" + viewMore + "\n";
                    resultMsg += getRunewordString("체력 도감", runeData["2_최대체력_도감"]);

                } else if (subCmd === "기타") {
                    resultMsg = headEmoji + " 기타 룬워드 정보입니다.\n" + viewMore + "\n";
                    resultMsg += getRunewordString("기타 도감", runeData["3_기타핵심_도감"]);

                } else {
                    cmd.reply("💡 사용법: !룬워드 [공격력/체력/기타]");
                    return;
                }

                cmd.reply(resultMsg.trim());
                break;    
            case "초월":
                new java.lang.Thread(function() {
                    let sender = new MediaSender(); 
                    let path = "/storage/emulated/0/msgbot_media/Mabi/초월재료.png"; 
                    if (new File(path).exists()) {
                        sender.send(cmd.channelId, path);
                        java.lang.Thread.sleep(1000); 
                        sender.returnToAppNow();
                    }
                }).start();
                break;
            case "룬정보":
                let query = cmd.args[0];
                if (!query) {
                    cmd.reply("사용법: !룬정보 {룬이름}");
                    return;
                }
                let runeList = getRuneInfo();
                if (runeList === null || runeList.length === 0) {
                    cmd.reply("오류: 룬 정보 파일을 로드할 수 없습니다.");
                    return;
                }
                let matches = runeList.filter(function(r) {
                    return r.룬.includes(query);
                });

                if (matches.length === 1) {
                    let rune = matches[0];
                    cmd.reply("💠 이름: " + rune.룬 + " [" + rune.등급 + "]\n💡 효과: " + rune.설명);
                } else if (matches.length > 1) {
                    cmd.reply("'" + query + "' 검색 결과(" + matches.length + "개): " + matches.map(function(r){return r.룬;}).join(", "));
                }
                break;

            case "룬비교":
                if (cmd.args.length === 0) {
                    cmd.reply("사용법: !룬비교 {룬A},{룬B}...");
                    return;
                }
                let cRuneList = getRuneInfo();
                if (cRuneList === null || cRuneList.length === 0) return;
                
                let names = cmd.args.join("").split(",");
                let parts = [], notFound = [], multiple = [], validNames = [];

                for (let i = 0; i < names.length; i++) {
                    let q = names[i].trim();
                    if (!q) continue;
                    let m = cRuneList.filter(function(r) { return r.룬.includes(q); });
                    
                    if (m.length === 1) {
                        validNames.push(m[0].룬);
                        parts.push((parts.length + 1) + ". " + m[0].룬 + " [" + m[0].등급 + "]\n💡 " + m[0].설명);
                    } else if (m.length > 1) multiple.push(m.map(function(r){return r.룬;}).join(", "));
                    else notFound.push(q);
                }
                
                if (parts.length > 0) {
                    let header = validNames.join(" vs ") + "\n\n";
                    cmd.reply(header + "\u200b".repeat(500) + parts.join("\n\n"));
                }
                if (notFound.length > 0) cmd.reply("❌ 못 찾음: " + notFound.join(", "));
                if (multiple.length > 0) cmd.reply("💬 중복 검색: " + multiple.join("\n"));
                break;

            case "어구알람":
                if (!isAdmin(cmd.author.hash)) {
                    cmd.reply("❌ 관리자만 사용할 수 있는 명령어입니다.");
                    break;
                }
                config.alerts.abyss = !config.alerts.abyss;
                writeConfig(config);
                cmd.reply("🔔 어비스 구멍 알람 " + (config.alerts.abyss ? "ON ✅" : "OFF ❌"));
                break;

            case "심구알람":
                if (!isAdmin(cmd.author.hash)) {
                    cmd.reply("❌ 관리자만 사용할 수 있는 명령어입니다.");
                    break;
                }
                config.alerts.deepHole = !config.alerts.deepHole;
                writeConfig(config);
                cmd.reply("🔔 심층 구멍 알람 " + (config.alerts.deepHole ? "ON ✅" : "OFF ❌"));
                break;

            case "공지알람":
                if (!isAdmin(cmd.author.hash)) {
                    cmd.reply("❌ 관리자만 사용할 수 있는 명령어입니다.");
                    break;
                }
                config.alerts.notice = !config.alerts.notice;
                writeConfig(config);
                cmd.reply("🔔 공지 알람 " + (config.alerts.notice ? "ON ✅" : "OFF ❌"));
                break;

            case "알람리스트":
            case "알람목록":
                cmd.reply("📋 현재 알람 리스트입니다.\n" +
                    (config.alerts.abyss ? "✅" : "❌") + " 어비스 구멍 알람\n" +
                    (config.alerts.deepHole ? "✅" : "❌") + " 심층 구멍 알람\n" +
                    (config.alerts.notice ? "✅" : "❌") + " 공지 알람");
                break;
        }
    } catch (e) {
        Log.e("[마비노기봇] onCommand 오류 (!" + cmd.command + "): " + String(e));
    }
}

function onNotification(sbn) {
    let packageName = sbn.getPackageName();
    if (!TARGET_APP_PACKAGES.includes(packageName)) return;

    let config = readConfig();

    try {
        let extras = sbn.notification.extras;
        let title = extras.getString("android.title") || "";
        let text = extras.getString("android.text") || "";
        let subText = extras.getString("android.subText") || "";
        let bigText = "";
        
        try {
            let bigTextObj = extras.get("android.bigText");
            if (bigTextObj) bigText = bigTextObj.toString();
        } catch (e) {}

        let fullContent = (title + " " + text + " " + subText + " " + bigText).replace(/\n/g, " ");

        // [안전성 강화] 알림 강제 삭제 로직 예외 처리
        if (packageName === "life.mabimobi.app") {
            try {
                if (typeof service !== 'undefined' && service !== null) {
                    service.cancelNotification(sbn.getKey()); 
                }
            } catch (cancelError) {}
        }

        // [기능 1] 로그 기록
        if (packageName === "life.mabimobi.app") {
            let now = new Date();
            let logTime = "[" + (now.getMonth() + 1) + "/" + now.getDate() + " " + now.getHours() + ":" + now.getMinutes() + ":" + now.getSeconds() + "]";
            let logFile = new File("sdcard/msgbot/mabi_noti_log.txt");
            if (logFile.exists() && logFile.length() > 1024 * 1024) {
                logFile.delete();
            }
            FileStream.append("sdcard/msgbot/mabi_noti_log.txt", logTime + " " + fullContent + "\n");
        }

        let nowMillis = Date.now();

        // [기능 2-A] 어비스 예약 알림
        if (fullContent.includes("어비스 구멍 출현 알림")) {
            if (!config.alerts.abyss) return;
            if (nowMillis - lastAbyssScheduledTime < 3600000) return;

            lastAbyssScheduledTime = nowMillis;
            let timeRegex = /시작 시간:\s*(\d{1,2}월\s*\d{1,2}일\s*\d{1,2}시\s*\d{1,2}분)/;
            let match = fullContent.match(timeRegex);
            let scheduledTime = match ? match[1] : "시간 정보 없음";

            let msg = "📅 [어구 예약] 어비스 구멍이 곧 출현합니다.\n⏰ 시작 시간: " + scheduledTime;

            for (let i = 0; i < ALLOWED_ROOM_NAMES.length; i++) {
                bot.send(ALLOWED_ROOM_NAMES[i], msg);
            }
            return;
        }

        // [기능 2-B] 어비스 즉시 알림
        if (fullContent.includes("어비스 구멍 출현!")) {
            if (!config.alerts.abyss) return;
            if (nowMillis - lastAbyssNowSent < 600000) return;

            lastAbyssNowSent = nowMillis;
            let msg = "🚨 [어구 오픈] 어비스 구멍이 지금 열렸습니다!";

            for (let i = 0; i < ALLOWED_ROOM_NAMES.length; i++) {
                bot.send(ALLOWED_ROOM_NAMES[i], msg);
            }
            return;
        }

        // [기능 3] 심층 구멍 알림 및 쿨타임 처리
        if (fullContent.includes("심층")) {
            if (!config.alerts.deepHole) return;
            let regex = /(\S+) 서버의 (.+?) 지역.*?(\d+)개/;
            let match = fullContent.match(regex);

            if (match) {
                let server = match[1].trim();          
                let location = match[2].trim().replace(" 평원", "");
                let count = match[3]; 
                
                let deepHoleKey = server + "_" + location;
                let lastTime = lastDeepHoleTimeMap.get(deepHoleKey);
                if (lastTime !== null && (nowMillis - lastTime < 180000)) {
                    return;
                }

                lastDeepHoleTimeMap.put(deepHoleKey, nowMillis);

                if (lastDeepHoleTimeMap.size() > 10) {
                    let iter = lastDeepHoleTimeMap.entrySet().iterator();
                    while (iter.hasNext()) {
                        let entry = iter.next();
                        if (nowMillis - entry.getValue() >= 180000) {
                            iter.remove();
                        }
                    }
                }

                let msg = "🚨심구 알림🚨 " + location + " 심구 " + count + "개 등장";
                
                let targets = ALERT_ROOM_MAP[server];
                if (targets && targets.length > 0) {
                    for (let i = 0; i < targets.length; i++) {
                        bot.send(targets[i], msg);
                    }
                }
            }
            return;
        }

        // [기능 4] 새로운 공지사항 알림
        if (fullContent.includes("공지") && (fullContent.includes("점검") || fullContent.includes("업데이트"))) {
            if (!config.alerts.notice) return;
            let viewMore = "\u200b".repeat(500);
            let noticeContent = (bigText.length > text.length) ? bigText : text;
            let msg = "📢 " + title + "\n" + viewMore + "\n" + noticeContent;

            for (let i = 0; i < ALLOWED_ROOM_NAMES.length; i++) {
                bot.send(ALLOWED_ROOM_NAMES[i], msg);
            }
        }

    } catch (e) {
        Log.e("[마비노기봇] 알림 처리 오류: " + e);
    }
}

bot.setCommandPrefix("!");
bot.addListener(Event.COMMAND, onCommand);
bot.addListener(Event.MESSAGE, onMessage);
bot.addListener(Event.NOTIFICATION_POSTED, onNotification);

Log.i("마비노기봇 v2.9 로드 완료.");