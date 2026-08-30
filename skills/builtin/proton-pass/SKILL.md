---
name: proton-pass
description: Read this skill when the user uses Proton Pass.
---
# Proton Pass

## How to autofill

Proton Pass autofill options may appear after focusing a login form field.

1. Click the form you want to autofill.
2. Wait 500ms, up to 1 second, for the Proton Pass menu, icon, or iframe to appear.
3. Take a snapshot.

Then check whether the snapshot includes a Proton Pass autofill menu or `iframe [origin="Proton Pass"]`.

1. If the Proton Pass autofill menu is shown and it has an appropriate item for the task, use it.
2. If Proton Pass asks to unlock before showing items, follow the unlock flow below.
3. If neither the Proton Pass menu nor a Proton Pass unlock prompt is shown, Proton Pass is not available for the form.

## When Proton Pass is locked

Open the Proton Pass extension page only to unlock Proton Pass with Aside PWM:

`chrome-extension://ghmbeldphafepmbegfdlkpapadhbakde/popup.html`

Then run:

```js
await passwordManager.unlockExternalPasswordManager(page, 'proton-pass');
```

After unlocking Proton Pass:

1. Return to the original sign-in page.
2. Close the Proton Pass extension tab opened only for unlocking.
3. Refresh the original sign-in page if the Proton Pass menu does not reappear.
4. Click the form field again to reopen the autofill menu.
5. Continue from the Proton Pass menu on the original sign-in page.

Do not use the Proton Pass extension page as the primary place to search and autofill website logins.
Use the original sign-in page's Proton Pass autofill menu for website login autofill.

If Aside PWM is locked, ask the user to unlock either Aside PWM or Proton Pass.

If no saved Proton Pass unlock item is available in Aside PWM, fall back to other password manager options. Ask the user to unlock Proton Pass directly only as the last resort.
