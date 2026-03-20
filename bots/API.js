/*
 * [외부 연동 봇] - Jsoup 직접 호출 / 비동기 처리 버전 (v2.4)
 *
 * [업데이트 사항]
 * 1. MediaSender 보안 정책 대응 (로컬 파일 다운로드 후 전송)
 * 2. 이미지 잘림 방지 (maxBodySize 10MB)
 * 3. !윤호, !미루 명령어 범위 제한: 1~4장 허용 (5장 이상 시 무반응)
 * 4. YouTube Shorts URL 요약 제외 로직 추가
 * 5. onCommand, onMessage 전체 try-catch 적용 (봇 크래시 방지)
 * 6. (v2.3) onCommand 내부 msg 참조 버그 수정
 * 7. (v2.3) MediaSender.send() JS 배열 -> Java 배열 타입 호환성 문제 수정
 * 8. (v2.4) 더보기 접기 로직 헬퍼 함수 추출
 * 9. (v2.4) !환율/!증시 전용 엔드포인트 분리
 * 10. (v2.4) GET 요청 유틸 함수 추가 및 !윤호/!미루 적용
 * 11. (v2.4) 이미지 maxBodySize 10MB 제한 (OOM 방지)
 * 12. (v2.4) 이미지 전송 후 로컬 파일 삭제
 * 13. (v2.4) FileOutputStream try-finally 리소스 누수 방지
 * 14. (v2.4) URL 중복 방지 Map 기반으로 개선
 */

const bot = BotManager.getCurrentBot();
const Thread = Packages.java.lang.Thread;
const Jsoup = org.jsoup.Jsoup;
const File = java.io.File;
const FileOutputStream = java.io.FileOutputStream;

const FASTAPI_BASE_URL = "http://192.168.0.133:8080";
const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB

// ▼▼▼ URL 요약 예외 처리할 채팅방 ID 목록 ▼▼▼
const URL_SUMMARY_EXCLUSION_LIST = [
    "18301469121654912", // 공지 전파 방
    "457451860712164"    // 모비봇
];

// URL 중복 방지: { url: timestamp } 맵
const recentUrlMap = {};
const URL_DEDUP_INTERVAL = 2000;
const URL_DEDUP_MAX_ENTRIES = 50;

/* ==================== 유틸 함수 ==================== */

/**
 * 첫 줄을 제목으로, 나머지를 "더보기" 접기 처리하여 반환
 */
const foldMessage = (text) => {
    let idx = text.indexOf('\n');
    if (idx === -1) return text;
    let title = text.substring(0, idx);
    let body = text.substring(idx + 1).trim();
    if (!body) return title;
    return title + "\n" + "\u200b".repeat(500) + "\n" + body;
};

/**
 * Jsoup을 사용하여 FastAPI 서버에 POST 요청 (동기)
 */
const postToFastAPI = (endpoint, payload) => {
    let url = FASTAPI_BASE_URL + endpoint;
    let payloadJson = JSON.stringify(payload);

    try {
        let response = Jsoup.connect(url)
            .header("Content-Type", "application/json")
            .timeout(20000)
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
            Log.e(endpoint + " API HTTP 오류: " + statusCode + " - " + errorLog);
            return { success: false, data: null, error: "HTTP " + statusCode };
        }

        let responseData;
        try {
            responseData = JSON.parse(responseText);
        } catch (e) {
            Log.e(endpoint + " JSON 파싱 오류: " + String(e));
            return { success: false, data: null, error: "파싱 오류" };
        }

        return { success: true, data: responseData, error: null };

    } catch (e) {
        Log.e(endpoint + " Jsoup 연결 오류: " + String(e));
        return { success: false, data: null, error: "연결 실패" };
    }
};

/**
 * Jsoup을 사용하여 FastAPI 서버에 GET 요청 (동기)
 */
