import { LocalNetworkAccessError, testProviderConnection } from "../shared/provider-connection";
import { getProviderDefinition, isProviderId } from "../shared/providers";
import { RuntimeRequestError, sendRuntimeRequest } from "../shared/runtime-client";
import {
  parseProviderSettings,
  type ProviderId,
  type ProviderSettings,
  type SettingsSummary,
} from "../shared/settings";
import { getProviderDefaults } from "./provider-defaults";
import {
  ensureProviderHostPermission,
  removeObsoleteProviderHostPermission,
  removeProviderHostPermission,
  type HostPermissionsApi,
} from "./provider-permission";

interface SettingsElements {
  form: HTMLFormElement;
  provider: HTMLSelectElement;
  baseUrl: HTMLInputElement;
  baseUrlHelp: HTMLElement;
  model: HTMLInputElement;
  apiKey: HTMLInputElement;
  providerKeyHelp: HTMLElement;
  rememberApiKey: HTMLInputElement;
  keyStatus: HTMLElement;
  localWarning: HTMLElement;
  customWarning: HTMLElement;
  status: HTMLElement;
  saveButton: HTMLButtonElement;
  testButton: HTMLButtonElement;
}

class SettingsInputError extends Error {}

const permissionsApi: HostPermissionsApi = {
  contains: (permissions) => chrome.permissions.contains(permissions),
  request: (permissions) => chrome.permissions.request(permissions),
  remove: (permissions) => chrome.permissions.remove(permissions),
};

let currentSummary: SettingsSummary | null = null;

type ElementConstructor<T extends Element> = new () => T;

function getElement<T extends Element>(selector: string, type: ElementConstructor<T>): T {
  const element = document.querySelector(selector);
  if (!(element instanceof type)) throw new Error(`Missing required settings element: ${selector}`);
  return element;
}

function collectElements(): SettingsElements {
  return {
    form: getElement("#settings-form", HTMLFormElement),
    provider: getElement("#provider", HTMLSelectElement),
    baseUrl: getElement("#base-url", HTMLInputElement),
    baseUrlHelp: getElement("#base-url-help", HTMLElement),
    model: getElement("#model", HTMLInputElement),
    apiKey: getElement("#api-key", HTMLInputElement),
    providerKeyHelp: getElement("#provider-key-help", HTMLElement),
    rememberApiKey: getElement("#remember-api-key", HTMLInputElement),
    keyStatus: getElement("#key-status", HTMLElement),
    localWarning: getElement("#local-warning", HTMLElement),
    customWarning: getElement("#custom-warning", HTMLElement),
    status: getElement("#settings-status", HTMLElement),
    saveButton: getElement("#save-button", HTMLButtonElement),
    testButton: getElement("#test-button", HTMLButtonElement),
  };
}

function providerId(value: string): ProviderId {
  return isProviderId(value) ? value : "local";
}

function providerKeyHelp(provider: ProviderId): string {
  if (provider === "local") return "Local API token은 서버가 요구할 때만 입력하세요.";
  if (provider === "custom") return "등록할 API 업체가 요구하는 key를 입력하세요.";
  return `${getProviderDefinition(provider).label}에서 발급받은 API key가 필요합니다.`;
}

function renderProviderFields(elements: SettingsElements, provider: ProviderId): void {
  const definition = getProviderDefinition(provider);
  elements.baseUrl.readOnly = !definition.editableBaseUrl;
  elements.baseUrlHelp.textContent = definition.editableBaseUrl
    ? "HTTPS OpenAI-compatible API의 versioned Base URL을 입력하세요."
    : "공식 provider origin으로 고정됩니다.";
  elements.providerKeyHelp.textContent = providerKeyHelp(provider);
  elements.localWarning.hidden = provider !== "local";
  elements.customWarning.hidden = provider !== "custom";
}

function renderSummary(elements: SettingsElements, summary: SettingsSummary): void {
  elements.provider.value = summary.provider;
  elements.baseUrl.value = summary.baseUrl;
  elements.model.value = summary.model;
  elements.rememberApiKey.checked = summary.rememberApiKey;
  elements.keyStatus.textContent = summary.hasApiKey
    ? "저장된 API 키가 있습니다. 새 값을 입력하면 교체됩니다."
    : "저장된 API 키가 없습니다.";
  renderProviderFields(elements, summary.provider);
}

