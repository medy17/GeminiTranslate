// A flag to ensure the listener is only added once
if (!window.isGeminiTranslatorInjected) {
    window.isGeminiTranslatorInjected = true;

    const CJK_REGEX = /[\u4e00-\u9fa5]/;
    const SEPARATOR = "|||---|||";
    let isTranslating = false;

    console.log('Gemini Translator content script loaded');

    // Create progress indicator
    function createProgressIndicator() {
        const progress = document.createElement('div');
        progress.id = 'gemini-progress';
        progress.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: #007BFF;
            color: white;
            padding: 10px 15px;
            border-radius: 5px;
            z-index: 10000;
            font-family: sans-serif;
            font-size: 14px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.3);
        `;
        document.body.appendChild(progress);
        return progress;
    }

    function removeProgressIndicator() {
        const progress = document.getElementById('gemini-progress');
        if (progress) {
            progress.remove();
        }
    }

    // Enhanced message listener with ping support
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        console.log('Content script received message:', request.action);

        if (request.action === 'ping') {
            sendResponse({ pong: true });
            return false;
        } else if (request.action === 'translate') {
            doTranslate(request.targetLanguage);
            sendResponse({ received: true });
            return false;
        } else if (request.action === 'revert') {
            doRevert();
            sendResponse({ received: true });
            return false;
        }
    });


    /**
     * Enhanced page translation with progress tracking
     */
    async function doTranslate(targetLanguage) {
        if (isTranslating) {
            showNotification('Translation already in progress', 'info');
            return;
        }

        // Check if the page is already translated
        if (document.querySelector('.gemini-translated-text')) {
            console.log('Gemini Translator: Page already contains translations. Reverting first.');
            await doRevert();
        }

        isTranslating = true;
        console.log(`Gemini Translator: Starting translation to ${targetLanguage}...`);

        const progress = createProgressIndicator();
        progress.textContent = 'Scanning for Chinese text...';
        document.body.style.cursor = 'wait';

        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        const textNodes = [];
        const originalTexts = [];

        // 1. Collect all valid text nodes with progress updates
        let nodeCount = 0;
        let node;
        while (node = walker.nextNode()) {
            const parentTag = node.parentElement.tagName.toUpperCase();
            const isUntranslatable = ['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(parentTag);
            const hasChinese = CJK_REGEX.test(node.nodeValue);
            const isAlreadyTranslated = node.parentElement.classList.contains('gemini-translated-text');

            if (hasChinese && !isUntranslatable && !isAlreadyTranslated) {
                textNodes.push(node);
                originalTexts.push(node.nodeValue);
                nodeCount++;

                // Update progress every 50 nodes
                if (nodeCount % 50 === 0) {
                    progress.textContent = `Found ${nodeCount} text elements...`;
                }
            }
        }

        if (textNodes.length === 0) {
            console.log('Gemini Translator: No new Chinese text found.');
            showNotification('No Chinese text found to translate', 'info');
            document.body.style.cursor = 'default';
            removeProgressIndicator();
            isTranslating = false;
            return;
        }

        progress.textContent = `Translating ${textNodes.length} text elements...`;

        // 2. Send text to the service worker for translation
        try {
            const response = await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    reject(new Error('Translation request timeout'));
                }, 60000); // 60 second timeout for page translation

                chrome.runtime.sendMessage(
                    {
                        action: "getTranslation",
                        text: originalTexts.join(SEPARATOR),
                        targetLanguage: targetLanguage
                    },
                    (response) => {
                        clearTimeout(timeout);
                        if (chrome.runtime.lastError) {
                            reject(new Error(chrome.runtime.lastError.message));
                        } else {
                            resolve(response);
                        }
                    }
                );
            });

            if (response.success) {
                progress.textContent = 'Applying translations...';

                const translations = response.translation.split(SEPARATOR);
                if (translations.length === textNodes.length) {
                    // 3. Replace nodes with translated versions
                    textNodes.forEach((node, index) => {
                        const originalText = node.nodeValue;
                        const translatedText = translations[index].trim();

                        if (translatedText && translatedText !== originalText) {
                            const span = document.createElement('span');
                            span.className = 'gemini-translated-text';
                            span.dataset.originalText = originalText;
                            span.title = `Original: ${originalText.trim()}`;
                            span.style.cssText = "background-color: #FFFFE0; cursor: help;";
                            span.textContent = translatedText;

                            // Add click handler to toggle between original and translated
                            span.addEventListener('click', function(e) {
                                e.preventDefault();
                                const isShowingTranslation = this.textContent === translatedText;
                                this.textContent = isShowingTranslation ? originalText : translatedText;
                                this.style.backgroundColor = isShowingTranslation ? '#FFE0E6' : '#FFFFE0';
                            });

                            node.replaceWith(span);
                        }
                    });

                    const cacheNote = response.fromCache ? ' (from cache)' : '';
                    showNotification(`Successfully translated ${textNodes.length} elements${cacheNote}`, 'success');
                    console.log(`Gemini Translator: Successfully translated ${textNodes.length} text nodes.`);
                } else {
                    console.error('Gemini Translator: Translation count mismatch.');
                    showNotification('Translation count mismatch - some text may not be translated', 'warning');
                }
            } else {
                console.error('Gemini Translator: Translation failed.', response.error);
                showNotification(`Translation failed: ${response.error}`, 'error');
            }
        } catch (error) {
            console.error('Translation request failed:', error);
            showNotification(`Translation request failed: ${error.message}`, 'error');
        } finally {
            document.body.style.cursor = 'default';
            removeProgressIndicator();
            isTranslating = false;
        }
    }

    /**
     * Enhanced revert function
     */
    function doRevert() {
        // Revert full page translations
        const translatedElements = document.querySelectorAll('.gemini-translated-text');
        if (translatedElements.length > 0) {
            translatedElements.forEach(span => {
                const originalTextNode = document.createTextNode(span.dataset.originalText);
                span.replaceWith(originalTextNode);
            });
            showNotification(`Reverted ${translatedElements.length} page translations`, 'success');
        }

        // Revert in-place selection translations
        const selectionTranslations = document.querySelectorAll('.gemini-translated-selection');
        if (selectionTranslations.length > 0) {
            selectionTranslations.forEach(span => {
                const originalTextNode = document.createTextNode(span.dataset.originalText);
                span.replaceWith(originalTextNode);
            });
            showNotification(`Reverted ${selectionTranslations.length} selection translations`, 'success');
        }


        if (translatedElements.length === 0 && selectionTranslations.length === 0) {
            showNotification('No translated text found to revert', 'info');
            console.log('Gemini Translator: No translated text found to revert.');
        }
    }

    /**
     * Show notification to user
     */
    function showNotification(message, type = 'info') {
        const notification = document.createElement('div');
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            left: 20px;
            padding: 12px 16px;
            border-radius: 6px;
            z-index: 10000;
            font-family: sans-serif;
            font-size: 14px;
            max-width: 300px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        `;

        const colors = {
            info: { bg: '#2196F3', text: 'white' },
            success: { bg: '#4CAF50', text: 'white' },
            warning: { bg: '#FF9800', text: 'white' },
            error: { bg: '#F44336', text: 'white' }
        };

        const color = colors[type] || colors.info;
        notification.style.backgroundColor = color.bg;
        notification.style.color = color.text;
        notification.textContent = message;

        document.body.appendChild(notification);

        // Auto-remove after 4 seconds
        setTimeout(() => {
            if (notification.parentNode) {
                notification.remove();
            }
        }, 4000);
    }

    // Log that content script is ready
    console.log('Gemini Translator content script ready');
}