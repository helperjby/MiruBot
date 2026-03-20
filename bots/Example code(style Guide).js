/**
 * @description 원문자 기반 달력
 * @environment v0.7.41-alpha
 *
 * 명령어
 * - !달력: 이번 달 달력 출력
 * - !달력 <MM>: 올해 <MM>월 달력 출력 (예: !달력 12)
 * - !달력 <YYYY-MM>: 해당 월 달력 출력 (예: !달력 2025-12)
 * - !달력 <YYYY> <MM>: 해당 월 달력 출력 (예: !달력 2025 12)
 */

/* ==================== 전역 상수/변수 ==================== */

const bot = BotManager.getCurrentBot();
const PREFIX = "!";

const CIRCLE = [
    "①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨", "⑩",
    "⑪", "⑫", "⑬", "⑭", "⑮", "⑯", "⑰", "⑱", "⑲", "⑳",
    "㉑", "㉒", "㉓", "㉔", "㉕", "㉖", "㉗", "㉘", "㉙", "㉚", "㉛"
];

const DAYS = ["일", "월", "화", "수", "목", "금", "토"];
const SPACE = "　"; // 요일 칸 정렬용
const GAP = "\u2002"; // 간격 조절용 (En Space)

/* ==================== 함수 ==================== */

/**
 * @description 월간 달력 문자열 생성
 * @param {number} year 예: 2025
 * @param {number} month 1~12
 * @return {string}
 */
function renderCalendar(year, month) {
    if (!(month >= 1 && month <= 12)) {
        throw new Error("month must be 1~12");
    }

    const firstDow = new Date(year, month - 1, 1).getDay();
    const lastDate = new Date(year, month, 0).getDate();

    const mm = month < 10 ? `0${month}` : `${month}`;
    let out = `📅 ${year}-${mm}\n`;
    out += DAYS.join(" ") + "\n";

    // 1일 전까지 빈칸 채우기
    for (let i = 0; i < firstDow; i++) {
        const isLineEnd = (i % 7 === 6);
        out += SPACE + (isLineEnd ? "\n" : GAP);
    }

    // 날짜 채우기
    for (let day = 1; day <= lastDate; day++) {
        const colIndex = (firstDow + (day - 1)) % 7;
        const cell = CIRCLE[day - 1];

        out += cell + (colIndex === 6 ? "\n" : GAP);
    }

    return out.trimEnd();
}

/* ==================== 이벤트 리스너 ==================== */

bot.setCommandPrefix(PREFIX);

bot.addListener(Event.COMMAND, function(cmd) {
    if (cmd.command === "달력") {
        let year = new Date().getFullYear();
        let month = new Date().getMonth() + 1;

        if (cmd.args.length > 0) {
            if (cmd.args.length === 1) {
                if (cmd.args[0].includes("-")) {
                    let parts = cmd.args[0].split("-");
                    year = parseInt(parts[0]);
                    month = parseInt(parts[1]);
                } else {
                    month = parseInt(cmd.args[0]);
                }
            } else if (cmd.args.length >= 2) {
                year = parseInt(cmd.args[0]);
                month = parseInt(cmd.args[1]);
            }
        }

        try {
            let result = renderCalendar(year, month);
            cmd.reply(result);
        } catch (e) {
            cmd.reply("오류: 올바른 날짜 형식을 입력해주세요.");
        }
    }
});