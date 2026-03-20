Graal JS Environment Development Docs (MessengerBotR ≥ 0.7.40-alpha.03)

<overview>
GraalJS is used in MessengerBotR versions 0.7.40-alpha.03 and above.

Broad support for modern JavaScript (ES6+) features (class, async/await, Promise, etc.)

Java classes can be used directly within JavaScript (Java.type() or direct reference)

< v0.7.40-alpha.03 uses Rhino JS

</overview>

<platform_environment>

App Download

Official (latest): https://codeberg.org/naijun0403/messengerbot-r-releases/releases

Github (≤ 0.7.39a): https://github.com/MessengerBotTeam/msgbot-old-release

File Paths

Main script: sdcard/msgbot/Bots/{scriptName}/{scriptName}.js

Log: sdcard/msgbot/Bots/{scriptName}/log.json

Modules: sdcard/msgbot/Bots/{scriptName}/node_modules/

Permissions & Settings

Notification Access Permission (Required): KakaoTalk bots work by reading status bar notifications and auto-replying.

Note: The bot will not work while the bot account is actively viewing KakaoTalk (since no notifications are generated).

Storage Access Permission (Required): Needed for script files and data storage.

Battery Optimization Exemption: Prevents background termination.

Doze Mode Exclusion: MessengerBotR Common Settings -> Doze Mode -> Exception.

Network

Supported: org.jsoup.Jsoup
</platform_environment>

API2 Message Object

Property

Type

Notes

content

String



room

String



isGroupChat

Boolean



author.name

String



author.hash

String

Requires Android 11+

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


MediaSender (Media Transmission)

A built-in object provided by MessengerBotR to send media files (photos, videos, etc.) stored in the device's local storage to KakaoTalk chat rooms.
Due to recent Android security policy enhancements (Scoped Storage) and KakaoTalk updates, the legacy method of sending external URLs directly (bot.sendImage) is often blocked. Downloading the file to the device and sending it via MediaSender is the current standard.

1. Main Methods

new MediaSender(): Creates an instance of the MediaSender object.

getBaseDirectory(): Returns the dedicated base directory path (String) where MessengerBotR can safely read and write files. You must save files inside this path to avoid permission errors.

send(channelId: BigInt | Number, filePaths: java.lang.String[]): Sends the media files located at the local paths to the specified chat room.

channelId: The unique identifier from API2 (msg.channelId).

filePaths: A Java String Array (java.lang.String[]) containing the absolute paths of the local files to send.

returnToAppNow(): Closes the KakaoTalk share screen that briefly opened for media transmission and returns to MessengerBotR. You must give KakaoTalk enough time to upload the image before calling this, typically by using a delay like java.lang.Thread.sleep(1500).

2. 🚨 [Crucial] Graal JS Array Type Casting Issue

When calling send() in the Graal JS environment, passing a pure JavaScript array ([]) will result in an Argument Mismatch error (or fail silently) because the Java engine does not recognize it as a Java String[]. You must explicitly cast it to a Java array using java.lang.reflect.Array.

✅ Correct Transmission Example

let sender = new MediaSender();
let localPaths = [ sender.getBaseDirectory() + "/image.jpg" ]; // Pure JS Array

// 1. Explicitly cast JS Array to Java String Array
let javaPaths = java.lang.reflect.Array.newInstance(java.lang.String, localPaths.length);
for (let j = 0; j < localPaths.length; j++) {
    javaPaths[j] = localPaths[j];
}

// 2. Send and return to app (Must be executed inside a separate Thread)
if (sender.send(msg.channelId, javaPaths)) {
    java.lang.Thread.sleep(1500); // Wait 1.5 seconds (Guarantees KakaoTalk upload time)
    sender.returnToAppNow();      // Return to screen
}


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
