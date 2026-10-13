import { closeWindowsOwnedBy } from './capture/orphans';

const controllerUrl = chrome.runtime.getURL('controller/index.html');

// A controller closed mid-run leaves its capture window debugged and emulated.
chrome.tabs.onRemoved.addListener((tabId) => {
  void closeWindowsOwnedBy(tabId).catch(() => undefined);
});

chrome.action.onClicked.addListener(async () => {
  const contexts = await chrome.runtime.getContexts({ documentUrls: [controllerUrl] });
  const existing = contexts.find((context) => context.tabId !== undefined);

  if (existing?.tabId !== undefined) {
    await chrome.tabs.update(existing.tabId, { active: true });
    if (existing.windowId !== undefined) {
      await chrome.windows.update(existing.windowId, { focused: true });
    }
    return;
  }

  await chrome.tabs.create({ url: controllerUrl });
});