function setStatus(elements: SettingsElements, message: string, state = "idle"): void {
  elements.status.textContent = message;
  elements.status.dataset.state = state;
}

function setBusy(elements: SettingsElements, busy: boolean): void {
  elements.saveButton.disabled = busy;
  elements.testButton.disabled = busy;
  elements.form.setAttribute("aria-busy", String(busy));
}

function rawSettings(elements: SettingsElements): ProviderSettings {
  const base = {
    provider: providerId(elements.provider.value),
    baseUrl: elements.baseUrl.value,
    model: elements.model.value,
    rememberApiKey: elements.rememberApiKey.checked,
  };
  const apiKey = elements.apiKey.value.trim();
  return apiKey.length === 0 ? base : { ...base, apiKey };
}

function validatedSettings(elements: SettingsElements): ProviderSettings {
  const result = parseProviderSettings(rawSettings(elements));
  if (!result.ok) throw new SettingsInputError(result.error);
  return result.value;
}

function errorMessage(error: unknown): string {
  if (
    error instanceof RuntimeRequestError ||
    error instanceof LocalNetworkAccessError ||
    error instanceof SettingsInputError
  ) {
    return error.message;
  }
  return "설정 요청을 완료하지 못했습니다.";
}

async function saveSettings(elements: SettingsElements): Promise<SettingsSummary> {
  const settings = validatedSettings(elements);
  const permission = await ensureProviderHostPermission(settings, permissionsApi);
  if (!permission.granted)
    throw new SettingsInputError("Custom provider origin 권한이 필요합니다.");
  const previous = currentSummary;
  let summary: SettingsSummary;
  try {
    summary = await sendRuntimeRequest("SETTINGS_SAVE", settings);
  } catch (error: unknown) {
    if (permission.newlyGranted) await removeProviderHostPermission(settings, permissionsApi);
    throw error;
  }
  await removeObsoleteProviderHostPermission(previous, summary, permissionsApi);
  currentSummary = summary;
  elements.apiKey.value = "";
  renderSummary(elements, summary);
  return summary;
}

async function handleSave(elements: SettingsElements): Promise<void> {
  setBusy(elements, true);
  setStatus(elements, "설정을 저장하는 중입니다.");
  try {
    await saveSettings(elements);
    setStatus(elements, "설정을 안전하게 저장했습니다.", "success");
  } catch (error: unknown) {
    setStatus(elements, errorMessage(error), "error");
  } finally {
    setBusy(elements, false);
  }
}

async function handleConnectionTest(elements: SettingsElements): Promise<void> {
  setBusy(elements, true);
  setStatus(elements, "설정을 저장하고 모델 서버를 확인하는 중입니다.");
  try {
    const summary = await saveSettings(elements);
    const result = await testProviderConnection(summary, () =>
      sendRuntimeRequest("CONNECTION_TEST", {}),
    );
    const availability = result.selectedModelAvailable
      ? "선택 모델을 확인했습니다."
      : "서버는 연결됐지만 선택 모델이 없습니다.";
    setStatus(elements, `${summary.provider.toUpperCase()} 연결 성공 · ${availability}`, "success");
  } catch (error: unknown) {
    setStatus(elements, errorMessage(error), "error");
  } finally {
    setBusy(elements, false);
  }
}

function applyProviderDefaults(elements: SettingsElements): void {
  const provider = providerId(elements.provider.value);
  const defaults = getProviderDefaults(provider);
  elements.baseUrl.value = defaults.baseUrl;
  elements.model.value = defaults.model;
  elements.apiKey.value = "";
  renderProviderFields(elements, provider);
}

function registerEvents(elements: SettingsElements): void {
  elements.provider.addEventListener("change", () => {
    applyProviderDefaults(elements);
  });
  elements.form.addEventListener("submit", (event) => {
    event.preventDefault();
    void handleSave(elements);
  });
  elements.testButton.addEventListener("click", () => {
    void handleConnectionTest(elements);
  });
}

async function initialize(): Promise<void> {
  const elements = collectElements();
  registerEvents(elements);
  try {
    currentSummary = await sendRuntimeRequest("SETTINGS_GET", {});
    renderSummary(elements, currentSummary);
    setStatus(elements, "현재 설정을 불러왔습니다.");
  } catch (error: unknown) {
    setStatus(elements, errorMessage(error), "error");
  }
}

void initialize();
