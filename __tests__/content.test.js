/**
 * @jest-environment jsdom
 */

global.NodeFilter = {
    SHOW_TEXT: 4,
    FILTER_ACCEPT: 1,
    FILTER_REJECT: 2,
    FILTER_SKIP: 3
};

const { runFullPageTranslation, applyTranslations } = require('../content');

describe('Content Script Logic', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        jest.clearAllMocks();
    });

    test('Should identify translateable text nodes and ignore scripts', async () => {
        document.body.innerHTML = `
            <div>Hello World</div>
            <script>var x = "Do not translate";</script>
            <div translate="no">Ignore me</div>
            <p>  </p>
        `;

        chrome.runtime.sendMessage.mockResolvedValue({
            success: true,
            translations: ['Hola Mundo']
        });

        await runFullPageTranslation('English', 'Spanish');

        expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(1);
        const msg = chrome.runtime.sendMessage.mock.calls[0][0];

        expect(msg.action).toBe('translateBatch');
        expect(msg.texts).toEqual(['Hello World']);
        expect(msg.texts).not.toContain('Do not translate');
        expect(msg.texts).not.toContain('Scanning page...'); // Ensure UI is ignored
    });

    test('applyTranslations should inject overlay spans', () => {
        const div = document.createElement('div');
        div.textContent = 'Hello';
        document.body.appendChild(div);
        const textNode = div.firstChild;

        const nodeItem = { node: textNode, text: 'Hello' };

        applyTranslations([nodeItem], ['Hola']);

        const span = div.querySelector('span.gemini-translated');
        expect(span).not.toBeNull();
        expect(span.textContent).toBe('Hola');
        expect(span.dataset.original).toBe('Hello');
    });

    test('Clicking translated text should revert to original', () => {
        // 1. Setup real DOM structure
        const div = document.createElement('div');
        div.textContent = 'Hello';
        document.body.appendChild(div);
        const textNode = div.firstChild;

        // 2. Run the function on the REAL text node
        applyTranslations([{ node: textNode, text: 'Hello' }], ['Hola']);

        // 3. Find the span that applyTranslations created
        const newSpan = div.querySelector('.gemini-translated');

        // 4. Click to Revert
        newSpan.click();
        expect(newSpan.textContent).toBe('Hello');

        // 5. Click to Restore
        newSpan.click();
        expect(newSpan.textContent).toBe('Hola');
    });
});