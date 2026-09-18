const $ = (id) => document.getElementById(id);
const status = (msg, cls) => {
  const el = $("status");
  el.textContent = msg;
  el.className = cls ?? "";
};

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

(async () => {
  const { apiBase, apiKey } = await chrome.storage.local.get(["apiBase", "apiKey"]);
  if (!apiBase || !apiKey) {
    $("setup").hidden = false;
    $("apiBase").value = apiBase ?? "http://localhost:4100";
    $("save").addEventListener("click", async () => {
      await chrome.storage.local.set({
        apiBase: $("apiBase").value.trim().replace(/\/$/, ""),
        apiKey: $("apiKey").value.trim(),
      });
      location.reload();
    });
    return;
  }

  $("capture").hidden = false;
  const tab = await activeTab();
  $("url").textContent = tab.url ?? "";
  if (tab.title) $("title").value = tab.title;

  $("go").addEventListener("click", async () => {
    $("go").disabled = true;
    status("Capturing…");
    try {
      const res = await fetch(`${apiBase}/api/v1/capture`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
        },
        body: JSON.stringify({
          url: tab.url,
          title: $("title").value || undefined,
          note: $("note").value || undefined,
        }),
      });
      if (!res.ok) throw new Error(`API ${res.status}`);
      const data = await res.json();
      status(
        `✅ Captured "${data.companyName}"${data.dealId ? " + deal created" : ""}`,
        "ok",
      );
      setTimeout(() => window.close(), 1200);
    } catch (err) {
      status(`❌ ${err.message}`, "err");
      $("go").disabled = false;
    }
  });
})();
