---
name: KakaoTalk
description: Read your KakaoTalk chats and messages (read-only).
icon: https://static.asidehq.com/apps/builtin-skills/kakaotalk.svg
platform: ["mac"]
settingsGate: experimental.kakaotalk
---
# KakaoTalk

Use the `kakaotalk` REPL global to READ KakaoTalk chats and messages. macOS only; requires Full Disk Access for Aside Computer Use; unavailable in incognito. KakaoTalk is **read-only — there is no way to send a message.**

## Reading

```js
await kakaotalk.listChats({ limit: 20 })              // chats: chatId, name, isDirect, unreadCount, updatedAt, lastMessage
await kakaotalk.getHistory(chatId, { limit: 30 })     // chronological; each message carries logId, authorName, isFromMe
await kakaotalk.search({ text: '회식', limit: 20 })    // newest-first; optionally scope with chatId/since/until
```

- `chatId`, `logId`, and `authorId` are **strings** (the numeric ids exceed JS's safe-integer range) — pass them back verbatim.
- Message `type` 1 is plain text; other codes are media/emoticon/feed and may have no `text`.
- Page older history with `getHistory(chatId, { beforeLogId })` using the oldest `logId` you've seen.
- `search()` scans only the newest ~5000 candidate messages; if it warns of truncation, narrow with `chatId`, `since`, or `until`.
- Aggregate in the REPL and print only distilled results (counts, matched lines, a summary) — do not dump full threads.

## Permission errors

- **macOS permission error** (including when the user dismissed the setup dialog) → say in one line why you need it, emit an empty ` ```imessage-permission ` fenced block (it renders an inline "Grant access" button; the Full Disk Access grant is shared with Messages), and end your turn. Never `ask_user_question` for this; do not retry until the user confirms.
