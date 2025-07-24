// Translation cache to avoid redundant API calls
const translationCache = new Map();
const MAX_CACHE_SIZE = 1000;

// Rate limiting
let apiCallQueue = [];
let isProcessingQueue = false;
const MAX_CONCURRENT_CALLS = 3;
const MIN_DELAY_BETWEEN_CALLS = 1000; // 1 second

// Token management
const MAX_TOKENS_PER_REQUEST = 30000; // Conservative limit
const CHARS_PER_TOKEN_ESTIMATE = 4; // Rough estimate for Chinese text

// Context menu setup with better error handling
chrome.runtime.onInstalled.addListener(() => {
    try {
        chrome.contextMenus.removeAll(() => {
            chrome.contextMenus.create({
                id: "translateSelection",
                title: "Translate selected text with Gemini",
                contexts: ["selection"]
            }, () => {
                if (chrome.runtime.lastError) {
                    console.error('Context menu creation failed:', chrome.runtime.lastError);
                } else {
                    console.log('Context menu created successfully');
                }
            });
        });
    } catch (error) {
        console.error('Failed to setup context menu:', error);
    }
});

// This function will be injected into the page to handle selection translation.
function replaceAndTranslateSelection(targetLanguage) {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
        return; // No active selection.
    }

    const selectedText = selection.toString().trim();
    if (!selectedText) {
        return; // Selection is empty.
    }

    const CJK_REGEX = /[\u4e00-\u9fa5]/;
    if (!CJK_REGEX.test(selectedText)) {
        return; // No Chinese text detected.
    }

    const range = selection.getRangeAt(0);
    const container = range.commonAncestorContainer;
    const element = container.nodeType === Node.TEXT_NODE ? container.parentElement : container;

    const isInputOrTextarea = element.tagName === 'INPUT' || element.tagName === 'TEXTAREA';

    // Handle translation for <input> and <textarea> fields
    if (isInputOrTextarea && typeof element.selectionStart === 'number') {
        const inputEl = element;
        const start = inputEl.selectionStart;
        const end = inputEl.selectionEnd;
        const originalValue = inputEl.value;

        inputEl.value = originalValue.substring(0, start) + "Translating..." + originalValue.substring(end);

        chrome.runtime.sendMessage({
            action: 'getSelectionTranslation',
            text: selectedText,
            targetLanguage: targetLanguage
        }).then(response => {
            if (response && response.success) {
                inputEl.value = originalValue.substring(0, start) + response.translation + originalValue.substring(end);
            } else {
                inputEl.value = originalValue; // Revert on failure
                alert(`Translation failed: ${response?.error || 'Unknown error'}`);
            }
        }).catch(error => {
            inputEl.value = originalValue; // Revert on failure
            alert(`Translation request failed: ${error.message}`);
        });
    } else {
        // Handle translation for regular DOM nodes (p, div, span, etc.)
        const wrapper = document.createElement('span');
        wrapper.className = 'gemini-translated-selection';
        wrapper.style.cssText = "background-color: #FFFFE0; cursor: wait; font-style: italic;";
        wrapper.textContent = "Translating...";
        wrapper.dataset.originalText = selectedText;

        range.deleteContents();
        range.insertNode(wrapper);

        chrome.runtime.sendMessage({
            action: 'getSelectionTranslation',
            text: selectedText,
            targetLanguage: targetLanguage
        }).then(response => {
            wrapper.style.cursor = 'help';
            wrapper.style.fontStyle = 'normal';
            if (response && response.success) {
                const translatedText = response.translation;
                wrapper.textContent = translatedText;
                wrapper.title = `Original: ${selectedText}`;

                wrapper.addEventListener('click', function(e) {
                    e.preventDefault();
                    e.stopPropagation();
                    const isShowingTranslation = this.textContent === translatedText;
                    this.textContent = isShowingTranslation ? this.dataset.originalText : translatedText;
                    this.style.backgroundColor = isShowingTranslation ? '#FFE0E6' : '#FFFFE0';
                });
            } else {
                wrapper.textContent = selectedText; // Revert to original text
                wrapper.style.backgroundColor = '#FFDDDD'; // Error indication
                wrapper.title = `Translation failed: ${response?.error || 'Unknown error'}`;
            }
        }).catch(error => {
            wrapper.textContent = selectedText; // Revert on error
            wrapper.style.backgroundColor = '#FFDDDD';
            wrapper.title = `Translation request failed: ${error.message}`;
        });
    }
}