const getFromFastAPI = (endpoint) => {
    let url = FASTAPI_BASE_URL + endpoint;

    try {
        let response = Jsoup.connect(url)
            .timeout(30000)
            .maxBodySize(1024 * 1024)
            .ignoreContentType(true)
            .method(org.jsoup.Connection.Method.GET)
            .ignoreHttpErrors(true)
            .execute();

        let statusCode = response.statusCode();
        let responseText = response.body();

        if (statusCode < 200 || statusCode >= 300) {
            let errorLog = responseText.length > 200 ? responseText.substring(0, 200) + "..." : responseText;
            Log.e(endpoint + " API HTTP 오류: " + statusCode + " - " + errorLog);
            return { success: false, data: null, error: "HTTP " + statusCode };
        }

        let responseData;
        try {
            responseData = JSON.parse(responseText);
        } catch (e) {
            Log.e(endpoint + " JSON 파싱 오류: " + String(e));
            return { success: false, data: null, error: "파싱 오류" };
        }

        return { success: true, data: responseData, error: null };

    } catch (e) {
        Log.e(endpoint + " Jsoup 연결 오류: " + String(e));
        return { success: false, data: null, error: "연결 실패" };
    }
};

/**
 * URL 중복 방지 맵 정리 (오래된 항목 제거)
 */
const cleanupRecentUrlMap = () => {
    let now = Date.now();
    let keys = Object.keys(recentUrlMap);
    if (keys.length <= URL_DEDUP_MAX_ENTRIES) return;
    for (let key of keys) {
        if (now - recentUrlMap[key] > URL_DEDUP_INTERVAL * 5) {
            delete recentUrlMap[key];
        }
    }
};

/* ==================== 이벤트 핸들러 ==================== */

function onCommand(cmd) {
    try {
        Log.d("메시지 수신: " + cmd.content);
        Log.d("명령어 수신: " + cmd.command + " / args: " + cmd.args);

        if (cmd.command === "번역") {
            let textToTranslate = cmd.args.join(" ");
            if (!textToTranslate) {
                cmd.reply("번역할 내용을 입력해주세요.");
                return;
            }

            let payload = { text: textToTranslate };

            new Thread(function() {
                try {
                    let response = postToFastAPI("/translate", payload);
                    if (response.success && response.data && response.data.translation) {
                        cmd.reply("🌐 번역 결과:\n" + response.data.translation);
                    } else {
                        Log.e("번역 API 응답 실패: " + response.error);
                    }
                } catch (e) {
                    Log.e("번역 스레드 오류: " + e);
                }
            }).start();
        }
    } catch (e) {
        Log.e("onCommand 오류: " + String(e));
    }
}

