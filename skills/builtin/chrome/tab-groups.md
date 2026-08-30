# Tab Groups API

Use `chrome.tabGroups.*` only to inspect Chrome tab groups. Raw group mutations are unavailable because they can modify the user's own browser session.

## Methods

### `chrome.tabGroups.query(queryInfo)`

- `queryInfo: { collapsed?: boolean; color?: string; title?: string; windowId?: number }`

### `chrome.tabGroups.get(groupId)`

- `groupId: number`
