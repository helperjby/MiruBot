Rhino JS Environment Development Docs (MessengerBotR < 0.7.40)

<overview>
Rhino is a JavaScript engine implemented in Java, used in MessengerBotR versions below 0.7.40-alpha.02.
The same engine is also used in Chat Auto-Reply Bot, StarLight, etc.

Limited support for modern ES6+ features (gradually expanding per version)

Java classes can be used directly within JavaScript (via Packages dynamic resolution)

v0.7.40-alpha.03+ uses Graal JS

</overview>

<platform_environment>

App Download

Github (≤ 0.7.39a): https://github.com/MessengerBotTeam/msgbot-old-release

Graal JS (≥ 0.7.40): https://codeberg.org/naijun0403/messengerbot-r-releases/releases

The Play Store version is 0.7.29a; updating to the latest version is recommended

File Paths

Main script: sdcard/msgbot/Bots/{scriptName}/{scriptName}.js

Log: sdcard/msgbot/Bots/{scriptName}/log.json

Modules: sdcard/msgbot/Bots/{scriptName}/modules/, sdcard/msgbot/global_modules/

Permissions & Settings

Notification Access Permission (Required): KakaoTalk bots work by reading status bar notifications and auto-replying

Note: The bot will not work while the bot account is actively viewing KakaoTalk (since no notifications are generated)

Storage Access Permission (Required): Needed for script files and data storage
</platform_environment>

API2 Message Object

Property

Type

Notes

isMention

Boolean

Removed in v0.7.36a, restored in v0.7.41-alpha

userHash

String

Added in v0.7.34a, removed in v0.7.36a, restored in v0.7.41-alpha

userHash is recommended over ImageDB for user identification purposes.

Replier

reply(msg: string): void
reply(room: string, msg: string, hideToast?: boolean): boolean // Send to another room. false means no session
markAsRead(room?: string, packageName?: string): boolean


Caution: In v0.7.34a~v0.7.38a, the 2-argument replier.reply(room, msg) was removed. During this period, use replier.reply(room, msg, false) (3 arguments) or replier.reply(msg) (1 argument).

ImageDB

getProfileImage(): string // Base64-encoded profile image
getProfileBase64(): string
// The following 4 methods no longer work
getImage(): android.graphics.Bitmap
getImageBase64(): string
getImageDB(imageUri: string): android.graphics.Bitmap
getImageDB(imageUri: string, boolean): android.graphics.Bitmap


onStartCompile Event Listener

function onStartCompile() {
    // Logic executed right **before** compilation
}


onNotificationPosted Event Listener

function onNotificationPosted(sbn, sm) {
    // Logic executed when a notification is received
}


SessionManager

bindSession(packageName: string, room: string, action: android.app.Notification.Action): void
