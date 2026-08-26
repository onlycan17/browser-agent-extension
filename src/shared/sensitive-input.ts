const SENSITIVE_AUTOCOMPLETE_TOKENS = new Set([
  "one-time-code",
  "current-password",
  "new-password",
  "cc-number",
  "cc-csc",
  "cc-exp",
  "cc-exp-month",
  "cc-exp-year",
]);

export function isSensitiveAutocomplete(value: string | undefined): boolean {
  if (value === undefined) return false;
  return value
    .toLowerCase()
    .split(/\s+/)
    .some((token) => SENSITIVE_AUTOCOMPLETE_TOKENS.has(token));
}
