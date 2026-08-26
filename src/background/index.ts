import { parseAgentEvent, type AgentEvent } from "../shared/agent";
import { openPanelForAction } from "./action-panel";
import { AgentRunner } from "./agent-runner";
import { AgentToolExecutor } from "./agent-tools";
import { ApprovalManager } from "./approval-manager";
import { createMessageHandler } from "./message-handler";
import { ProviderClientRouter } from "./provider-client";
import { SafetyPolicy } from "./safety-policy";
import { SettingsRepository } from "./settings-repository";
import { createChromeTabAdapter, TabService } from "./tab-service";

const PANEL_BEHAVIOR = { openPanelOnActionClick: false } as const;
const settingsRepository = new SettingsRepository(chrome.storage.local, chrome.storage.session);
const providerClient = new ProviderClientRouter();
const tabService = new TabService(createChromeTabAdapter());
const approvalManager = new ApprovalManager();
const toolExecutor = new AgentToolExecutor(
  tabService,
  new SafetyPolicy(),
  approvalManager,
  emitAgentEvent,
);
const agentRunner = new AgentRunner(
  settingsRepository,
  tabService,
  providerClient,
  toolExecutor,
  approvalManager,
  emitAgentEvent,
);
const handleMessage = createMessageHandler(
  settingsRepository,
  providerClient,
  agentRunner,
  emitAgentEvent,
);

function reportBootstrapFailure(): void {
  console.error("Browser Agent could not initialize extension services.");
}

function reportEventDeliveryFailure(): void {
  console.error("Browser Agent could not deliver an agent status event.");
}

function emitAgentEvent(event: AgentEvent): void {
  void chrome.runtime.sendMessage(event).catch(reportEventDeliveryFailure);
}

async function bootstrap(): Promise<void> {
  await Promise.all([
    chrome.sidePanel.setPanelBehavior(PANEL_BEHAVIOR),
    settingsRepository.restrictSecretAccess(),
  ]);
}

chrome.action.onClicked.addListener((tab) => {
  openPanelForAction(tab, chrome.sidePanel, reportBootstrapFailure);
});

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || parseAgentEvent(message) !== null) return false;
  void handleMessage(message).then(
    (response) => {
      sendResponse(response);
    },
    () => {
      sendResponse({
        id: "unknown",
        ok: false,
        error: {
          code: "INTERNAL_ERROR",
          message: "The extension could not complete the request.",
          retryable: true,
        },
      });
    },
  );
  return true;
});

void bootstrap().catch(reportBootstrapFailure);
