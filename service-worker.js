/* eslint-disable no-console */

// --- Caching & Rate Limiting ---
const translationCache = new Map();
const MAX_CACHE_SIZE = 1000;
let apiCallQueue = [];
let isProcessingQueue = false;
const MAX_CONCURRENT_CALLS = 3;
const MIN_DELAY_BETWEEN_CALLS = 1000; // ms
const RESPONSE_SEPARATOR = "|||---|||";

// --- API Endpoints ---
const GEMINI_API_BASES = [
    "https://generativelanguage.googleapis.com/v1",
    "https://generativelanguage.googleapis.com/v1beta",
];
const XAI_API_BASE = "https://api.x.ai/v1";

// --- Context Menu Setup ---
chrome.runtime.onInstalled.addListener(() => {
    try {
        chrome.contextMenus.removeAll(() => {
            chrome.contextMenus.create({
                id: "translateSelection",
                title: "Translate selected text",
                contexts: ["selection"],
            });
        });
    } catch (error) {
        console.error("Failed to setup context menu:", error);
    }
});

// --- Injected Script for Context Menu Action ---
function replaceAndTranslateSelection(sourceLanguage, targetLanguage) {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return;
    const selectedText = selection.toString().trim();
    if (!selectedText) return;

    const range = selection.getRangeAt(0);
    const wrapper = document.createElement("span");
    wrapper.className = "gemini-translated-selection";
    wrapper.style.cssText = "font-style: italic; cursor: pointer;";
    wrapper.textContent = "Translating...";
    wrapper.dataset.originalText = selectedText;
    range.deleteContents();
    range.insertNode(wrapper);

    chrome.runtime
        .sendMessage({
            action: "getSelectionTranslation",
            text: selectedText,
            sourceLanguage: sourceLanguage,
            targetLanguage: targetLanguage,
        })
        .then((response) => {
            wrapper.style.fontStyle = "normal";
            if (response && response.success) {
                const translatedText = response.translation;
                wrapper.textContent = translatedText;
                wrapper.title = `Original: "${selectedText}" (Click to revert)`;

                wrapper.addEventListener("click", function (e) {
                    e.preventDefault();
                    e.stopPropagation();
                    const isShowingTranslation =
                        this.textContent === translatedText;
                    if (isShowingTranslation) {
                        this.textContent = this.dataset.originalText;
                        this.title = `Translated: "${translatedText}" (Click to show translation)`;
                    } else {
                        this.textContent = translatedText;
                        this.title = `Original: "${this.dataset.originalText}" (Click to revert)`;
                    }
                });
            } else {
                wrapper.textContent = selectedText; // Revert
                wrapper.title = `Failed: ${response?.error || "Unknown"}`;
                wrapper.style.cursor = "default";
            }
        });
}

// --- Event Listeners ---
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId === "translateSelection" && info.selectionText) {
        try {
            await ensureContentScript(tab.id);
            const { sourceLanguage, targetLanguage } =
                await getTranslationLanguages();
            await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                func: replaceAndTranslateSelection,
                args: [sourceLanguage, targetLanguage],
            });
        } catch (error) {
            console.error("Context menu script execution failed:", error);
        }
    }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "getTranslation") {
        handleTranslationRequest(request, sendResponse);
        return true; // async
    }
    if (request.action === "getSelectionTranslation") {
        handleTranslationRequest(
            { ...request, isSelection: true },
            sendResponse
        );
        return true; // async
    }
    if (request.action === "clearCache") {
        translationCache.clear();
        sendResponse({ success: true });
    }
});

// --- Core Translation Logic ---
async function handleTranslationRequest(request, sendResponse) {
    try {
        const { text, sourceLanguage, targetLanguage } = request;
        const cacheKey = `${sourceLanguage}:${targetLanguage}:${text.substring(
            0,
            100
        )}`;

        if (translationCache.has(cacheKey)) {
            sendResponse({
                success: true,
                translation: translationCache.get(cacheKey),
                fromCache: true,
            });
            return;
        }

        const translation = await queueApiCall(
            text,
            sourceLanguage,
            targetLanguage
        );
        cacheTranslation(cacheKey, translation);
        sendResponse({ success: true, translation });
    } catch (error) {
        console.error("Translation failed:", error);
        sendResponse({ success: false, error: error.message });
    }
}

async function queueApiCall(text, sourceLanguage, targetLanguage) {
    return new Promise((resolve, reject) => {
        apiCallQueue.push({
            text,
            sourceLanguage,
            targetLanguage,
            resolve,
            reject,
        });
        processApiQueue();
    });
}

async function processApiQueue() {
    if (isProcessingQueue || apiCallQueue.length === 0) return;
    isProcessingQueue = true;
    const batch = apiCallQueue.splice(
        0,
        Math.min(MAX_CONCURRENT_CALLS, apiCallQueue.length)
    );
    await Promise.all(
        batch.map((call) =>
            makeApiCall(call.text, call.sourceLanguage, call.targetLanguage)
                .then(call.resolve)
                .catch(call.reject)
        )
    );
    isProcessingQueue = false;
    if (apiCallQueue.length > 0)
        setTimeout(processApiQueue, MIN_DELAY_BETWEEN_CALLS);
}

async function makeApiCall(text, sourceLanguage, targetLanguage) {
    const { selectedModel } = await chrome.storage.sync.get("selectedModel");
    const modelId = selectedModel || "models/gemini-2.5-flash"; // Default

    if (modelId.startsWith("grok-")) {
        return callGrokApi(modelId, text, sourceLanguage, targetLanguage);
    } else {
        return callGeminiApi(modelId, text, sourceLanguage, targetLanguage);
    }
}

