---
name: jira
siteSpecific: true
description: Jira Cloud issue, search, and list-view guidance.
icon: https://static.asidehq.com/apps/builtin-skills/jira.svg
autoInject:
  url:
    - "*.atlassian.net/jira/**"
    - "*.atlassian.net/browse/**"
    - "*.atlassian.net/issues/**"
---
# Jira

## Canonical URLs

- Your work: `https://${site}.atlassian.net/jira/your-work`
- Issue: `https://${site}.atlassian.net/browse/${issueKey}`
- Search with JQL: `https://${site}.atlassian.net/issues/?jql=${urlEncodedJql}`

## Working style

- Prefer direct issue URLs and JQL result URLs over navigating menus.
- If the issue key is known, go straight to `/browse/${issueKey}`.
- Use list view for bulk triage and inline editing.
- Use detail view when the task is about a single issue.

## Useful shortcuts

- Create work item: `c`
- Quick search: `/`
- Advanced search after quick search: `/`, then `Enter`
- Quick actions or screen navigation: `.`
- Shortcut help: `?`
- Command palette: `Cmd/Ctrl+K`
- Next / previous item: `j`, `k`
- Open selected item: `o`
- Assign: `a`
- Assign to me: `i`
- Comment: `m`
- Next / previous board column: `n`, `p`
