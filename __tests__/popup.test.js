/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');

// 1. Setup HTML structure
const html = fs.readFileSync(path.resolve(__dirname, '../popup.html'), 'utf8');

describe('Popup Logic', () => {
    beforeAll(() => {
        // Mock window.close to prevent Jest from hanging
        Object.defineProperty(window, 'close', {
            writable: true,
            value: jest.fn(),
        });
    });

    beforeEach(() => {
        // Reset DOM and Mocks
        document.body.innerHTML = html;
        jest.resetModules();
        jest.clearAllMocks();

        // Mock Storage (Synchronous callback style for popup)
        chrome.storage.sync.get.mockImplementation((keys, cb) => {
            cb({
                sourceLang: 'English',
                targetLang: 'Spanish',
                geminiApiKey: 'old-key'
            });
        });

        // Mock Storage Set
        chrome.storage.sync.set.mockImplementation((items, cb) => {
            if (cb) cb();
        });

        // Mock Tabs
        chrome.tabs.query.mockResolvedValue([{ id: 123, url: 'https://google.com' }]);
        chrome.tabs.sendMessage.mockResolvedValue({}); // Successful ping
    });

    test('Should load settings from storage into inputs', () => {
        const { loadSettings } = require('../popup');
        loadSettings(); // Manually trigger initialization

        expect(chrome.storage.sync.get).toHaveBeenCalled();
        expect(document.getElementById('geminiKey').value).toBe('old-key');
        expect(document.getElementById('sourceLang').value).toBe('English');
    });

    test('Should save settings when input changes', () => {
        const { saveSettings } = require('../popup');

        const keyInput = document.getElementById('geminiKey');
        keyInput.value = 'new-secret-key';

        // Trigger save
        saveSettings();

        expect(chrome.storage.sync.set).toHaveBeenCalledWith(
            expect.objectContaining({
                geminiApiKey: 'new-secret-key'
            }),
            expect.any(Function)
        );
    });

    test('Clicking Translate should send message to active tab', async () => {
        const { loadSettings } = require('../popup');

        // CRITICAL FIX: Manually load settings first!
        // This updates the dropdowns from "Auto-detect" to "English" before we click.
        loadSettings();

        const btn = document.getElementById('btnTranslate');
        btn.click();

        // Wait for async operations
        await new Promise(resolve => setTimeout(resolve, 50));

        // Verify 'ping'
        expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(
            123,
            { action: 'ping' }
        );

        // Verify 'translate' with correct languages
        expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(
            123,
            expect.objectContaining({
                action: 'translate',
                source: 'English', // Matches storage mock
                target: 'Spanish'  // Matches storage mock
            })
        );

        expect(window.close).toHaveBeenCalled();
    });
});