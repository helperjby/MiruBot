MessengerBotR Version-Specific Issues

<overview>
This document summarizes the changes, bugs, and caveats for each MessengerBotR version.
</overview>

<version_changelog>

v0.7.29a

Syntax Support Added

Feature

Notes

Arrow functions (=>)



let / const

Beware of const function scope (reassignment is silently ignored)

for...of



String.startsWith/endsWith/includes



String.padStart/padEnd/repeat



Array.find/findIndex



Object.assign



Number.isNaN/isInteger/MAX_SAFE_INTEGER



DataView



BigInt runtime support



Issue: responseFix

responseFix required for KakaoTalk 9.7.0+ compatibility

sender appears in place of room. Without responseFix, room-based conditions cannot be set, and messages cannot be sent to specific rooms

Unsupported: Template Literals

Template literals (`) are recognized as plain strings without error. ${value} substitution does not work and is rendered literally

Properly supported from v0.7.34a

Updating to v0.7.34a or above is recommended

v0.7.34a

Syntax Support Added

Feature

Notes

Template literals (`)



Destructuring assignment



Map / Set / WeakMap / WeakSet

Partial support

System Limitations

Issue

Condition

rankingMap and reason

Not provided below Android 8.0

Device.getWifiName()

Requires location permission

author.hash

Requires Android 11+ (undefined on lower versions)

channelId, logId

May be undefined below Android 10. Unverified: Occasional reports of being recognized as number instead of bigint on 0.7.40+ & Android 16+

Version Summary Table

Version

Major Changes

Issues

Fixes

Notes

v0.7.29a

Arrow functions, let/const, startsWith, etc.

responseFix (room↔sender), template literals unsupported



v0.7.34+ recommended

v0.7.34a

isMention/logId added, template literals, destructuring

Debug room NPE, replier.reply 2-arg removed





v0.7.36a

Legacy isMention etc. removed; API2 hash/isMultiChat; ??, default param

bot.send() error, Api/App inaccessible in modules

clearTimeout bug fix



v0.7.37a





bot.send(), debug room NPE fixed



v0.7.38a

Optional chaining (?.)

Bootstrapper error (opt set 0/-1)



Resolved by app restart

v0.7.39a

new Date() ISO parsing improvement, notificationRemoved

Critical: Cannot restart after force stop



Reinstall or clear app data

v0.7.40-alpha

GraalJS engine transition, FileStream/ ESM support





