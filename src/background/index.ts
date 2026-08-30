import { parseAgentEvent, type AgentEvent } from "../shared/agent";
import { openPanelForAction } from "./action-panel";
import { AgentRunner } from "./agent-runner";
import { AgentToolExecutor } from "./agent-tools";
import { ApprovalManager } from "./approval-manager";
import { createStorageMemoryRepository, StorageAgentMemoryService } from "./agent-memory-service";
import { createMessageHandler } from "./message-handler";
import { ProviderClientRouter } from "./provider-client";
import { SafetyPolicy } from "./safety-policy";
import { SettingsRepository } from "./settings-repository";
import { createRuntimeSkillAdapter, SkillService } from "./skill-service";
import { createChromeTabAdapter, TabService } from "./tab-service";
import { TranscriptSummaryService } from "./transcript-summary-service";

const PANEL_BEHAVIOR = { openPanelOnActionClick: false } as const;
const settingsRepository = new SettingsRepository(chrome.storage.local, chrome.storage.session);
const providerClient = new ProviderClientRouter();
const tabAdapter = createChromeTabAdapter();
const tabService = new TabService(tabAdapter);
tabAdapter.onTabCreated((tab) => {
  tabService.noteTabCreated(tab);
});
const approvalManager = new ApprovalManager();
const transcriptSummaryService = new TranscriptSummaryService(tabService, providerClient);
const toolExecutor = new AgentToolExecutor(
  tabService,
  new SafetyPolicy(),
  approvalManager,
  emitAgentEvent,
);
const memoryService = new StorageAgentMemoryService(
  createStorageMemoryRepository(chrome.storage.local),
);
const skillService = new SkillService(createRuntimeSkillAdapter());
const agentRunner = new AgentRunner(
  settingsRepository,
  tabService,
  providerClient,
  toolExecutor,
  approvalManager,
  emitAgentEvent,
  transcriptSummaryService,
  memoryService,
  undefined,
  undefined,
  skillService,
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
