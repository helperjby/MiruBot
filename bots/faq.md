FAQ / Frequently Asked Questions

<environment_setup>

Environment Setup

Q1. What environment is required to use MessengerBotR?

OS: Android 5.0 or higher (Android 11+ recommended — some features like author.hash require Android 11+)

App: MessengerBotR

Official (latest): https://codeberg.org/naijun0403/messengerbot-r-releases/releases

Github (≤ 0.7.39a): https://github.com/MessengerBotTeam/msgbot-old-release

Engine: v0.7.40-alpha.02 and below = Rhino JS, v0.7.40-alpha.03 and above = GraalJS

Q2. How do I set up notification access permission?

KakaoTalk bots operate based on status bar notifications, so notification access permission is required.

Android Settings → Notification Access → Enable MessengerBotR

Q3. What is the difference between Legacy API and API2?

Item

Legacy API

API2

Structure

Function-based (function response(...))

Event-based (bot.addListener(...))

Recommended

Not recommended

Recommended

Message reception

response() function

Event.MESSAGE event

Message sending

replier.reply()

msg.reply() or bot.send()

Script management

Api object

Bot, BotManager objects

Inter-script communication

Bridge object

Broadcast object

Docs

https://kbotdocs.dev/reference/legacy

https://kbotdocs.dev/reference/api2

Q38. rankingMap and reason are null in notificationRemoved.

Below Android 8.0, rankingMap and reason arguments are not provided

Q39. Did Legacy response parameters come back in v0.7.41-alpha?

The isMention, logId, channelId, userHash parameters that were removed in v0.7.36a have been restored in v0.7.41-alpha.

Q40. eval does not work. (v0.7.41-alpha)

In v0.7.41-alpha, eval may be restricted by script settings

Check script settings

Q41. What are the things KakaoTalk bots cannot do?

KakaoTalk bots operate on a notification-based system, so the following features are impossible or limited:

Detecting user join/leave (no notifications are generated)

Detecting replies

Accessing deleted/hidden messages

Accessing original quality images/attachments

File processing (file information is not included in notifications)

Original quality images, attachments, join/leave detection, etc. are technically possible by directly accessing the KakaoTalk DB, but this is extremely difficult and constitutes a violation of KakaoTalk's Terms of Service, so it is not recommended.

Q42. Open chat thread (reply) messages are not received in KakaoTalk 26.1.3+.

Messages sent via the open chat thread (reply) feature in KakaoTalk 26.1.3+ are not delivered through onMessage/onCommand events. Direct notification (noti) parsing is required to receive them.