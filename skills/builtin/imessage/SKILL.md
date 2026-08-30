---
name: Messages
description: Read iMessages conversations, text someone, or get SMS codes.
icon: https://static.asidehq.com/apps/builtin-skills/imessage.svg
platform: ["mac"]
---
# iMessage

Use the `imessage` REPL global to read and send Messages.app iMessage/SMS. macOS only; requires macOS permissions for Aside Computer Use; unavailable in incognito.

## Reading

```js
await imessage.listChats({ limit: 20 })            // chats: guid, name, participants, unreadCount, lastMessage
await imessage.getHistory(chatGuid, { limit: 30 }) // chronological; every message carries rowid
await imessage.search({ text: 'dinner', sender: '+14155551212', since: new Date('2026-08-01'), limit: 20 })  // defaults to the last 90 days — pass `since` for older
await imessage.contacts('Mom')                     // name → { phones, emails } handles
```

- Aggregate in the REPL and print only distilled results (counts, matched lines, a summary) — do not dump full threads into output.
- For "anything new since X", pass `sinceRowid` from previously seen messages instead of re-reading history.

## Waiting (2FA codes)

```js
await imessage.waitForCode()                       // → { status: 'received', code, sender, receivedAt } | { status: 'timeout', sinceRowid }
```

- During a login that sends an SMS/iMessage verification code, call `waitForCode()` instead of asking the user to read their phone. Codes from the last minute match too (the SMS may already have arrived); older history never does. Do not search the thread yourself first.
- On `timeout`, tell the user you're still waiting; resume later with the returned `sinceRowid` — nothing is lost.
- To wait for a reply in a chat, re-check `getHistory(chatGuid, { sinceRowid })` the same way.

## Sending

```js
await imessage.send({ chatGuid, text })                      // existing chat (preferred; groups + SMS threads)
await imessage.send({ to: '+14155551212', text, attachmentPaths: ['tmp/itinerary.pdf', 'tmp/photo.png'] })  // 1:1 iMessage
```

1. Always show the exact recipient and text as an `imessage-draft` card before sending — a preview, same contract as the Gmail skill; the session's confirmation mode decides whether it blocks. Never call `ask_user_question` for a send. Include 2–5 recent thread lines as `messages`, and `attachments: ["artifacts/report.pdf", "artifacts/photo.png"]` (session-relative paths) when files go along. Put every file in one send — do not split attachments across multiple `send()` calls.
   - `request_action_confirmation` available (final-confirm mode) → call it with `{ type: 'imessage-draft', data: { to, draft, messages, attachments? } }` and send only what the user approves.
   - Otherwise → emit the payload bare in a fenced block (no `type`/`data` wrapper), then continue with the send:

     ````
     ```imessage-draft
     {"to":"Mom","draft":"test","messages":[{"sender":"me","message":"Hello"}]}
     ```
     ````

   Stop and ask first only when you had to guess — an ambiguous recipient, or wording the user did not give you.
2. Exactly ONE `send()` per repl call, and nothing else in that call.
3. Prefer `chatGuid` from `listChats()` for existing conversations. Use `to` only for 1:1 messages; a contact name works only when it resolves to exactly one handle (ambiguity throws with candidates — ask the user to pick).
4. `send()` returns `{ status: 'delivered' | 'unconfirmed' }` and THROWS when Messages reports a delivery failure. Never claim a message arrived on a throw. On `unconfirmed`, say it was sent but delivery is not confirmed yet.
5. Cannot create new group chats. SMS to non-iPhone recipients requires the user's iPhone Text-Message-Forwarding; replying into an existing SMS thread via its `chatGuid` works.

## Permission errors

- **macOS permission error** (including when the user dismissed the setup dialog) → say in one line why you need it, emit an empty ` ```imessage-permission ` fenced block (it renders an inline "Grant access" button that opens the permission sheet), and end your turn. Never `ask_user_question` for this; do not retry until the user confirms.
- **Automation error** (first send) → tell the user to allow "Aside Computer Use" → "Messages" in System Settings → Privacy & Security → Automation, then retry the send.
