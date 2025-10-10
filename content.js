// A flag to ensure the listener is only added once
if (!window.isGeminiTranslatorInjected) {
    window.isGeminiTranslatorInjected = true;

    const SEPARATOR = "|||---|||";
    let isTranslating = false;

    // --- Utility Functions ---

    function createProgressIndicator() {
        const progress = document.createElement("div");
        progress.id = "gemini-progress";
        progress.style.cssText = `
      position: fixed; top: 20px; right: 20px;
      background: #2b6cb0; color: white; padding: 10px 15px;
      border-radius: 5px; z-index: 10000; font-family: 'IBM Plex Sans', sans-serif;
      font-size: 14px; box-shadow: 0 4px 12px rgba(0,0,0,0.4);
    `;
        document.body.appendChild(progress);
        return progress;
    }

    function removeProgressIndicator() {
        const progress = document.getElementById("gemini-progress");
        if (progress) progress.remove();
    }

    function showNotification(message, type = "info") {
        const notification = document.createElement("div");
        const colors = {
            info: "#2b6cb0",
            success: "#2f855a",
            error: "#c53030",
        };
        notification.style.cssText = `
      position: fixed; top: 20px; left: 20px; padding: 12px 16px;
      border-radius: 6px; z-index: 10000; font-family: 'IBM Plex Sans', sans-serif;
      font-size: 14px; max-width: 300px; color: white;
      box-shadow: 0 4px 12px rgba(0,0,0,0.4);
      background-color: ${colors[type] || colors.info};
    `;
        notification.textContent = message;
        document.body.appendChild(notification);
        setTimeout(() => notification.remove(), 4000);
    }

    // --- Core Logic ---

    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === "ping") {
            sendResponse({ pong: true });
        } else if (request.action === "translate") {
            doTranslate(request.sourceLanguage, request.targetLanguage);
            sendResponse({ received: true });
        } else if (request.action === "revert") {
            doRevert();
            sendResponse({ received: true });
        }
        return true; // Keep message channel open for async response
    });

    async function doTranslate(sourceLanguage, targetLanguage) {
        if (isTranslating) {
            showNotification("Translation already in progress.", "info");
            return;
        }
        if (document.querySelector(".gemini-translated-text")) {
            await doRevert();
        }

        isTranslating = true;
        const progress = createProgressIndicator();
        progress.textContent = "Scanning page for text...";
        document.body.style.cursor = "wait";

        const walker = document.createTreeWalker(
            document.body,
            NodeFilter.SHOW_TEXT
        );
        const textNodes = [];
        const originalTexts = [];

        let node;
        while ((node = walker.nextNode())) {
            const parentTag = node.parentElement.tagName.toUpperCase();
            const isUntranslatable = ["SCRIPT", "STYLE", "NOSCRIPT"].includes(
                parentTag
            );
            const isMeaningful = node.nodeValue.trim().length > 1;

            if (!isUntranslatable && isMeaningful) {
                textNodes.push(node);
                originalTexts.push(node.nodeValue);
            }
        }

        if (textNodes.length === 0) {
            showNotification("No translatable text found on the page.", "info");
            document.body.style.cursor = "default";
            removeProgressIndicator();
            isTranslating = false;
            return;
        }

        progress.textContent = `Translating ${textNodes.length} text elements...`;

        try {
            const response = await chrome.runtime.sendMessage({
                action: "getTranslation",
                text: originalTexts.join(SEPARATOR),
                sourceLanguage: sourceLanguage,
                targetLanguage: targetLanguage,
            });

            if (response.success) {
                progress.textContent = "Applying translations...";
                const translations = response.translation.split(SEPARATOR);
                if (translations.length === textNodes.length) {
                    textNodes.forEach((node, index) => {
                        const originalText = node.nodeValue;
                        const translatedText = translations[index].trim();
                        if (translatedText && translatedText !== originalText) {
                            const span = document.createElement("span");
                            span.className = "gemini-translated-text";
                            span.dataset.originalText = originalText;
                            span.textContent = translatedText;
                            span.style.cursor = "pointer";

                            // UPDATED: Set initial tooltip
                            span.title = `Original: "${originalText
                                .trim()
                                .substring(
                                    0,
                                    100
                                )}..." (Click to revert)`;

                            // UPDATED: Add enhanced click-to-revert with tooltip toggle
                            span.addEventListener("click", function (e) {
                                e.preventDefault();
                                const isShowingTranslation =
                                    this.textContent === translatedText;
                                if (isShowingTranslation) {
                                    // Revert to original
                                    this.textContent = originalText;
                                    this.title = `Translated: "${translatedText
                                        .trim()
                                        .substring(
                                            0,
                                            100
                                        )}..." (Click to show translation)`;
                                } else {
                                    // Switch back to translation
                                    this.textContent = translatedText;
                                    this.title = `Original: "${originalText
                                        .trim()
                                        .substring(
                                            0,
                                            100
                                        )}..." (Click to revert)`;
                                }
                            });
                            node.replaceWith(span);
                        }
                    });
                    const cacheNote = response.fromCache ? " (from cache)" : "";
                    showNotification(
                        `Translated ${textNodes.length} elements${cacheNote}`,
                        "success"
                    );
                } else {
                    showNotification("Translation count mismatch.", "error");
                }
            } else {
                showNotification(`Translation failed: ${response.error}`, "error");
            }
        } catch (error) {
            showNotification(`Request failed: ${error.message}`, "error");
        } finally {
            document.body.style.cursor = "default";
            removeProgressIndicator();
            isTranslating = false;
        }
    }

    function doRevert() {
        const translatedElements = document.querySelectorAll(
            ".gemini-translated-text, .gemini-translated-selection"
        );
        if (translatedElements.length > 0) {
            translatedElements.forEach((span) => {
                const originalTextNode = document.createTextNode(
                    span.dataset.originalText
                );
                span.replaceWith(originalTextNode);
            });
            showNotification(
                `Reverted ${translatedElements.length} translations`,
                "success"
            );
        } else {
            showNotification("No translated text found to revert.", "info");
        }
    }
}