---
name: apple-passwords
description: Use Apple Passwords on macOS when the user asks to save, retrieve, or autofill Apple/iCloud passwords or OTPs.
icon: https://static.asidehq.com/apps/builtin-skills/apple-password.jpg
autoInject:
  keywords: ["Apple Passwords", "iCloud Passwords", "Passwords app", "apple password", "icloud password"]
---
# Apple Passwords

Use the `applePasswords` global in the REPL to save, read, or autofill credentials from Apple's Passwords app on macOS.

## Critical Touch ID Rule

Before calling `getPasswords`, `getOtps`, `autofillLogin`, or `saveLogin`, notify the user first with the `notification` tool.
These calls can trigger macOS Apple Passwords UI and **will not return until the user approves or cancels it**.

Read/fill calls may require Touch ID. `saveLogin` normally shows a save/update notice instead, but it can still block.

Never ask the user to reveal a password, OTP seed, recovery code, or Touch ID result. Prefer `autofillLogin` when signing in because it fills the secret without printing it.

## Quick Reference

```js
// Check helper availability.
console.log(await applePasswords.capabilities());

// First-time auth, only when a call says Apple Passwords is not authenticated.
await applePasswords.requestAuth();
// Ask the user for the 6-digit Apple Passwords code only if macOS shows one.
await applePasswords.verifyAuth('<pin>');

// Find accounts for a site. No password is returned.
console.log(await applePasswords.listLogins('https://example.com'));
// -> [{ username, domains }]

// Notify the user before this call; it may wait on Touch ID.
const passwords = await applePasswords.getPasswords('https://example.com', 'me@example.com');
// -> [{ username, domain, password }]

// Notify the user before this call; it may wait on Touch ID.
await applePasswords.autofillLogin(page, {
  url: 'https://example.com',
  username: 'me@example.com',
  usernameField: 'e12',
  passwordField: 'e13',
  submit: true,
});
// -> { status: 'filled', username, domain, passwordFilled: true }

// Notify the user before this call; it may wait on Touch ID.
console.log(await applePasswords.getOtps('https://example.com'));
// -> [{ username, domain, code, source }]

// Notify first. Use explicit field refs so the password is never printed.
await applePasswords.saveLogin(page, {
  usernameField: 'e12',
  passwordField: 'e13',
});
// -> { status: 'saved', username, domain, passwordSaved: true }
```

## Method Contract

```ts
declare global {
  const applePasswords: ApplePasswordsApi;
}

interface ApplePasswordsApi {
  capabilities(): Promise<Record<string, unknown>>;
  requestAuth(): Promise<{ status: 'auth-requested'; instruction: string }>;
  verifyAuth(pin: string): Promise<{ status: 'authenticated' }>;
  listLogins(url: string): Promise<Array<{ username: string; domains: string[] }>>;
  getPasswords(url: string, username?: string): Promise<Array<{ username: string; domain: string; password: string }>>;
  getOtps(url: string): Promise<Array<{ username: string; domain: string; code: string; source?: string }>>;
  saveLogin(page: Page, options: {
    url?: string; // default: page.url(); HTTP(S) only
    username?: string; // use this or usernameField
    usernameField?: string; // snapshot ref or CSS selector
    password?: string; // use this or passwordField; never print it
    passwordField?: string; // snapshot ref or CSS selector
  }): Promise<{ status: 'saved'; username: string; domain: string; passwordSaved: true }>;
  autofillLogin(page: Page, options?: {
    url?: string; // default: page.url()
    username?: string; // required if multiple logins match
    usernameField?: string; // snapshot ref or CSS selector
    passwordField?: string; // snapshot ref or CSS selector; default: first password input
    submit?: boolean; // press Enter after filling password
  }): Promise<{ status: 'filled'; username: string; domain: string; passwordFilled: true }>;
}
```

## Selection Rules

- Use `listLogins(url)` first when account choice is unclear.
- If multiple logins match, choose by visible site/account context; ask the user only when genuinely ambiguous.
- Do not print passwords unless the user explicitly asked to retrieve/show the password. For login tasks, call `autofillLogin`.
- If `autofillLogin` cannot find fields automatically, take a fresh `snapshot()` and pass `usernameField` / `passwordField` refs.

## Save Rules

- `saveLogin` creates a new login or updates the password for an existing domain/username. Call `listLogins(url)` first; if that username already exists, tell the user it will be updated.
- If the user explicitly requested this exact save, do not ask a redundant question. If saving is inferred or the target is ambiguous, confirm first. Always follow `request_action_confirmation` when final-confirm mode requires it.
- Notify immediately before saving. Include only the domain and username, never the password.
- Prefer `usernameField` and `passwordField`, or runtime variables captured from those fields. Never put a literal password in REPL code, print it, or interpolate it into errors.
- A timeout or disconnect has an indeterminate result. Check `listLogins` or the Passwords app before retrying; never retry automatically.
- Saving is unavailable in incognito sessions.
