// jest.setup.js

// Define the global chrome object mock
global.chrome = {
    runtime: {
        onMessage: {
            addListener: jest.fn(),
        },
        sendMessage: jest.fn(),
        lastError: null,
    },
    storage: {
        sync: {
            get: jest.fn(),
            set: jest.fn(),
        },
    },
    contextMenus: {
        create: jest.fn(),
        onClicked: {
            addListener: jest.fn(),
        },
    },
    tabs: {
        query: jest.fn(),
        sendMessage: jest.fn(),
    },
    scripting: {
        executeScript: jest.fn(),
    },
};

// Mock fetch for API calls
global.fetch = jest.fn();