// Handle context menu clicks by injecting and executing the replacement script
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId === "translateSelection" && info.selectionText) {
        try {
            await ensureContentScript(tab.id); // Ensure content script is available
            const targetLanguage = await getTargetLanguage();

            await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                func: replaceAndTranslateSelection,
                args: [targetLanguage]
            });
        } catch (error) {
            console.error('Context menu script execution failed:', error);
            try {
                await chrome.scripting.executeScript({
                    target: { tabId: tab.id },
                    func: (msg) => alert(`Translation failed: ${msg}`),
                    args: [error.message]
                });
            } catch (alertError) {
                console.error('Failed to show error alert:', alertError);
            }
        }
    }
});


// Helper function to send messages with timeout
function sendMessageWithTimeout(tabId, message, timeout = 5000) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new Error('Message timeout'));
        }, timeout);

        chrome.tabs.sendMessage(tabId, message, (response) => {
            clearTimeout(timer);
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
            } else {
                resolve(response);
            }
        });
    });
}

async function ensureContentScript(tabId) {
    try {
        console.log('Checking if content script is injected for tab:', tabId);

        // First, try to ping the content script
        try {
            const response = await sendMessageWithTimeout(tabId, { action: 'ping' }, 1000);
            if (response && response.pong) {
                console.log('Content script already active');
                return;
            }
        } catch (error) {
            console.log('Content script not responding, injecting...');
        }

        // Inject the content script
        await chrome.scripting.executeScript({
            target: { tabId: tabId },
            files: ['content.js'],
        });

        console.log('Content script injected successfully');

        // Wait a moment for the script to initialize
        await new Promise(resolve => setTimeout(resolve, 100));

    } catch (error) {
        console.error('Failed to inject content script:', error);
        throw new Error('Cannot inject content script on this page');
    }
}

async function getTargetLanguage() {
    try {
        const { targetLanguage } = await chrome.storage.sync.get(['targetLanguage']);
        return targetLanguage || 'English';
    } catch (error) {
        console.error('Failed to get target language:', error);
        return 'English';
    }
}

// Enhanced message listener with better error handling
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log('Service worker received message:', request.action);

    if (request.action === "getTranslation") {
        handleTranslationRequest(request, sendResponse);
        return true; // Indicates async response
    } else if (request.action === "getSelectionTranslation") {
        handleSelectionTranslation(request, sendResponse);
        return true;
    } else if (request.action === "clearCache") {
        translationCache.clear();
        console.log('Translation cache cleared');
        sendResponse({ success: true });
        return false;
    }
});

async function handleTranslationRequest(request, sendResponse) {
    try {
        const { text, targetLanguage, isSelection = false } = request;
        console.log('Handling translation request, isSelection:', isSelection, 'textLength:', text.length);

        // Check cache first
        const cacheKey = `${text.substring(0, 100)}:${targetLanguage}`;
        if (translationCache.has(cacheKey)) {
            console.log('Using cached translation');
            sendResponse({
                success: true,
                translation: translationCache.get(cacheKey),
                fromCache: true
            });
            return;
        }

        // For page translation, chunk the text; for selection, translate directly
        let translation;
        if (isSelection || estimateTokenCount(text) <= MAX_TOKENS_PER_REQUEST) {
            translation = await queueApiCall(text, targetLanguage);
        } else {
            translation = await translateInChunks(text, targetLanguage);
        }

        // Cache the result
        cacheTranslation(cacheKey, translation);

        sendResponse({ success: true, translation: translation });
    } catch (error) {
        console.error("Translation failed:", error);
        sendResponse({ success: false, error: error.message });
    }
}

async function handleSelectionTranslation(request, sendResponse) {
    console.log('Handling selection translation:', request.text.substring(0, 50));
    // Handle selection translation with the same logic but mark as selection
    await handleTranslationRequest({
        ...request,
        isSelection: true
    }, sendResponse);
}

function estimateTokenCount(text) {
    return Math.ceil(text.length / CHARS_PER_TOKEN_ESTIMATE);
}

async function translateInChunks(text, targetLanguage) {
    const separator = "|||---|||";
    const chunks = text.split(separator);
    const translatedChunks = [];

    // Group small chunks together to optimize API usage
    const optimizedChunks = [];
    let currentChunk = "";

    for (const chunk of chunks) {
        const potentialChunk = currentChunk + (currentChunk ? separator : "") + chunk;

        if (estimateTokenCount(potentialChunk) <= MAX_TOKENS_PER_REQUEST) {
            currentChunk = potentialChunk;
        } else {
            if (currentChunk) {
                optimizedChunks.push(currentChunk);
            }
            currentChunk = chunk;
        }
    }

    if (currentChunk) {
        optimizedChunks.push(currentChunk);
    }

    // Translate each optimized chunk
    for (const chunk of optimizedChunks) {
        try {
            const translation = await queueApiCall(chunk, targetLanguage);
            translatedChunks.push(translation);
        } catch (error) {
            console.error(`Failed to translate chunk:`, error);
            // On failure, return original chunk
            translatedChunks.push(chunk);
        }
    }

    return translatedChunks.join(separator);
}

