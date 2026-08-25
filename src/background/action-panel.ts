interface ActionTab {
  id?: number | undefined;
}

interface SidePanelOpener {
  open(options: { tabId: number }): Promise<void>;
}

export function openPanelForAction(
  tab: ActionTab,
  sidePanel: SidePanelOpener,
  onFailure: () => void,
): void {
  if (tab.id === undefined) return;
  void sidePanel.open({ tabId: tab.id }).catch(onFailure);
}
