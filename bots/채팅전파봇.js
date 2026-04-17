/**
 * @description 채팅 전파 봇 (임시)
 * @environment v0.7.41-alpha
 *
 * A방(room_id: 464553280790419)의 채팅을 수다방(room_id: 18301468764762222)으로 전파
 */

/* ==================== 전역 상수/변수 ==================== */

const bot = BotManager.getCurrentBot();
const PREFIX = "!";

const DESTINATION_ROOM_NAME = "수다방";
const ADMIN_HASHES = [
    "94c9c06f8ad5", //제이
    "2d391954f81d",
    "e5a0e976d576",
    "fe711d5acfa6" //머왕그적
];
const HASH_LENGTH = 12;

const SOURCE_ROOMS = {
    "464553280790419": "흉악범 엄예림:",
    "464553579205369": "엄예림인척 하는 티그"
};

let relayEnabled = true;
const disabledRooms = {};

/* ==================== 함수 ==================== */

function truncHash(h) {
    return h ? h.substring(0, HASH_LENGTH) : null;
}

function isAdmin(hash) {
    return !!hash && ADMIN_HASHES.includes(hash);
}

/** 닉네임으로 SOURCE_ROOMS에서 roomId 검색 (정규화 기반) */
function findRoomByNickname(searchName) {
    const normSearch = searchName.replace(/\s/g, "");
    const entries = Object.keys(SOURCE_ROOMS);

    // 1단계: 정확 일치
    for (let i = 0; i < entries.length; i++) {
        const roomId = entries[i];
        if (SOURCE_ROOMS[roomId].replace(/\s/g, "") === normSearch) {
            return roomId;
        }
    }

    // 2단계: 부분 일치
    for (let i = 0; i < entries.length; i++) {
        const roomId = entries[i];
        if (SOURCE_ROOMS[roomId].replace(/\s/g, "").includes(normSearch)) {
            return roomId;
        }
    }

    return null;
}

/* ==================== 이벤트 리스너 ==================== */

bot.setCommandPrefix(PREFIX);

bot.addListener(Event.COMMAND, function(cmd) {
    const hash = truncHash(cmd.author.hash);
    if (!isAdmin(hash)) return;

    if (cmd.command === "수감자") {
        // 인자 있으면 개별 토글
        if (cmd.args.length > 0) {
            const searchName = cmd.args.join(" ");
            const roomId = findRoomByNickname(searchName);
            if (!roomId) return cmd.reply("❌ 해당 닉네임의 수감자를 찾을 수 없습니다.");

            disabledRooms[roomId] = !disabledRooms[roomId];
            const nickname = SOURCE_ROOMS[roomId];
            cmd.reply(`${nickname} ${disabledRooms[roomId] ? "차단 ❌" : "허용 ✅"}`);
            return;
        }

        // 인자 없으면 명단 출력
        const roomIds = Object.keys(SOURCE_ROOMS);
        let list = "";
        for (let i = 0; i < roomIds.length; i++) {
            const roomId = roomIds[i];
            const status = disabledRooms[roomId] ? "❌" : "✅";
            list += `${i + 1}. ${status} ${SOURCE_ROOMS[roomId]}\n`;
        }
        const globalStatus = relayEnabled ? "ON ✅" : "OFF ❌";
        cmd.reply(`[면회실 ${globalStatus}]\n현재 수감된 명단은 ${roomIds.length}명입니다.\n${list.trimEnd()}`);
        return;
    }

    if (cmd.command === "면회실") {
        const searchName = cmd.args.join(" ");

        // 인자 없으면 전체 토글
        if (!searchName) {
            relayEnabled = !relayEnabled;
            cmd.reply(`면회실 ${relayEnabled ? "ON ✅" : "OFF ❌"}`);
            return;
        }

        // 인자 있으면 개별 토글
        const roomId = findRoomByNickname(searchName);
        if (!roomId) return cmd.reply("❌ 해당 닉네임의 수감자를 찾을 수 없습니다.");

        disabledRooms[roomId] = !disabledRooms[roomId];
        const nickname = SOURCE_ROOMS[roomId];
        cmd.reply(`${nickname} ${disabledRooms[roomId] ? "차단 ❌" : "허용 ✅"}`);
        return;
    }

    if (cmd.command === "수감자" && cmd.args.length > 0) {
        const searchName = cmd.args.join(" ");
        const roomId = findRoomByNickname(searchName);
        if (!roomId) return cmd.reply("❌ 해당 닉네임의 수감자를 찾을 수 없습니다.");

        disabledRooms[roomId] = !disabledRooms[roomId];
        const nickname = SOURCE_ROOMS[roomId];
        cmd.reply(`${nickname} ${disabledRooms[roomId] ? "차단 ❌" : "허용 ✅"}`);
        return;
    }
});

bot.addListener(Event.MESSAGE, function(msg) {
    if (!relayEnabled) return;

    const roomId = String(msg.channelId);
    const nickname = SOURCE_ROOMS[roomId];
    if (!nickname) return;
    if (disabledRooms[roomId]) return;

    const relayMessage = `${nickname}\n${msg.content}`;
    try {
        bot.send(DESTINATION_ROOM_NAME, relayMessage, msg.packageName);
    } catch (e) {
        Log.e("[채팅전파봇] 전파 오류: " + e);
    }
});
