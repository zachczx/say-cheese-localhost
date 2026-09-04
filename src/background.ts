const controllerUrl = chrome.runtime.getURL('controller/index.html');

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
