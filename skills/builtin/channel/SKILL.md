---
name: channel
description: Read and act through the configured Slack, Discord, or Telegram bot connection that started the current task. Use for channel history, thread and user lookup, posting, editing, deleting, reactions, subscriptions, and typing indicators.
metadata:
  internal: true
---
# Channel

Use the `channel` global in REPL. It exposes the complete Chat SDK `moderator` agent surface through the bot connection that started the current task.

Call `channel.current()` first when you need the platform or default ids:

```js
console.log(channel.current());
// { platform, threadId, channelId, messageId }
```

Methods default to the current thread, channel, and inbound message where their target is optional. Pass explicit full Chat SDK ids to target another location reachable by the same bot connection.

## Read

```js
await channel.fetchMessages({ limit: 20, cursor, direction: 'backward' });
await channel.fetchChannelMessages({ limit: 20, cursor, direction: 'backward' });
await channel.fetchThread();
await channel.listThreads({ limit: 20, cursor });
await channel.getThreadParticipants();
await channel.getChannelInfo();
await channel.getUser('platform-user-id');
```

`fetchMessages`, `fetchThread`, and `getThreadParticipants` accept an optional `threadId`. `fetchChannelMessages`, `listThreads`, and `getChannelInfo` accept an optional `channelId`.

## Write

```js
await channel.postMessage({ message: { markdown: '**Hello**' } });
await channel.postChannelMessage({ message: 'Top-level message' });
await channel.sendDirectMessage({ userId: 'platform-user-id', message: 'Hello' });
await channel.editMessage({ messageId: 'bot-message-id', message: 'Updated' });
await channel.deleteMessage({ messageId: 'bot-message-id' });
await channel.addReaction({ emoji: 'moneybag' });
await channel.removeReaction({ emoji: 'moneybag' });
await channel.subscribeThread();
await channel.unsubscribeThread();
await channel.startTyping({ status: 'Working…' });
```

Message bodies accept a plain string, `{ markdown }`, or `{ raw }`. Posting methods accept optional `threadId` or `channelId`; edit, delete, and reaction methods accept an optional `threadId`; reaction methods also accept an optional `messageId`.

Use Slack shortcode names without colons, such as `moneybag`. Use Unicode emoji on Discord and Telegram, such as `💰`.

Only edit or delete messages authored by the bot. Perform visible writes only when the user requested them.
