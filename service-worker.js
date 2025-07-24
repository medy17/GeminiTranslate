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

// Handle context menu clicks with enhanced debugging
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    console.log('Context menu clicked:', info.menuItemId, 'Selection:', info.selectionText);

    if (info.menuItemId === "translateSelection" && info.selectionText) {
        try {
            console.log('Processing selection translation for tab:', tab.id);

            // Get target language first
            const targetLanguage = await getTargetLanguage();
            console.log('Target language:', targetLanguage);

            // Ensure content script is injected
            await ensureContentScript(tab.id);
            console.log('Content script ensured for tab:', tab.id);

            // Send message with timeout handling
            const response = await sendMessageWithTimeout(tab.id, {
                action: 'translateSelection',
                text: info.selectionText,
                targetLanguage: targetLanguage
            }, 5000);

            console.log('Selection translation response:', response);

        } catch (error) {
            console.error('Context menu translation failed:', error);
            // Try to show error to user
            try {
                await chrome.scripting.executeScript({
                    target: { tabId: tab.id },
                    func: (errorMsg) => {
                        alert(`Translation failed: ${errorMsg}`);
                    },
                    args: [error.message]
                });
            } catch (scriptError) {
                console.error('Failed to show error message:', scriptError);
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