const CACHE_LIMIT = 1500;
const translationCache = new Map();

// --- Message Handler ---
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'translateBatch') {
        processBatch(request)
            .then(response => sendResponse(response))
            .catch(err => sendResponse({ success: false, error: err.message }));
        return true; // Async
    }
    if (request.action === 'clearCache') {
        translationCache.clear();
    }
});

// --- Core Logic ---
async function processBatch({ texts, source, target }) {
    const { selectedModel, geminiApiKey, grokApiKey } = await chrome.storage.sync.get(['selectedModel', 'geminiApiKey', 'grokApiKey']);

    // 1. Check Cache & Identify Missing indices
    const results = new Array(texts.length).fill(null);
    const missingIndices = [];
    const textsToTranslate = [];

    texts.forEach((text, index) => {
        const key = `${source}:${target}:${text}`;
        if (translationCache.has(key)) {
            results[index] = translationCache.get(key);
        } else {
            missingIndices.push(index);
            textsToTranslate.push(text);
        }
    });

    if (textsToTranslate.length === 0) {
        return { success: true, translations: results };
    }

    // 2. Call API for missing texts
    try {
        const translatedTexts = await callAI(textsToTranslate, source, target, selectedModel, geminiApiKey, grokApiKey);

        // 3. Merge results and update cache
        if (translatedTexts.length !== textsToTranslate.length) {
            throw new Error(`Mismatch: Sent ${textsToTranslate.length}, got ${translatedTexts.length}`);
        }

        translatedTexts.forEach((trans, i) => {
            const originalIndex = missingIndices[i];
            const originalText = textsToTranslate[i];

            // Cache and Store
            translationCache.set(`${source}:${target}:${originalText}`, trans);
            results[originalIndex] = trans;
        });

        // Prune cache if too big
        if (translationCache.size > CACHE_LIMIT) {
            const keys = translationCache.keys();
            for (let i = 0; i < 200; i++) translationCache.delete(keys.next().value);
        }

        return { success: true, translations: results };

    } catch (error) {
        console.error("Translation Error:", error);
        return { success: false, error: error.message };
    }
}

// --- AI Provider Logic ---
async function callAI(textArray, source, target, model, gemKey, grokKey) {
    const isGrok = model && model.startsWith('grok');

    if (isGrok && !grokKey) throw new Error("Grok API Key missing");
    if (!isGrok && !gemKey) throw new Error("Gemini API Key missing");

    const systemPrompt = `
        You are a translation engine. 
        Input: A JSON array of strings.
        Task: Translate each string from ${source} to ${target}.
        Output: A strictly valid JSON array of strings. 
        Rules: 
        1. Maintain the exact order. 
        2. Do not include conversational text, markdown formatting, or code blocks (no \`\`\`json).
        3. Just the raw JSON array.
    `.trim();

    const userPrompt = JSON.stringify(textArray);

    if (isGrok) {
        return await fetchGrok(grokKey, model, systemPrompt, userPrompt);
    } else {
        return await fetchGemini(gemKey, model || 'models/gemini-2.5-flash', systemPrompt, userPrompt);
    }
}

async function fetchGemini(apiKey, model, sys, user) {
    // Gemini doesn't support standard system prompts in all models in the same way,
    // but for 1.5/2.5 flash, we can put it in content or systemInstruction depending on the API version.
    // We'll use the safe v1beta approach combined into the user prompt for maximum compatibility with JSON parsing.

    const url = `https://generativelanguage.googleapis.com/v1beta/${model}:generateContent?key=${apiKey}`;

    const payload = {
        contents: [{
            role: "user",
            parts: [{ text: sys + "\n\nInput:\n" + user }]
        }],
        generationConfig: {
            responseMimeType: "application/json" // Force JSON mode (Gemini specific feature)
        }
    };

    const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });

    if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error?.message || `Gemini Error ${resp.status}`);
    }

    const data = await resp.json();
    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || "[]";
    return JSON.parse(rawText);
}

async function fetchGrok(apiKey, model, sys, user) {
    const resp = await fetch('https://api.x.ai/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
            model: model,
            messages: [
                { role: "system", content: sys },
                { role: "user", content: user }
            ],
            temperature: 0.1
        })
    });

    if (!resp.ok) throw new Error(`Grok Error ${resp.status}`);

    const data = await resp.json();
    let content = data.choices[0].message.content;

    // Clean up if the model added markdown blocks
    content = content.replace(/```json/g, '').replace(/```/g, '').trim();

    return JSON.parse(content);
}

// --- Context Menu ---
chrome.contextMenus.create({
    id: "translateSelection",
    title: "Translate Selection",
    contexts: ["selection"]
}, () => chrome.runtime.lastError && {}); // Ignore exists error

chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === "translateSelection") {
        chrome.tabs.sendMessage(tab.id, { action: 'translateSelection' });
    }
});

try {
    module.exports = {
        processBatch,
        callAI,
        translationCache
    };
} catch (e) {}