function onMessage(msg) {
    try {
        const currentRoomId = String(msg.channelId);
        if (URL_SUMMARY_EXCLUSION_LIST.includes(currentRoomId)) {
            return;
        }

        if (msg.packageName !== "com.kakao.talk" || msg.content.startsWith("$")) {
            return;
        }

        let messageContent = msg.content.trim();

        // --- [명령어 감지 로직: !환율, !증시] ---
        if (messageContent === "!환율" || messageContent === "!증시") {
            Log.i("명령어 감지: " + messageContent);

            new Thread(function() {
                try {
                    let isStock = messageContent === "!증시";
                    let endpoint = isStock ? "/finance/stock" : "/finance/exchange";
                    let response = getFromFastAPI(endpoint);

                    if (response.success && response.data && response.data.gemini_summary) {
                        if (isStock) {
                            msg.reply(foldMessage(response.data.gemini_summary));
                        } else {
                            let headline = response.data.headline;
                            let summary = response.data.gemini_summary.replace(/\n\n/g, '\n');
                            msg.reply(headline + "\n" + summary);
                        }
                    } else {
                        Log.e(messageContent + " API 요청 실패: " + response.error);
                    }
                } catch (e) {
                    Log.e(messageContent + " 처리 스레드 오류: " + String(e));
                }
            }).start();
            return;
        }

        // --- '!윤호' 및 '!미루' 명령어 로직 ---
        if (messageContent.startsWith("!윤호") || messageContent.startsWith("!미루")) {

            let isBaby = messageContent.startsWith("!윤호");
            let category = isBaby ? "baby" : "miru";
            let categoryName = isBaby ? "윤호" : "미루";

            let parts = messageContent.split(" ");
            let requestedCount = parseInt(parts[1]);
            let count = isNaN(requestedCount) ? 1 : Math.max(1, requestedCount);

            if (count > 4) return;

            Log.i(`명령어 감지: !${categoryName} ${count}장. 처리 시작.`);

            new Thread(function() {
                try {
                    // 1. API 호출
                    let response = getFromFastAPI(`/images/random/${category}?count=${count}`);

                    if (!response.success) {
                        Log.e(`!${categoryName} API 오류: ${response.error}`);
                        return;
                    }

                    let imageUrls = response.data.urls;

                    if (!imageUrls || imageUrls.length === 0) {
                        Log.e(`!${categoryName}: 이미지 URL을 받지 못했습니다.`);
                        return;
                    }

                    // 2. 이미지 다운로드 및 로컬 저장
                    let sender = new MediaSender();
                    let baseDir = sender.getBaseDirectory();

                    let dirFile = new File(baseDir);
                    if (!dirFile.exists()) {
                        dirFile.mkdirs();
                    }

                    let localPaths = [];

                    for (let i = 0; i < imageUrls.length; i++) {
                        let imgUrl = imageUrls[i];
                        let fileName = `${category}_${Date.now()}_${i}.jpg`;
                        let savePath = `${baseDir}/${fileName}`;

                        try {
                            let imgRes = Jsoup.connect(imgUrl)
                                              .ignoreContentType(true)
                                              .timeout(30000)
                                              .maxBodySize(MAX_IMAGE_SIZE)
                                              .userAgent("Mozilla/5.0")
                                              .execute();

                            let bytes = imgRes.bodyAsBytes();
                            let fos = new FileOutputStream(savePath);
                            try {
                                fos.write(bytes);
                            } finally {
                                fos.close();
                            }

                            let savedFile = new File(savePath);
                            Log.d(`다운로드 성공 (${i+1}/${count}): ${fileName} (크기: ${savedFile.length()} bytes)`);

                            localPaths.push(savePath);
                        } catch (downErr) {
                            Log.e(`이미지 다운로드 실패(${i}): ${downErr}`);
                        }
                    }

                    // 3. 로컬 파일 전송
                    if (localPaths.length > 0) {
                        Log.i(`MediaSender 전송 준비 중... (${localPaths.length}장)`);

                        let javaPaths = java.lang.reflect.Array.newInstance(java.lang.String, localPaths.length);
                        for (let j = 0; j < localPaths.length; j++) {
                            javaPaths[j] = localPaths[j];
                        }

                        let success = sender.send(msg.channelId, javaPaths);

                        // 전송 후 로컬 파일 삭제
                        for (let p of localPaths) {
                            try { new File(p).delete(); } catch (ignored) {}
                        }

                        if (success) {
                            Log.i(`!${categoryName} MediaSender 전송 성공!`);
                            java.lang.Thread.sleep(1500);
                            sender.returnToAppNow();
                        } else {
                            Log.e(`!${categoryName} MediaSender 전송 실패 (return: false)`);
                        }
                    } else {
                        Log.e(`!${categoryName} 다운로드된 이미지가 없습니다.`);
                    }

                } catch (e) {
                    Log.e(`!${categoryName} 전체 처리 중 오류: ` + String(e));
                }
            }).start();

            return;
        }
        // --- '!윤호', '!미루' 로직 끝 ---


        // --- URL 요약 로직 ---
        let urlRegex = /https?:\/\/(?:[-\w.]|(?:%[\da-fA-F]{2}))+[^\s]*/g;
        let match = messageContent.match(urlRegex);
        let detectedUrl = (match && match.length > 0) ? match[0] : null;

        if (!detectedUrl) return;

        // YouTube Shorts URL 감지 시 요약 제외
        if (detectedUrl.indexOf("youtube.com/shorts/") !== -1) {
            return;
        }

        // URL 중복 방지 (Map 기반)
        let nowMs = Date.now();
        if (recentUrlMap[detectedUrl] && (nowMs - recentUrlMap[detectedUrl]) < URL_DEDUP_INTERVAL) return;
        recentUrlMap[detectedUrl] = nowMs;
        cleanupRecentUrlMap();

        let payload = { text: messageContent };

        new Thread(function() {
            try {
                let response = postToFastAPI("/process-url", payload);

                if (response.success && response.data && response.data.gemini_summary) {
                    msg.reply(foldMessage(response.data.gemini_summary));
                } else if (!response.success) {
                    Log.e("URL 처리 API 요청 실패: " + response.error);
                }
            } catch (e) {
                Log.e("URL 처리 스레드 오류: " + e);
            }
        }).start();
    } catch (e) {
        Log.e("onMessage 오류: " + String(e));
    }
}

/* ==================== 이벤트 리스너 ==================== */

bot.setCommandPrefix('$');

bot.addListener(Event.COMMAND, onCommand);
bot.addListener(Event.MESSAGE, onMessage);

Log.i("외부 연동 봇 (v2.4) 로드됨");