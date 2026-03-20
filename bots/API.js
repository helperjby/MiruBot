/*
 * [외부 연동 봇] - Jsoup 직접 호출 / 비동기 처리 버전 (v2.3)
 *
 * [업데이트 사항]
 * 1. MediaSender 보안 정책 대응 (로컬 파일 다운로드 후 전송)
 * 2. 이미지 잘림 방지 (maxBodySize(0))
 * 3. !윤호, !미루 명령어 범위 제한: 1~4장 허용 (5장 이상 시 무반응)
 * 4. YouTube Shorts URL 요약 제외 로직 추가
 * 5. onCommand, onMessage 전체 try-catch 적용 (봇 크래시 방지)
 * 6. (v2.3) onCommand 내부 msg 참조 버그 수정
 * 7. (v2.3) MediaSender.send() JS 배열 -> Java 배열 타입 호환성 문제 수정
 */

const bot = BotManager.getCurrentBot();
const Thread = Packages.java.lang.Thread;
const Jsoup = org.jsoup.Jsoup;
const File = java.io.File;
const FileOutputStream = java.io.FileOutputStream;

const FASTAPI_BASE_URL = "http://192.168.0.133:8080";

// ▼▼▼ URL 요약 예외 처리할 채팅방 ID 목록 ▼▼▼
const URL_SUMMARY_EXCLUSION_LIST = [
    "18301469121654912", // 공지 전파 방
    "457451860712164"    // 모비봇
];

/**
 * Jsoup 라이브러리를 직접 사용하여 FastAPI 서버에 요청 (동기)
 */
const postToFastAPI = (endpoint, payload) => {
    let url = FASTAPI_BASE_URL + endpoint;
    let payloadJson = JSON.stringify(payload);
    let response;

    try {
        response = Jsoup.connect(url)
            .header("Content-Type", "application/json")
            .timeout(20000)
            .maxBodySize(1024 * 1024) // [추가됨] 1MB 제한: OOM(메모리 부족) 튕김 현상 방지
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

function onCommand(cmd) {
    try {
        // [수정됨] msg.content -> cmd.content 참조로 변경하여 예외 발생 방지
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

let lastProcessedUrl = "";
let lastProcessedTime = 0;

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
            let payload = { text: messageContent };

            new Thread(function() {
                try {
                    let response = postToFastAPI("/process-url", payload);

                    if (response.success && response.data && response.data.gemini_summary) {
                        if (messageContent === "!증시") {
                            let fullText = response.data.gemini_summary;
                            let firstLineBreak = fullText.indexOf('\n');
                            let replyMsg;
                            if (firstLineBreak !== -1) {
                                let headline = fullText.substring(0, firstLineBreak);
                                let summary = fullText.substring(firstLineBreak + 1);
                                let viewMore = "\u200b".repeat(500);
                                replyMsg = headline + "\n" + viewMore + "\n" + summary;
                            } else {
                                replyMsg = fullText;
                            }
                            msg.reply(replyMsg);
                        } else if (messageContent === "!환율") {
                            let headline = response.data.headline;
                            let summary = response.data.gemini_summary;
                            let cleanedSummary = summary.replace(/\n\n/g, '\n');
                            msg.reply(headline + "\n" + cleanedSummary);
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
            let count = 1; // 기본값

            // 숫자 범위 체크 로직 (1~4 허용, 5 이상 무시)
            if (!isNaN(requestedCount)) {
                if (requestedCount > 4) return; // 4 초과 시 반응 안 함
                if (requestedCount < 1) requestedCount = 1; // 1 미만 시 1로 보정
                count = requestedCount;
            }

            Log.i(`명령어 감지: !${categoryName} ${count}장. 처리 시작.`);

            new Thread(function() {
                try {
                    // 1. API 호출 (단일 호출)
                    let url = `${FASTAPI_BASE_URL}/images/random/${category}?count=${count}`;

                    let response = Jsoup.connect(url)
                        .timeout(30000)
                        .ignoreContentType(true)
                        .method(org.jsoup.Connection.Method.GET)
                        .ignoreHttpErrors(true)
                        .execute();

                    let statusCode = response.statusCode();
                    if (statusCode < 200 || statusCode >= 300) {
                        Log.e(`!${categoryName} API 오류: ${statusCode}`);
                        return;
                    }

                    let responseData = JSON.parse(response.body());
                    let imageUrls = responseData.urls; // 서버에서 받은 URL 배열

                    if (!imageUrls || imageUrls.length === 0) {
                        Log.e(`!${categoryName}: 이미지 URL을 받지 못했습니다.`);
                        return;
                    }

                    // 2. 이미지 다운로드 및 로컬 저장 (MediaSender 보안 정책 대응)
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
                                              .maxBodySize(0) // 무제한
                                              .userAgent("Mozilla/5.0")
                                              .execute();

                            let bytes = imgRes.bodyAsBytes();
                            let fos = new FileOutputStream(savePath);
                            fos.write(bytes);
                            fos.close();

                            // 저장된 파일 크기 로깅으로 검증
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

                        // [핵심 수정] JavaScript Array 객체를 Java String[] 배열 객체로 변환
                        // Rhino / GraalJS 상관없이 MediaSender 내부 Java 메서드 시그니처와 가장 정확하게 호환됨
                        let javaPaths = java.lang.reflect.Array.newInstance(java.lang.String, localPaths.length);
                        for (let j = 0; j < localPaths.length; j++) {
                            javaPaths[j] = localPaths[j];
                        }

                        let success = sender.send(msg.channelId, javaPaths);
                        
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

        // [추가됨] YouTube Shorts URL 감지 시 요약 제외
        if (detectedUrl.indexOf("youtube.com/shorts/") !== -1) {
            return;
        }

        let nowMs = Date.now();
        if (detectedUrl === lastProcessedUrl && (nowMs - lastProcessedTime) < 2000) return;
        lastProcessedUrl = detectedUrl;
        lastProcessedTime = nowMs;

        let payload = { text: messageContent };

        new Thread(function() {
            try {
                let response = postToFastAPI("/process-url", payload);

                if (response.success && response.data && response.data.gemini_summary) {
                    let fullSummary = response.data.gemini_summary;
                    let firstLineBreak = fullSummary.indexOf('\n');
                    let replyMsg;

                    if (firstLineBreak !== -1) {
                        let title = fullSummary.substring(0, firstLineBreak);
                        let body = fullSummary.substring(firstLineBreak + 1).trim();

                        if (body.length > 0) {
                            let viewMore = "\u200b".repeat(500);
                            replyMsg = title + "\n" + viewMore + "\n" + body;
                        } else {
                            replyMsg = title;
                        }
                    } else {
                        replyMsg = fullSummary;
                    }
                    msg.reply(replyMsg);

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

bot.setCommandPrefix('$');

bot.addListener(Event.COMMAND, onCommand);
bot.addListener(Event.MESSAGE, onMessage);

Log.i("외부 연동 봇 (v2.3) 로드됨");