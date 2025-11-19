// --- Configuration & State ---
const BATCH_CHAR_LIMIT = 2000;
let isProcessing = false;

// --- UI Helpers ---
function createOverlay(msg) {
    let el = document.getElementById('gemini-overlay');
    if (!el) {
        el = document.createElement('div');
        el.id = 'gemini-overlay';
        el.style.cssText = `
            position: fixed; bottom: 20px; right: 20px; z-index: 999999;
            background: #1e293b; color: white; padding: 12px 20px;
            border-radius: 8px; font-family: sans-serif; font-size: 14px;
            box-shadow: 0 4px 15px rgba(0,0,0,0.3); border: 1px solid #334155;
            display: flex; align-items: center; gap: 10px; transition: opacity 0.3s;
        `;
        document.body.appendChild(el);
    }
    el.innerHTML = `<div style="width:16px;height:16px;border:2px solid white;border-bottom-color:transparent;border-radius:50%;animation:geminiSpin 1s linear infinite"></div> <span>${msg}</span>`;

    if (!document.getElementById('gemini-styles')) {
        const s = document.createElement('style');
        s.id = 'gemini-styles';
        s.innerHTML = `@keyframes geminiSpin { 0%{transform:rotate(0deg)} 100%{transform:rotate(360deg)} } .gemini-trans-highlight:hover { background: rgba(255, 255, 0, 0.2); }`;
        document.head.appendChild(s);
    }
    return el;
}

function removeOverlay() {
    const el = document.getElementById('gemini-overlay');
    if (el) el.remove();
}

// --- Core Translation Engine ---
async function runFullPageTranslation(source, target) {
    if (isProcessing) return;
    isProcessing = true;
    const overlay = createOverlay("Scanning page...");

    // 1. Collect Text Nodes
    const textNodes = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
        acceptNode: (node) => {
            const parent = node.parentElement;
            if (!parent) return NodeFilter.FILTER_REJECT;

            // Filters
            // FIX: Ignore the overlay itself so we don't translate "Scanning page..."
            if (parent.id === 'gemini-overlay' || parent.closest('#gemini-overlay')) return NodeFilter.FILTER_REJECT;

            const tag = parent.tagName.toLowerCase();
            if (['script', 'style', 'noscript', 'textarea', 'input', 'code', 'pre'].includes(tag)) return NodeFilter.FILTER_REJECT;
            if (parent.isContentEditable) return NodeFilter.FILTER_REJECT;
            if (parent.getAttribute('translate') === 'no') return NodeFilter.FILTER_REJECT;
            if (node.textContent.trim().length < 2) return NodeFilter.FILTER_REJECT;
            if (parent.classList.contains('gemini-translated')) return NodeFilter.FILTER_REJECT;

            return NodeFilter.FILTER_ACCEPT;
        }
    });

    while (walker.nextNode()) textNodes.push(walker.currentNode);

    if (textNodes.length === 0) {
        overlay.innerHTML = "No text found.";
        setTimeout(removeOverlay, 2000);
        isProcessing = false;
        return;
    }

    // 2. Batching Logic
    let currentBatchNodes = [];
    let currentCharCount = 0;

    for (let i = 0; i < textNodes.length; i++) {
        const node = textNodes[i];
        const text = node.textContent.trim();

        currentBatchNodes.push({node, text});
        currentCharCount += text.length;

        if (currentCharCount >= BATCH_CHAR_LIMIT || i === textNodes.length - 1) {
            overlay.innerHTML = `Translating... (${Math.round((i / textNodes.length) * 100)}%)`;

            const texts = currentBatchNodes.map(item => item.text);
            try {
                const response = await chrome.runtime.sendMessage({
                    action: 'translateBatch',
                    texts,
                    source,
                    target
                });

                if (response.success) {
                    applyTranslations(currentBatchNodes, response.translations);
                } else {
                    console.error("Batch failed", response.error);
                }
            } catch (e) {
                console.error("Network error", e);
            }

            currentBatchNodes = [];
            currentCharCount = 0;
        }
    }

    overlay.innerHTML = "Translation Complete!";
    setTimeout(removeOverlay, 3000);
    isProcessing = false;
}

function applyTranslations(nodeItems, translatedTexts) {
    nodeItems.forEach((item, index) => {
        const translation = translatedTexts[index];
        if (!translation || translation === item.text) return;

        const span = document.createElement('span');
        span.className = 'gemini-translated gemini-trans-highlight';
        span.textContent = translation;
        span.title = `Original: ${item.text}`;
        span.dataset.original = item.text;
        span.style.cursor = 'help';

        span.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (span.textContent === translation) {
                span.textContent = item.text;
                span.style.opacity = '0.6';
            } else {
                span.textContent = translation;
                span.style.opacity = '1';
            }
        };

        if (item.node.parentNode) {
            item.node.parentNode.replaceChild(span, item.node);
        }
    });
}

function revertTranslations() {
    const els = document.querySelectorAll('.gemini-translated');
    els.forEach(el => {
        const txt = document.createTextNode(el.dataset.original);
        el.parentNode.replaceChild(txt, el);
    });
    createOverlay(`Reverted ${els.length} elements.`);
    setTimeout(removeOverlay, 2000);
}

async function translateCurrentSelection() {
    const sel = window.getSelection();
    if (!sel.toString().trim()) return;

    const text = sel.toString().trim();
    const range = sel.getRangeAt(0);

    const loader = document.createElement('span');
    loader.textContent = ' [Translating...] ';
    loader.style.color = '#3b82f6';
    range.deleteContents();
    range.insertNode(loader);

    const settings = await chrome.storage.sync.get(['sourceLang', 'targetLang']);

    const response = await chrome.runtime.sendMessage({
        action: 'translateBatch',
        texts: [text],
        source: settings.sourceLang || 'Auto-detect',
        target: settings.targetLang || 'English'
    });

    if (response.success) {
        const span = document.createElement('span');
        span.className = 'gemini-translated';
        span.textContent = response.translations[0];
        span.title = "Original: " + text;
        span.dataset.original = text;
        span.style.borderBottom = "2px dotted #3b82f6";
        span.onclick = function () {
            this.textContent = this.textContent === text ? response.translations[0] : text;
        };
        loader.replaceWith(span);
    } else {
        loader.textContent = text;
    }
}

if (!window.hasGeminiTranslator) {
    window.hasGeminiTranslator = true;
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
        if (msg.action === 'ping') return sendResponse(true);
        if (msg.action === 'translate') runFullPageTranslation(msg.source, msg.target);
        else if (msg.action === 'revert') revertTranslations();
        else if (msg.action === 'translateSelection') translateCurrentSelection();
    });
}

try {
    module.exports = {runFullPageTranslation, applyTranslations};
} catch (e) {
}