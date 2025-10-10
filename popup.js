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

// --- Custom Select Logic ---

function closeAllSelect() {
    const allItemsDivs = document.querySelectorAll(".select-items");
    const allSelectedDivs = document.querySelectorAll(".select-selected");

    allItemsDivs.forEach(itemsDiv => itemsDiv.style.display = "none");
    allSelectedDivs.forEach(selectedDiv => selectedDiv.classList.remove("select-arrow-active"));
}

function initializeCustomSelects() {
    const wrappers = document.querySelectorAll(".custom-select-wrapper");

    wrappers.forEach(wrapper => {
        const selectEl = wrapper.querySelector("select");
        if (!selectEl || wrapper.querySelector('.select-selected')) return; // Already initialized

        // Create the main display element
        const selectedDiv = document.createElement("div");
        selectedDiv.className = "select-selected";
        selectedDiv.innerHTML = selectEl.options[selectEl.selectedIndex].innerHTML;
        wrapper.appendChild(selectedDiv);

        // Create the options container
        const itemsDiv = document.createElement("div");
        itemsDiv.className = "select-items";

        Array.from(selectEl.children).forEach(child => {
            if (child.tagName.toLowerCase() === 'optgroup') {
                const optgroupDiv = document.createElement("div");
                optgroupDiv.className = "select-optgroup";
                optgroupDiv.innerHTML = child.label;
                itemsDiv.appendChild(optgroupDiv);

                Array.from(child.children).forEach(option => createOptionDiv(option));
            } else if (child.tagName.toLowerCase() === 'option') {
                createOptionDiv(child);
            }
        });

        wrapper.appendChild(itemsDiv);

        function createOptionDiv(optionEl) {
            const itemDiv = document.createElement("div");
            itemDiv.className = "select-item";
            itemDiv.innerHTML = optionEl.innerHTML;
            itemDiv.setAttribute("data-value", optionEl.value);

            if (optionEl.value === selectEl.value) {
                itemDiv.classList.add("same-as-selected");
            }

            itemsDiv.appendChild(itemDiv);

            itemDiv.addEventListener("click", function() {
                for (let i = 0; i < selectEl.options.length; i++) {
                    if (selectEl.options[i].value === this.getAttribute('data-value')) {
                        selectEl.selectedIndex = i;
                        break;
                    }
                }

                selectedDiv.innerHTML = this.innerHTML;

                const sameAsSelected = itemsDiv.querySelector(".same-as-selected");
                if (sameAsSelected) {
                    sameAsSelected.classList.remove("same-as-selected");
                }
                this.classList.add("same-as-selected");

                closeAllSelect();
            });
        }

        selectedDiv.addEventListener("click", function(e) {
            e.stopPropagation();
            if (!this.classList.contains("select-arrow-active")) {
                closeAllSelect();
            }
            itemsDiv.style.display = itemsDiv.style.display === "block" ? "none" : "block";
            this.classList.toggle("select-arrow-active");
        });
    });
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

        // Initialize the custom select AFTER loading the settings
        initializeCustomSelects();

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

// Close the custom select if the user clicks outside of it
document.addEventListener("click", closeAllSelect);
