// --- Element References ---
const apiKeyInput = document.getElementById('apiKey');
const modelSelect = document.getElementById('modelSelect');
const languageSelect = document.getElementById('languageSelect');
const autoSitesTextarea = document.getElementById('autoSites');
const saveSettingsButton = document.getElementById('saveSettings');
const translateButton = document.getElementById('translatePage');
const revertButton = document.getElementById('revertPage');
const clearCacheButton = document.getElementById('clearCache');
const statusDiv = document.getElementById('status');

// --- Functions ---
function showStatus(message, duration = 3000, isError = false) {
    statusDiv.textContent = message;
    statusDiv.style.color = isError ? '#dc3545' : '#28a745';
    if (duration > 0) {
        setTimeout(() => {
            statusDiv.textContent = '';
            statusDiv.style.color = '#555';
        }, duration);
    }
}

async function getActiveTab() {
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        return tab;
    } catch (error) {
        console.error('Failed to get active tab:', error);
        return null;
    }
}

// Inject content script if not already present
async function ensureContentScript(tabId) {
    try {
        const results = await chrome.scripting.executeScript({
            target: { tabId: tabId },
            func: () => window.isGeminiTranslatorInjected,
        });

        if (!results || !results[0] || !results[0].result) {
            await chrome.scripting.executeScript({
                target: { tabId: tabId },
                files: ['content.js'],
            });
        }
    } catch (error) {
        console.error('Failed to inject content script:', error);
        throw new Error('Cannot run on this page');
    }
}

// Validate settings before saving
function validateSettings() {
    const apiKey = apiKeyInput.value.trim();
    const model = modelSelect.value;
    const language = languageSelect.value;

    if (!apiKey) {
        throw new Error('API Key is required');
    }

    if (!model) {
        throw new Error('Please select a model');
    }

    if (!language) {
        throw new Error('Please select a target language');
    }

    return { apiKey, model, language };
}

// --- Event Listeners ---

// Load all saved settings when the popup opens
document.addEventListener('DOMContentLoaded', () => {
    const keysToGet = ['geminiApiKey', 'selectedModel', 'targetLanguage', 'autoTranslateSites'];
    chrome.storage.sync.get(keysToGet, (settings) => {
        if (chrome.runtime.lastError) {
            showStatus('Failed to load settings', 3000, true);
            return;
        }

        if (settings.geminiApiKey) apiKeyInput.value = settings.geminiApiKey;
        if (settings.selectedModel) modelSelect.value = settings.selectedModel;
        if (settings.targetLanguage) languageSelect.value = settings.targetLanguage;
        if (settings.autoTranslateSites) {
            autoSitesTextarea.value = settings.autoTranslateSites.join('\n');
        }
        showStatus('Settings loaded successfully', 2000);
    });
});

// Save all settings to Chrome storage
saveSettingsButton.addEventListener('click', () => {
    try {
        validateSettings();

        const settings = {
            geminiApiKey: apiKeyInput.value.trim(),
            selectedModel: modelSelect.value,
            targetLanguage: languageSelect.value,
            autoTranslateSites: autoSitesTextarea.value
                .split('\n')
                .map(s => s.trim())
                .filter(Boolean)
        };

        chrome.storage.sync.set(settings, () => {
            if (chrome.runtime.lastError) {
                showStatus('Failed to save settings', 3000, true);
            } else {
                showStatus('Settings saved successfully!');
            }
        });
    } catch (error) {
        showStatus(error.message, 3000, true);
    }
});

// Translate Page Button
translateButton.addEventListener('click', async () => {
    const tab = await getActiveTab();
    if (!tab) {
        showStatus('Failed to get current tab', 3000, true);
        return;
    }

    if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('moz-extension://')) {
        showStatus('Cannot run on this page', 3000, true);
        return;
    }

    try {
        await ensureContentScript(tab.id);
        chrome.tabs.sendMessage(tab.id, {
            action: 'translate',
            targetLanguage: languageSelect.value
        });
        showStatus('Translation started...');
        window.close();
    } catch (error) {
        showStatus(error.message, 3000, true);
    }
});

// Revert Page Button
revertButton.addEventListener('click', async () => {
    const tab = await getActiveTab();
    if (!tab) {
        showStatus('Failed to get current tab', 3000, true);
        return;
    }

    if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('moz-extension://')) {
        showStatus('Cannot run on this page', 3000, true);
        return;
    }

    try {
        await ensureContentScript(tab.id);
        chrome.tabs.sendMessage(tab.id, { action: 'revert' });
        showStatus('Reverting translations...');
        window.close();
    } catch (error) {
        showStatus(error.message, 3000, true);
    }
});

// Clear Cache Button
clearCacheButton.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'clearCache' }, (response) => {
        if (chrome.runtime.lastError) {
            showStatus('Failed to clear cache', 3000, true);
        } else {
            showStatus('Translation cache cleared');
        }
    });
});

// Add cache clearing handler to service worker
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'clearCache') {
        // This would be handled in service-worker.js
        sendResponse({ success: true });
    }
});