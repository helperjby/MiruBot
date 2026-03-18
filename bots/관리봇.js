/**
 * [관리봇] 유틸리티 스크립트 (API2, GraalJS 환경 최적화)
 *
 * 각 채팅방별로 유저 해시값을 독립적으로 로깅(Logging)하고
 * 봇 상태 및 방 정보를 확인하는 유틸리티입니다.
 *
 * @version 0.7.41-alpha.2 기준
 */

// 1. 전역 변수 및 상수 선언 (전역은 const 사용 가능)
const bot = BotManager.getCurrentBot(); 

// ==========================================================
// ⭐ 리스너 충돌 방지 및 클린업
// ==========================================================
function onStartCompile() {
    bot.removeAllListeners(Event.COMMAND); 
    bot.removeAllListeners(Event.MESSAGE); 
    Log.i("관리봇: 이전 리스너가 성공적으로 제거되었습니다.");
}

// ==========================================================
// ⭐ API2 Message 이벤트 핸들러 (방별 유저 정보 로깅)
// ==========================================================
function onMessage(msg) {
    // 함수 내부는 반드시 let 사용
    let sender = msg.author.name; 
    let hash = msg.author.hash; 

    // 안드로이드 11 이상이라 해시값이 정상적으로 존재할 때만 로깅
    if (hash) {
        // 방의 고유 ID를 문자열로 변환하여 파일명으로 사용 (특수문자 에러 방지)
        let channelIdStr = String(msg.channelId);
        let dbPath = "sdcard/bot/user_hash_" + channelIdStr + ".json";
        
        let dbString = FileStream.read(dbPath) || "{}"; 
        let db;
        
        try {
            db = JSON.parse(dbString);
        } catch (e) {
            db = {}; // JSON 파싱 실패 시 빈 객체로 초기화
        }

        // DB에 기록된 해시값과 현재 해시값이 다를 때만 파일 갱신 (디바이스 부하 방지)
        if (db[sender] !== hash) {
            db[sender] = hash;
            FileStream.write(dbPath, JSON.stringify(db, null, 2)); 
        }
    }
}

// ==========================================================
// ⭐ API2 Command 이벤트 핸들러 (명령어 처리)
// ==========================================================
function onCommand(cmd) {
    // 함수 내 모든 변수는 let으로 선언합니다.
    let replyMsg = ""; 
    
    switch (cmd.command) {
        // ------------------------------------
        // 1. 기본 생존 확인
        // ------------------------------------
        case "핑":
        case "테스트":
            cmd.reply("퐁!"); 
            break;

        // ------------------------------------
        // 2. 핵심 정보 확인 (방)
        // ------------------------------------
        case "여기":
        case "방정보":
            replyMsg = "--- 현재 방 정보 ---\n";
            replyMsg += "• 방 이름: " + cmd.room + "\n"; 
            replyMsg += "• 채널 ID: " + cmd.channelId + "\n"; 
            replyMsg += "• 그룹채팅: " + cmd.isGroupChat + "\n"; 
            replyMsg += "• 메시지 Log ID: " + cmd.logId; 
            
            cmd.reply(replyMsg);
            break;

        // ------------------------------------
        // 3. 핵심 정보 확인 (사용자)
        // ------------------------------------
        case "나":
        case "내정보":
            replyMsg = "--- 내 정보 ---\n";
            replyMsg += "• 이름: " + cmd.author.name + "\n"; 
            
            let userHash = cmd.author.hash; 
            
            if (userHash) {
                replyMsg += "• 유저 해시: " + userHash;
            } else {
                replyMsg += "• 유저 해시: 확인 불가 (Android 11 미만)";
            }
            
            cmd.reply(replyMsg);
            break;

        // ------------------------------------
        // 4. 전체 봇 상태 관리
        // ------------------------------------
        // (봇목록 코드는 그대로 유지)
        case "봇목록":
            let botList = BotManager.getBotList(); //
            replyMsg = "--- 설치된 봇 목록 ---\n";
            for (let i = 0; i < botList.length; i++) { //
                replyMsg += "• " + botList[i].getName() + "\n";
            }
            cmd.reply(replyMsg);
            break;

        case "응답체크":
            let currentRoom = cmd.room;
            let allBots = BotManager.getBotList();
            
            let checkResult = "현재 방 [" + currentRoom + "] 응답을 체크합니다..\n";
            
            for (let j = 0; j < allBots.length; j++) {
                let targetBot = allBots[j];
                let botName = targetBot.getName();
                let isAlive = targetBot.canReply(currentRoom);
                
                if (isAlive) {
                    checkResult += botName + " : ✅ 동작 중\n";
                } else {
                    checkResult += botName + " : ❌ 비활성\n";
                }
            }
            
            cmd.reply(checkResult.trim());
            break;

        // ------------------------------------
        // 5. 유저 해시 검색 (현재 방 기준)
        // ------------------------------------
        case "해시검색":
            let targetName = cmd.args.join(" "); 
            
            if (!targetName) {
                cmd.reply("❌ 검색할 닉네임을 입력해주세요.\n(예: !해시검색 홍길동)");
                break;
            }

            // 현재 명령어가 입력된 방의 고유 ID로 해당 방의 DB 파일을 읽어옴
            let channelIdStr = String(cmd.channelId);
            let dbPath = "sdcard/bot/user_hash_" + channelIdStr + ".json";
            
            let dbString = FileStream.read(dbPath) || "{}"; 
            let dbObj;
            
            try {
                dbObj = JSON.parse(dbString);
            } catch (e) {
                dbObj = {};
            }

            let foundHash = dbObj[targetName];
            
            if (foundHash) {
                cmd.reply("🔍 현재 방에서 찾은 [" + targetName + "]님의 해시값:\n" + foundHash);
            } else {
                cmd.reply("❌ 현재 방(" + cmd.room + ")에서 [" + targetName + "]님의 기록을 찾을 수 없습니다.\n(대상이 한 번이라도 채팅을 쳐야 기록됩니다.)");
            }
            break;

        // ------------------------------------
        // 6. 봇 권한 테스트
        // ------------------------------------
        case "권한테스트":
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
                cmd.reply("❌ 테스트 실패 (Exception)\n- 오류: " + e.message);
                Log.e("권한테스트 실패: " + e.message); 
            }
            break;

        // ------------------------------------
        // 7. 고급 디버깅 (객체 덤프)
        // ------------------------------------
        case "객체확인":
        case "덤프":
            let result = "[CMD 객체 속성 덤프]\n" + "=".repeat(15) + "\n\n";
            
            for (let prop in cmd) { 
                try {
                    let type = typeof cmd[prop]; 
                    result += "• " + prop + " (" + type + ")\n"; 
                } catch (e) {
                    result += "• " + prop + " (접근 오류)\n";
                }
            }
            
            let viewMore = "\u200b".repeat(500);
            cmd.reply(result + "\n" + viewMore + "(상세 내용은 '더보기' 확인)"); 
            break;
    }
}

// 2. 리스너 등록
bot.setCommandPrefix("!"); 
bot.addListener(Event.MESSAGE, onMessage); 
bot.addListener(Event.COMMAND, onCommand); 

// 3. 스크립트 로드 완료 로그
Log.i("관리봇 유틸리티 스크립트가 로드되었습니다.");