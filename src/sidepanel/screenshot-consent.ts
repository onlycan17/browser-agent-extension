interface ScreenshotConsentControl {
  checked: boolean;
}

export function resetScreenshotConsent(control: ScreenshotConsentControl): void {
  control.checked = false;
}

export function consumeScreenshotConsent(control: ScreenshotConsentControl): boolean {
  const allowed = control.checked;
  resetScreenshotConsent(control);
  return allowed;
}
