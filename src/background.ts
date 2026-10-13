import { closeWindowsOwnedBy } from './capture/orphans';
import { CAPTURE_COMMAND } from './commands';

const controllerUrl = chrome.runtime.getURL('controller/index.html');

// The shortcut works from the capture window, so preparing a shot never needs a
// trip back to the controller. The controller decides whether a capture is pending.
chrome.commands.onCommand.addListener((command) => {
  if (command !== CAPTURE_COMMAND) return;
  void chrome.runtime.sendMessage({ type: CAPTURE_COMMAND }).catch(() => undefined);
});

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
