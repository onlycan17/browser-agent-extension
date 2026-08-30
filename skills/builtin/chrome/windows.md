# Windows API

Use `chrome.windows.*` only to inspect Chrome window state. Raw window mutations are unavailable because they can modify the user's own browser session.

## Methods

### `chrome.windows.get(windowId, queryOptions?)`

- `windowId: number`
- `queryOptions?: { populate?: boolean; windowTypes?: string[] }`

### `chrome.windows.getCurrent(queryOptions?)`

- `queryOptions?: { populate?: boolean; windowTypes?: string[] }`

### `chrome.windows.getLastFocused(queryOptions?)`

- `queryOptions?: { populate?: boolean; windowTypes?: string[] }`

### `chrome.windows.getAll(queryOptions?)`

- `queryOptions?: { populate?: boolean; windowTypes?: string[] }`