// --- Universal Prompt Logic ---
function getTranslationInstructions(sourceLanguage, targetLanguage) {
    const sourceInstruction =
        sourceLanguage === "Auto-detect"
            ? "Detect the language of the following text and translate it"
            : `Translate the following ${sourceLanguage} text`;

    return [
        "You are a professional, direct translator.",
        `Task: ${sourceInstruction} to ${targetLanguage}.`,
        "Return ONLY the translated text for each input segment.",
        `Segments are delimited by: ${RESPONSE_SEPARATOR}`,
        "Preserve the exact number of segments and all original line breaks.",
        "Do not add explanations, notes, quotes, or markdown.",
    ].join(" ");
}

// --- Grok API Call ---
async function callGrokApi(modelId, text, sourceLanguage, targetLanguage) {
    const { grokApiKey } = await chrome.storage.sync.get("grokApiKey");
    if (!grokApiKey) {
        throw new Error("Grok API Key not found. Please set it in the popup.");
    }

    const systemContent = getTranslationInstructions(
        sourceLanguage,
        targetLanguage
    );
    const userContent = `Input:\n\n${text}`;

    const requestBody = {
        model: modelId,
        messages: [
            { role: "system", content: systemContent },
            { role: "user", content: userContent },
        ],
        temperature: 0.1,
        stream: false,
    };

    const url = `${XAI_API_BASE}/chat/completions`;
    const response = await fetch(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${grokApiKey}`,
        },
        body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        throw new Error(
            `Grok API Error: ${response.status} - ${
                errorData?.error?.message || "Unknown"
            }`
        );
    }

    const data = await response.json();
    if (!data?.choices?.length) {
        throw new Error("Invalid response structure from Grok API.");
    }
    return data.choices[0].message?.content?.trim() || "";
}

// --- Gemini API Call ---
async function callGeminiApi(modelId, text, sourceLanguage, targetLanguage) {
    const { geminiApiKey } = await chrome.storage.sync.get("geminiApiKey");
    if (!geminiApiKey) {
        throw new Error(
            "Gemini API Key not found. Please set it in the popup."
        );
    }

    const modelApiName = modelId.replace("models/", "");
    const systemInstruction = getTranslationInstructions(
        sourceLanguage,
        targetLanguage
    );
    const userMessage = `Input:\n\n${text}`;

    const generationConfig = {
        temperature: 0.1,
        responseMimeType: "text/plain",
    };

    let requestBody;
    const isGemmaModel = modelId.includes("gemma");

    if (isGemmaModel) {
        const combinedPrompt = `${systemInstruction}\n\n${userMessage}`;
        requestBody = {
            contents: [{ role: "user", parts: [{ text: combinedPrompt }] }],
            generationConfig,
        };
    } else {
        requestBody = {
            systemInstruction: { parts: [{ text: systemInstruction }] },
            contents: [{ role: "user", parts: [{ text: userMessage }] }],
            generationConfig,
        };
    }

    let lastErr;
    for (const base of GEMINI_API_BASES) {
        const url = `${base}/models/${modelApiName}:generateContent?key=${geminiApiKey}`;
        try {
            const response = await fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(requestBody),
            });
            if (!response.ok) {
                const errorData = await response.json().catch(() => null);
                throw new Error(
                    `API Error: ${response.status} - ${
                        errorData?.error?.message || "Unknown"
                    }`
                );
            }
            const data = await response.json();
            const cands = data?.candidates || [];
            if (cands.length === 0) throw new Error("No candidates returned.");
            const cand =
                cands.find((c) => c.finishReason !== "SAFETY") || cands[0];
            if (cand.finishReason === "SAFETY")
                throw new Error("Blocked by safety.");
            const parts = cand?.content?.parts;
            if (!parts) throw new Error("Invalid response structure.");
            return parts.map((p) => p.text).join("").trim();
        } catch (e) {
            lastErr = e;
        }
    }
    throw lastErr || new Error("Failed to reach Gemini API.");
}

// --- Utility Functions ---
function cacheTranslation(key, translation) {
    if (translationCache.size >= MAX_CACHE_SIZE) {
        const firstKey = translationCache.keys().next().value;
        translationCache.delete(firstKey);
    }
    translationCache.set(key, translation);
}

async function getTranslationLanguages() {
    const settings = await chrome.storage.sync.get([
        "sourceLanguage",
        "targetLanguage",
    ]);
    return {
        sourceLanguage: settings.sourceLanguage || "Auto-detect",
        targetLanguage: settings.targetLanguage || "English",
    };
}

async function ensureContentScript(tabId) {
    const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => window.isGeminiTranslatorInjected,
    });
    if (!results || !results[0]?.result) {
        await chrome.scripting.executeScript({
            target: { tabId },
            files: ["content.js"],
        });
    }
}

// Auto-translate on navigation
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (changeInfo.status === "complete" && tab.url) {
        const { autoTranslateSites, sourceLanguage, targetLanguage } =
            await chrome.storage.sync.get([
                "autoTranslateSites",
                "sourceLanguage",
                "targetLanguage",
            ]);
        if (
            autoTranslateSites?.length > 0 &&
            autoTranslateSites.some((site) => tab.url.includes(site))
        ) {
            await ensureContentScript(tabId);
            chrome.tabs.sendMessage(tabId, {
                action: "translate",
                sourceLanguage: sourceLanguage || "Auto-detect",
                targetLanguage: targetLanguage || "English",
            });
        }
    }
});