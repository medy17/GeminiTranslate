const { processBatch, callAI, translationCache } = require('../service-worker');

describe('Service Worker Logic', () => {
    beforeEach(() => {
        // Reset cache and mocks
        translationCache.clear();
        global.fetch.mockReset();

        // Reset Chrome mocks
        chrome.storage.sync.get.mockReset();

        // FIX: Use mockResolvedValue because the service worker "awaits" the result
        chrome.storage.sync.get.mockResolvedValue({
            selectedModel: 'models/gemini-2.5-flash',
            geminiApiKey: 'test-gemini-key',
            grokApiKey: 'test-grok-key'
        });
    });

    test('callAI should throw error if API key is missing', async () => {
        await expect(callAI(['hello'], 'en', 'es', 'grok-4', null, ''))
            .rejects.toThrow('Grok API Key missing');
    });

    test('callAI should format request for Gemini correctly', async () => {
        const mockResponse = {
            candidates: [{ content: { parts: [{ text: '["Hola"]' }] } }]
        };

        global.fetch.mockResolvedValue({
            ok: true,
            json: async () => mockResponse
        });

        const result = await callAI(['Hello'], 'English', 'Spanish', 'models/gemini-2.5-flash', 'key123', '');

        expect(global.fetch).toHaveBeenCalledWith(
            expect.stringContaining('generativelanguage.googleapis.com'),
            expect.objectContaining({ method: 'POST' })
        );
        expect(result).toEqual(['Hola']);
    });

    test('processBatch should use cache for existing translations', async () => {
        translationCache.set('English:Spanish:Hello', 'Hola');

        const request = {
            texts: ['Hello', 'World'],
            source: 'English',
            target: 'Spanish'
        };

        global.fetch.mockResolvedValue({
            ok: true,
            json: async () => ({
                candidates: [{ content: { parts: [{ text: '["Mundo"]' }] } }]
            })
        });

        const response = await processBatch(request);

        expect(response.success).toBe(true);
        expect(response.translations).toEqual(['Hola', 'Mundo']);

        const fetchCall = global.fetch.mock.calls[0];
        const body = JSON.parse(fetchCall[1].body);
        expect(body.contents[0].parts[0].text).toContain('["World"]');
    });

    test('processBatch should handle strict JSON parsing from AI', async () => {
        const request = { texts: ['One'], source: 'En', target: 'Es' };

        // Mock clean response
        global.fetch.mockResolvedValue({
            ok: true,
            json: async () => ({
                candidates: [{ content: { parts: [{ text: '["Uno"]' }] } }]
            })
        });

        const response = await processBatch(request);
        expect(response.translations).toEqual(['Uno']);
    });

    // --- NEW TESTS (Now correctly placed outside the previous blocks) ---

    test('processBatch should handle API errors gracefully', async () => {
        const request = { texts: ['Hello'], source: 'En', target: 'Es' };

        // Mock a 500 Server Error
        global.fetch.mockResolvedValue({
            ok: false,
            status: 500,
            json: async () => ({ error: { message: 'Server Internal Error' } })
        });

        const response = await processBatch(request);

        expect(response.success).toBe(false);
        expect(response.error).toContain('Server Internal Error');
    });

    test('processBatch should detect length mismatch (AI hallucination)', async () => {
        const request = { texts: ['One', 'Two'], source: 'En', target: 'Es' };

        // AI returns only 1 item instead of 2
        global.fetch.mockResolvedValue({
            ok: true,
            json: async () => ({
                candidates: [{ content: { parts: [{ text: '["Uno"]' }] } }]
            })
        });

        const response = await processBatch(request);

        expect(response.success).toBe(false);
        expect(response.error).toContain('Mismatch');
    });
});