// --- Element References ---
const apiKeyInput = document.getElementById("apiKey");
const modelSelect = document.getElementById("modelSelect");
const sourceLanguageSelect = document.getElementById("sourceLanguageSelect");
const targetLanguageSelect = document.getElementById("targetLanguageSelect");
const autoSitesTextarea = document.getElementById("autoSites");
const saveSettingsButton = document.getElementById("saveSettings");
const translateButton = document.getElementById("translatePage");
const revertButton = document.getElementById("revertPage");
const clearCacheButton = document.getElementById("clearCache");
const statusDiv = document.getElementById("status");

// --- Functions ---
function showStatus(message, duration = 3000, isError = false) {
    statusDiv.textContent = message;
    statusDiv.style.color = isError ? "#e53e3e" : "#38a169";
    if (duration > 0) {
        setTimeout(() => {
            statusDiv.textContent = "";
        }, duration);
    }
}

async function getActiveTab() {
    try {
        const [tab] = await chrome.tabs.query({
            active: true,
            currentWindow: true,
        });
        return tab;
    } catch (error) {
        console.error("Failed to get active tab:", error);
        return null;
    }
}

async function ensureContentScript(tabId) {
    try {
        const results = await chrome.scripting.executeScript({
            target: { tabId: tabId },
            func: () => window.isGeminiTranslatorInjected,
        });
        if (!results || !results[0] || !results[0].result) {
            await chrome.scripting.executeScript({
                target: { tabId: tabId },
                files: ["content.js"],
            });
        }
    } catch (error) {
        console.error("Failed to inject content script:", error);
        throw new Error("Cannot run on this page");
    }
}

// --- Event Listeners ---

document.addEventListener("DOMContentLoaded", () => {
    const keysToGet = [
        "geminiApiKey",
        "selectedModel",
        "sourceLanguage",
        "targetLanguage",
        "autoTranslateSites",
    ];
    chrome.storage.sync.get(keysToGet, (settings) => {
        if (chrome.runtime.lastError) {
            showStatus("Failed to load settings", 3000, true);
            return;
        }
        if (settings.geminiApiKey) apiKeyInput.value = settings.geminiApiKey;
        if (settings.selectedModel) modelSelect.value = settings.selectedModel;
        if (settings.sourceLanguage)
            sourceLanguageSelect.value = settings.sourceLanguage;
        if (settings.targetLanguage)
            targetLanguageSelect.value = settings.targetLanguage;
        if (settings.autoTranslateSites) {
            autoSitesTextarea.value = settings.autoTranslateSites.join("\n");
        }
        showStatus("Settings loaded successfully", 2000);
    });
});

saveSettingsButton.addEventListener("click", () => {
    if (!apiKeyInput.value.trim()) {
        showStatus("API Key is required", 3000, true);
        return;
    }

    const settings = {
        geminiApiKey: apiKeyInput.value.trim(),
        selectedModel: modelSelect.value,
        sourceLanguage: sourceLanguageSelect.value,
        targetLanguage: targetLanguageSelect.value,
        autoTranslateSites: autoSitesTextarea.value
            .split("\n")
            .map((s) => s.trim())
            .filter(Boolean),
    };

    chrome.storage.sync.set(settings, () => {
        if (chrome.runtime.lastError) {
            showStatus("Failed to save settings", 3000, true);
        } else {
            showStatus("Settings saved successfully!");
        }
    });
});

translateButton.addEventListener("click", async () => {
    const tab = await getActiveTab();
    if (!tab || !tab.url || tab.url.startsWith("chrome://")) {
        showStatus("Cannot run on this page", 3000, true);
        return;
    }

    try {
        await ensureContentScript(tab.id);
        chrome.tabs.sendMessage(tab.id, {
            action: "translate",
            sourceLanguage: sourceLanguageSelect.value,
            targetLanguage: targetLanguageSelect.value,
        });
        showStatus("Translation started...");
        window.close();
    } catch (error) {
        showStatus(error.message, 3000, true);
    }
});

revertButton.addEventListener("click", async () => {
    const tab = await getActiveTab();
    if (!tab || !tab.url || tab.url.startsWith("chrome://")) {
        showStatus("Cannot run on this page", 3000, true);
        return;
    }
    try {
        await ensureContentScript(tab.id);
        chrome.tabs.sendMessage(tab.id, { action: "revert" });
        showStatus("Reverting translations...");
        window.close();
    } catch (error) {
        showStatus(error.message, 3000, true);
    }
});

clearCacheButton.addEventListener("click", () => {
    chrome.runtime.sendMessage({ action: "clearCache" }, () => {
        if (chrome.runtime.lastError) {
            showStatus("Failed to clear cache", 3000, true);
        } else {
            showStatus("Translation cache cleared");
        }
    });
});