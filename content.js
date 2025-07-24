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
    // testing
    // Create selection translation tooltip - FIXED VERSION
    function createSelectionTooltip(x, y, originalText, translatedText, isLoading = false) {
        console.log('Creating selection tooltip at:', x, y, 'with text:', translatedText.substring(0, 50));

        // Remove existing tooltip
        const existingTooltip = document.getElementById('gemini-selection-tooltip');
        if (existingTooltip) {
            existingTooltip.remove();
            console.log('Removed existing tooltip');
        }

        // Ensure coordinates are within viewport
        const safeX = Math.max(10, Math.min(x, window.innerWidth - 350));
        const safeY = Math.max(10, Math.min(y, window.innerHeight - 200));

        console.log('Safe coordinates:', safeX, safeY);

        const tooltip = document.createElement('div');
        tooltip.id = 'gemini-selection-tooltip';
        tooltip.style.cssText = `
            position: fixed !important;
            left: ${safeX}px !important;
            top: ${safeY}px !important;
            background: #333 !important;
            color: white !important;
            padding: 15px !important;
            border-radius: 8px !important;
            z-index: 999999 !important;
            max-width: 320px !important;
            min-width: 200px !important;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif !important;
            font-size: 14px !important;
            line-height: 1.4 !important;
            box-shadow: 0 8px 25px rgba(0,0,0,0.5) !important;
            border: 2px solid #555 !important;
            word-wrap: break-word !important;
            pointer-events: auto !important;
        `;

        if (isLoading) {
            tooltip.innerHTML = `
                <div style="display: flex; align-items: center; color: #4CAF50; font-weight: bold;">
                    <div style="width: 16px; height: 16px; border: 2px solid #4CAF50; border-top: 2px solid transparent; border-radius: 50%; animation: spin 1s linear infinite; margin-right: 8px;"></div>
                    Translating...
                </div>
                <style>
                    @keyframes spin {
                        0% { transform: rotate(0deg); }
                        100% { transform: rotate(360deg); }
                    }
                </style>
            `;
        } else {
            tooltip.innerHTML = `
                <div style="font-weight: bold; margin-bottom: 12px; color: #4CAF50; border-bottom: 1px solid #555; padding-bottom: 8px;">
                    Translation Result
                </div>
                <div style="margin-bottom: 12px; line-height: 1.5; background: #444; padding: 10px; border-radius: 4px;">
                    ${translatedText}
                </div>
                <div style="font-size: 12px; color: #ccc; line-height: 1.3; background: #2a2a2a; padding: 8px; border-radius: 4px; margin-bottom: 10px;">
                    <strong>Original:</strong><br>
                    ${originalText.length > 150 ? originalText.substring(0, 150) + '...' : originalText}
                </div>
                <div style="text-align: right;">
                    <button onclick="document.getElementById('gemini-selection-tooltip').remove()" 
                            style="background: #4CAF50; color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 12px;">
                        Close
                    </button>
                </div>
            `;
        }

        document.body.appendChild(tooltip);
        console.log('Tooltip appended to body, element:', tooltip);

        // Verify tooltip was added
        const addedTooltip = document.getElementById('gemini-selection-tooltip');
        console.log('Tooltip verification - found in DOM:', !!addedTooltip);

        if (!isLoading) {
            // Auto-remove after 15 seconds
            setTimeout(() => {
                const tooltipToRemove = document.getElementById('gemini-selection-tooltip');
                if (tooltipToRemove) {
                    tooltipToRemove.remove();
                    console.log('Auto-removed tooltip after timeout');
                }
            }, 15000);

            // Remove on scroll or window resize
            const removeTooltip = () => {
                const tooltipToRemove = document.getElementById('gemini-selection-tooltip');
                if (tooltipToRemove) {
                    tooltipToRemove.remove();
                    console.log('Removed tooltip due to scroll/resize');
                }
            };

            window.addEventListener('scroll', removeTooltip, { once: true });
            window.addEventListener('resize', removeTooltip, { once: true });
            document.addEventListener('click', removeTooltip, { once: true });
        }

        return tooltip;
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
        } else if (request.action === 'translateSelection') {
            console.log('Processing selection translation:', request.text.substring(0, 50));
            doTranslateSelection(request.text, request.targetLanguage);
            sendResponse({ received: true });
            return false;
        }
    });

    /**
     * Translates selected text and shows it in a tooltip - FIXED VERSION
     */
    async function doTranslateSelection(text, targetLanguage) {
        console.log('doTranslateSelection called with:', text.substring(0, 50), targetLanguage);

        if (!text || text.trim().length === 0) {
            showNotification('No text provided for translation', 'warning');
            return;
        }

        if (!CJK_REGEX.test(text)) {
            showNotification('No Chinese text found in selection', 'warning');
            return;
        }

        // Use mouse position if available, otherwise center of screen
        let x = window.innerWidth / 2;
        let y = window.innerHeight / 2;

        // Try to get a good position for the tooltip
        // Since right-click often clears selection, we'll use a smart fallback
        try {
            const selection = window.getSelection();
            if (selection && selection.rangeCount > 0) {
                const range = selection.getRangeAt(0);
                const rect = range.getBoundingClientRect();
                if (rect.width > 0 && rect.height > 0) {
                    x = rect.left + window.scrollX;
                    y = rect.bottom + window.scrollY + 10;
                    console.log('Using selection position:', x, y);
                } else {
                    console.log('Selection rect empty, using center position');
                }
            } else {
                console.log('No selection available, using center position');
            }
        } catch (e) {
            console.warn('Could not get selection position:', e);
        }

        // Show loading tooltip
        console.log('Creating loading tooltip');
        const loadingTooltip = createSelectionTooltip(x, y, text, 'Translating...', true);

        try {
            console.log('Sending translation request to service worker');

            const response = await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    reject(new Error('Translation request timeout'));
                }, 15000);

                chrome.runtime.sendMessage(
                    {
                        action: "getSelectionTranslation",
                        text: text,
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

            console.log('Translation response received:', response);

            // Remove loading tooltip
            const loadingTooltipElement = document.getElementById('gemini-selection-tooltip');
            if (loadingTooltipElement) {
                loadingTooltipElement.remove();
                console.log('Removed loading tooltip');
            }

            if (response && response.success) {
                console.log('Creating success tooltip with translation:', response.translation.substring(0, 50));
                createSelectionTooltip(x, y, text, response.translation, false);
                showNotification('Selection translated successfully', 'success');
            } else {
                const errorMsg = response ? response.error : 'Unknown error';
                console.log('Creating error tooltip:', errorMsg);
                createSelectionTooltip(x, y, text, `❌ Translation failed: ${errorMsg}`, false);
                showNotification(`Translation failed: ${errorMsg}`, 'error');
            }
        } catch (error) {
            console.error('Selection translation failed:', error);

            // Remove loading tooltip
            const loadingTooltipElement = document.getElementById('gemini-selection-tooltip');
            if (loadingTooltipElement) {
                loadingTooltipElement.remove();
                console.log('Removed loading tooltip after error');
            }

            console.log('Creating error tooltip for exception:', error.message);
            createSelectionTooltip(x, y, text, `❌ Translation failed: ${error.message}`, false);
            showNotification(`Translation failed: ${error.message}`, 'error');
        }
    }

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
        const translatedElements = document.querySelectorAll('.gemini-translated-text');
        if (translatedElements.length === 0) {
            showNotification('No translated text found to revert', 'info');
            console.log('Gemini Translator: No translated text found to revert.');
            return;
        }

        translatedElements.forEach(span => {
            const originalTextNode = document.createTextNode(span.dataset.originalText);
            span.replaceWith(originalTextNode);
        });

        showNotification(`Reverted ${translatedElements.length} translations`, 'success');
        console.log(`Gemini Translator: Reverted ${translatedElements.length} translated elements.`);
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