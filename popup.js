// DOM Elements
const tabs = document.querySelectorAll('.tab-btn');
const contents = document.querySelectorAll('.tab-content');
const els = {
    source: document.getElementById('sourceLang'),
    target: document.getElementById('targetLang'),
    model: document.getElementById('modelSelect'),
    geminiKey: document.getElementById('geminiKey'),
    grokKey: document.getElementById('grokKey'),
    autoSites: document.getElementById('autoSites'),
    btnTranslate: document.getElementById('btnTranslate'),
    btnRevert: document.getElementById('btnRevert'),
    btnClear: document.getElementById('btnClearCache'),
    status: document.getElementById('status')
};

// --- Tab Logic ---
tabs.forEach(tab => {
    tab.addEventListener('click', () => {
        tabs.forEach(t => t.classList.remove('active'));
        contents.forEach(c => c.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById(tab.dataset.tab).classList.add('active');
    });
});

// --- Custom Select Logic (The Fix) ---
function initCustomSelects() {
    document.querySelectorAll('select').forEach(select => {
        // Check if already initialized
        if(select.parentNode.classList.contains('custom-select-wrapper')) return;

        // 1. Create Wrapper
        const wrapper = document.createElement('div');
        wrapper.className = 'custom-select-wrapper';
        select.parentNode.insertBefore(wrapper, select);
        wrapper.appendChild(select);

        // 2. Create Trigger (The box you click)
        const trigger = document.createElement('div');
        trigger.className = 'custom-select-trigger';
        trigger.innerHTML = `<span>${select.options[select.selectedIndex]?.text || 'Select...'}</span>`;
        wrapper.appendChild(trigger);

        // 3. Create Options Container
        const optionsDiv = document.createElement('div');
        optionsDiv.className = 'custom-options';

        // 4. Populate Options (Support Optgroups)
        const buildOption = (opt) => {
            const div = document.createElement('div');
            div.className = 'custom-option';
            if(opt.selected) div.classList.add('selected');
            div.textContent = opt.text;
            div.dataset.value = opt.value;

            div.addEventListener('click', () => {
                // Sync with real select
                select.value = opt.value;
                trigger.querySelector('span').textContent = opt.text;

                // Visual updates
                optionsDiv.querySelectorAll('.custom-option').forEach(el => el.classList.remove('selected'));
                div.classList.add('selected');

                // Close
                wrapper.classList.remove('open');

                // Trigger existing auto-save logic
                select.dispatchEvent(new Event('change'));
            });
            return div;
        };

        Array.from(select.children).forEach(child => {
            if(child.tagName === 'OPTGROUP') {
                const label = document.createElement('div');
                label.className = 'custom-optgroup-label';
                label.textContent = child.label;
                optionsDiv.appendChild(label);
                Array.from(child.children).forEach(opt => optionsDiv.appendChild(buildOption(opt)));
            } else {
                optionsDiv.appendChild(buildOption(child));
            }
        });

        wrapper.appendChild(optionsDiv);

        // 5. Event Listeners
        trigger.addEventListener('click', (e) => {
            e.stopPropagation();
            // Close others
            document.querySelectorAll('.custom-select-wrapper').forEach(el => {
                if(el !== wrapper) el.classList.remove('open');
            });
            wrapper.classList.toggle('open');

            // Scroll to selected
            if(wrapper.classList.contains('open')) {
                const selected = optionsDiv.querySelector('.selected');
                if(selected) selected.scrollIntoView({ block: 'nearest' });
            }
        });
    });

    // Close on click outside
    document.addEventListener('click', () => {
        document.querySelectorAll('.custom-select-wrapper').forEach(el => el.classList.remove('open'));
    });
}

// --- Storage Logic ---
const SETTINGS_KEYS = ['sourceLang', 'targetLang', 'selectedModel', 'geminiApiKey', 'grokApiKey', 'autoTranslateSites'];

function loadSettings() {
    chrome.storage.sync.get(SETTINGS_KEYS, (data) => {
        if (data.sourceLang) els.source.value = data.sourceLang;
        if (data.targetLang) els.target.value = data.targetLang;
        if (data.selectedModel) els.model.value = data.selectedModel;
        if (data.geminiApiKey) els.geminiKey.value = data.geminiApiKey;
        if (data.grokApiKey) els.grokKey.value = data.grokApiKey;
        if (data.autoTranslateSites) els.autoSites.value = data.autoTranslateSites.join('\n');

        // Initialize Custom Selects AFTER data is loaded so they show correct initial values
        initCustomSelects();
    });
}

function saveSettings() {
    const settings = {
        sourceLang: els.source.value,
        targetLang: els.target.value,
        selectedModel: els.model.value,
        geminiApiKey: els.geminiKey.value.trim(),
        grokApiKey: els.grokKey.value.trim(),
        autoTranslateSites: els.autoSites.value.split('\n').map(s => s.trim()).filter(Boolean)
    };

    chrome.storage.sync.set(settings, () => {
        setStatus('Settings saved', 'success');
    });
}

// --- Action Logic ---
async function sendToActiveTab(message) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || tab.url.startsWith('chrome://')) {
        setStatus('Cannot run on this page', 'error');
        return;
    }

    try {
        await chrome.tabs.sendMessage(tab.id, { action: 'ping' });
    } catch (e) {
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
    }

    chrome.tabs.sendMessage(tab.id, message);
    if(message.action === 'translate') window.close();
}

function setStatus(msg, type) {
    els.status.textContent = msg;
    els.status.style.color = type === 'error' ? '#ef4444' : '#10b981';
    setTimeout(() => els.status.textContent = '', 3000);
}

// --- Event Listeners ---
document.addEventListener('DOMContentLoaded', loadSettings);

// Auto-save
[els.source, els.target, els.model, els.geminiKey, els.grokKey, els.autoSites].forEach(el => {
    el.addEventListener('change', saveSettings);
    if(el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
        el.addEventListener('blur', saveSettings);
    }
});

els.btnTranslate.addEventListener('click', () => {
    els.btnTranslate.disabled = true;
    els.btnTranslate.querySelector('.spinner').style.display = 'block';

    sendToActiveTab({
        action: 'translate',
        source: els.source.value,
        target: els.target.value
    });
});

els.btnRevert.addEventListener('click', () => {
    sendToActiveTab({ action: 'revert' });
});

els.btnClear.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'clearCache' });
    setStatus('Cache cleared', 'success');
});

// Export for testing
if (typeof module !== 'undefined') {
    module.exports = { loadSettings, saveSettings, els };
}