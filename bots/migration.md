Rhino JS → Graal JS Migration Guide

A document summarizing the migration steps needed when updating from MessengerBotR v0.7.39 and below (Rhino) → v0.7.40-alpha.03 and above (GraalJS).

<prerequisites>

Prerequisites

[ ] Check current app version (v0.7.39 or below)

[ ] Check target update version (v0.7.40-alpha.03 or above)

[ ] Full backup of project folder (scripts/modules)

App Download

Official (latest): https://codeberg.org/naijun0403/messengerbot-r-releases/releases

Github (≤ 0.7.39a): https://github.com/MessengerBotTeam/msgbot-old-release

</prerequisites>

<required_changes>

1. Module Path Change (Required)

The most important Breaking Change.

Changes

Item

Rhino (Before)

Graal (After)

Project module folder

modules/

node_modules/

Global module folder

global_modules/

Unsupported (removed)

ESM modules

Unsupported

Supported — Use .mjs extension for ESM

Per-script module path

sdcard/msgbot/Bots/{scriptName}/modules/

sdcard/msgbot/Bots/{scriptName}/node_modules/

Note: GraalJS supports ESM (import/export). Use .mjs extension for ESM modules. .js files are treated as CJS (CommonJS).

API Conversion Changes

Legacy

API2

Api.getContext()

App.getContext()

Api.UIThread()

App.runOnUiThread()

Bridge.getScopeOf()

Broadcast.send() / register()

DataBase.getDataBase()

Database.readString()

DataBase.setDataBase()

Database.writeString()

secondTick

Event.TICK (not implemented in MessengerBotR)

onStartCompile

Event.START_COMPILE

Conversion Example

// Legacy
function response(room, msg, sender, isGroupChat, replier) {
    if (msg == "hello") {
        replier.reply("Hello, " + sender + "!");
    }
}

// API2
const bot = BotManager.getCurrentBot();
bot.addListener(Event.MESSAGE, (msg) => {
    if (msg.content === "hello") {
        msg.reply(`Hello, ${msg.author.name}!`);
    }
});


</optional_upgrades>

<testing>

10. Post-Migration Test Checklist

[ ] Message reception/response works correctly

[ ] require() module loading works correctly (node_modules path)

[ ] Java class access works correctly (Java.type())

[ ] Bot.send() return value check (false means no session)

[ ] Bot.markAsRead() works correctly

[ ] Notification event (notificationPosted) works correctly

[ ] Broadcast-based inter-script communication works correctly

[ ] Error logs are recorded correctly on error

[ ] Timers (setTimeout/setInterval) work correctly

</testing>