async function queueApiCall(text, targetLanguage) {
    return new Promise((resolve, reject) => {
        apiCallQueue.push({ text, targetLanguage, resolve, reject });
        processApiQueue();
    });
}

async function processApiQueue() {
    if (isProcessingQueue || apiCallQueue.length === 0) {
        return;
    }

    isProcessingQueue = true;

    const concurrentCalls = Math.min(MAX_CONCURRENT_CALLS, apiCallQueue.length);
    const currentBatch = apiCallQueue.splice(0, concurrentCalls);

    const promises = currentBatch.map(async (call, index) => {
        // Stagger the calls to avoid hitting rate limits
        if (index > 0) {
            await delay(MIN_DELAY_BETWEEN_CALLS * index);
        }

        try {
            const result = await callGeminiApiWithRetry(call.text, call.targetLanguage);
            call.resolve(result);
        } catch (error) {
            call.reject(error);
        }
    });

    await Promise.all(promises);

    isProcessingQueue = false;

    // Process remaining queue
    if (apiCallQueue.length > 0) {
        setTimeout(processApiQueue, MIN_DELAY_BETWEEN_CALLS);
    }
}

async function callGeminiApiWithRetry(text, targetLanguage, maxRetries = 3) {
    let lastError;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            return await callGeminiApi(text, targetLanguage);
        } catch (error) {
            lastError = error;
            console.warn(`Translation attempt ${attempt} failed:`, error.message);

            // Don't retry on certain errors
            if (error.message.includes('API Key') || error.message.includes('blocked')) {
                throw error;
            }

            // Exponential backoff
            if (attempt < maxRetries) {
                await delay(Math.pow(2, attempt) * 1000);
            }
        }
    }

    throw lastError;
}

async function callGeminiApi(textToTranslate, targetLanguage) {
    const { geminiApiKey, selectedModel } = await chrome.storage.sync.get(['geminiApiKey', 'selectedModel']);

    if (!geminiApiKey) {
        throw new Error("API Key not found. Please set it in the extension popup.");
    }

    const modelApiName = (selectedModel || 'gemini-1.5-flash-latest').replace('models/', '');
    const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${modelApiName}:generateContent?key=${geminiApiKey}`;

    const requestBody = {
        contents: [{
            parts: [{
                text: `Translate the following Chinese text to ${targetLanguage}. Return ONLY the translated text. Preserve formatting and line breaks. Text:\n\n${textToTranslate}`
            }]
        }],
        generationConfig: {
            temperature: 0.1, // Lower temperature for more consistent translations
            maxOutputTokens: Math.min(8192, estimateTokenCount(textToTranslate) * 2) // Reasonable limit
        }
    };

    const response = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`API Error: ${response.status} - ${errorData.error?.message || 'Unknown error'}`);
    }

    const data = await response.json();

    if (data.promptFeedback && data.promptFeedback.blockReason) {
        throw new Error(`Translation blocked: ${data.promptFeedback.blockReason}`);
    }

    const translation = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!translation) {
        console.error("Gemini API Raw Response:", JSON.stringify(data, null, 2));
        throw new Error("Could not extract translation from API response.");
    }

    return translation.trim();
}

function cacheTranslation(key, translation) {
    if (translationCache.size >= MAX_CACHE_SIZE) {
        // Remove oldest entries
        const firstKey = translationCache.keys().next().value;
        translationCache.delete(firstKey);
    }
    translationCache.set(key, translation);
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Auto-translate feature (enhanced with rate limiting)
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' && tab.url) {
        const { autoTranslateSites, targetLanguage } = await chrome.storage.sync.get(['autoTranslateSites', 'targetLanguage']);

        if (autoTranslateSites && autoTranslateSites.length > 0) {
            const shouldTranslate = autoTranslateSites.some(site => tab.url.includes(site));

            if (shouldTranslate) {
                // Add delay to avoid overwhelming the API on multiple tab loads
                await delay(2000);

                await ensureContentScript(tabId);
                chrome.tabs.sendMessage(tabId, {
                    action: 'translate',
                    targetLanguage: targetLanguage || 'English'
                });
            }
        }
    }
});