# Tabs API

Use `chrome.tabs.*` only to inspect tab strip state. Raw tab mutations are unavailable because they can modify the user's own browser session. Use `openTab(url)` and `closeTab(page)` for tab lifecycle, and `page.goto()`, `page.click()`, or locator methods for page interaction. If the attached page is a borrowed user tab, those page methods still change that tab's content.

## Methods

### `chrome.tabs.query(queryInfo)`

- `queryInfo: { active?: boolean; currentWindow?: boolean; windowId?: number; url?: string | string[]; title?: string; pinned?: boolean; audible?: boolean; discarded?: boolean; groupId?: number; index?: number }`

### `chrome.tabs.get(tabId)`

- `tabId: number`
