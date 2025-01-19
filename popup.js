document.addEventListener('DOMContentLoaded', () => {
    const apiKeyInput = document.getElementById('apiKey');
    const newRuleInput = document.getElementById('newRule');
    const addRuleBtn = document.getElementById('addRule');
    const rulesContainer = document.getElementById('rulesContainer');
    const clearCacheBtn = document.getElementById('clearCache');
    const status = document.getElementById('status');

    // Function to mask API key
    function maskApiKey(key) {
        return '*'.repeat(5);
    }

    // Add encryption utilities at the top
    async function encryptApiKey(apiKey) {
        const encoder = new TextEncoder();
        const data = encoder.encode(apiKey);

        // Generate a random encryption key
        const encryptionKey = await crypto.subtle.generateKey(
            { name: "AES-GCM", length: 256 },
            true,
            ["encrypt"]
        );

        // Generate a random IV
        const iv = crypto.getRandomValues(new Uint8Array(12));

        // Encrypt the data
        const encryptedData = await crypto.subtle.encrypt(
            { name: "AES-GCM", iv: iv },
            encryptionKey,
            data
        );

        // Export the encryption key
        const exportedKey = await crypto.subtle.exportKey("raw", encryptionKey);

        // Combine IV and encrypted data
        const combined = new Uint8Array(iv.length + encryptedData.byteLength);
        combined.set(iv);
        combined.set(new Uint8Array(encryptedData), iv.length);

        // Store both the encrypted data and the key
        return {
            encrypted: Array.from(combined),
            key: Array.from(new Uint8Array(exportedKey))
        };
    }

    async function decryptApiKey(encryptedData, keyData) {
        const combined = new Uint8Array(encryptedData);
        const iv = combined.slice(0, 12);
        const data = combined.slice(12);

        // Import the encryption key
        const encryptionKey = await crypto.subtle.importKey(
            "raw",
            new Uint8Array(keyData),
            { name: "AES-GCM", length: 256 },
            false,
            ["decrypt"]
        );

        // Decrypt the data
        const decryptedData = await crypto.subtle.decrypt(
            { name: "AES-GCM", iv: iv },
            encryptionKey,
            data
        );

        const decoder = new TextDecoder();
        return decoder.decode(decryptedData);
    }

    // Load saved settings with masked display
    chrome.storage.local.get(['encryptedApiKey', 'apiKeyEncryptionKey', 'blockRule'], async (result) => {
        if (result.encryptedApiKey && result.apiKeyEncryptionKey) {
            try {
                const apiKey = await decryptApiKey(result.encryptedApiKey, result.apiKeyEncryptionKey);
                apiKeyInput.type = 'password';
                apiKeyInput.dataset.actualValue = apiKey;
                apiKeyInput.value = maskApiKey(apiKey);
            } catch (error) {
                console.error('Error decrypting API key:', error);
                showStatus('Error loading API key', 'error');
            }
        }
        if (result.blockRule) {
            const rules = result.blockRule.split('\n').filter(rule => rule.trim());
            rules.forEach(rule => addRuleToUI(rule));
        }
    });

    // Show actual API key on focus
    apiKeyInput.addEventListener('focus', () => {
        if (apiKeyInput.dataset.actualValue) {
            apiKeyInput.type = 'text';
            apiKeyInput.value = apiKeyInput.dataset.actualValue;
        }
    });

    // Hide API key on blur (when clicking away)
    apiKeyInput.addEventListener('blur', () => {
        if (apiKeyInput.dataset.actualValue) {
            apiKeyInput.type = 'password';
            apiKeyInput.value = maskApiKey(apiKeyInput.dataset.actualValue);
        }
    });

    // Save API key with masking
    apiKeyInput.addEventListener('change', async () => {
        const apiKey = apiKeyInput.value.trim();
        if (apiKey) {
            try {
                // Encrypt the API key before storing
                const encryptedData = await encryptApiKey(apiKey);
                await chrome.storage.local.set({
                    encryptedApiKey: encryptedData.encrypted,
                    apiKeyEncryptionKey: encryptedData.key
                });

                apiKeyInput.dataset.actualValue = apiKey;
                apiKeyInput.type = 'password';
                apiKeyInput.value = maskApiKey(apiKey);
                showStatus('API key saved securely', 'success');
                notifyContentScript();
            } catch (error) {
                console.error('Error encrypting API key:', error);
                showStatus('Error saving API key', 'error');
            }
        }
    });

    // Add new rule
    addRuleBtn.addEventListener('click', () => {
        const rule = newRuleInput.value.trim();
        if (!rule) {
            showStatus('Please enter a rule', 'error');
            return;
        }

        chrome.storage.local.get(['blockRule'], (result) => {
            const rules = result.blockRule ? result.blockRule.split('\n').filter(r => r.trim()) : [];
            if (rules.includes(rule)) {
                showStatus('This rule already exists', 'error');
                return;
            }

            rules.push(rule);
            chrome.storage.local.set({ blockRule: rules.join('\n') }, () => {
                addRuleToUI(rule);
                newRuleInput.value = '';
                showStatus('Rule added successfully', 'success');
                notifyContentScript();
            });
        });
    });

    // Handle "Enter" key in new rule input
    newRuleInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            addRuleBtn.click();
        }
    });

    // Clear cache
    clearCacheBtn.addEventListener('click', async () => {
        try {
            const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
            await chrome.tabs.sendMessage(tabs[0].id, { action: "clearCache" });
            showStatus('Cache cleared successfully', 'success');
        } catch (error) {
            showStatus('Error clearing cache', 'error');
        }
    });

    // Helper function to add rule to UI
    function addRuleToUI(rule) {
        const ruleItem = document.createElement('div');
        ruleItem.className = 'rule-item';

        // Create an input element instead of a div for the rule text
        const ruleText = document.createElement('input');
        ruleText.type = 'text';
        ruleText.className = 'rule-text';
        ruleText.value = rule;
        ruleText.readOnly = true;  // Start in read-only mode

        // Add click handler to make editable
        ruleText.addEventListener('click', () => {
            ruleText.readOnly = false;
            ruleText.focus();
        });

        // Handle editing completion
        ruleText.addEventListener('blur', () => {
            ruleText.readOnly = true;
            if (ruleText.value !== rule) {
                updateRule(rule, ruleText.value);
            }
        });

        // Handle enter key
        ruleText.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                ruleText.blur();
            }
            if (e.key === 'Escape') {
                ruleText.value = rule;
                ruleText.blur();
            }
        });

        const deleteButton = document.createElement('button');
        deleteButton.className = 'rule-delete';
        deleteButton.textContent = '-';
        deleteButton.addEventListener('click', () => deleteRule(rule));

        ruleItem.appendChild(ruleText);
        ruleItem.appendChild(deleteButton);
        rulesContainer.appendChild(ruleItem);
    }

    // Add function to update a rule
    async function updateRule(oldRule, newRule) {
        try {
            const result = await chrome.storage.local.get(['blockRule']);
            let rules = result.blockRule ? result.blockRule.split('\n').filter(r => r.trim()) : [];
            const index = rules.indexOf(oldRule);

            if (index !== -1) {
                rules[index] = newRule;
                await chrome.storage.local.set({ blockRule: rules.join('\n') });

                // Update UI
                showStatus('Rule updated', 'success');

                // Notify content script
                chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
                    chrome.tabs.sendMessage(tabs[0].id, {
                        action: "updateRule",
                        oldRule: oldRule,
                        newRule: newRule
                    });
                });
            }
        } catch (error) {
            console.error('Error updating rule:', error);
            showStatus('Error updating rule', 'error');
        }
    }

    // Add function to delete a rule
    async function deleteRule(rule) {
        try {
            const result = await chrome.storage.local.get(['blockRule']);
            let rules = result.blockRule ? result.blockRule.split('\n').filter(r => r.trim()) : [];
            rules = rules.filter(r => r !== rule);

            await chrome.storage.local.set({ blockRule: rules.join('\n') });

            // Remove the rule's UI element
            const ruleElements = rulesContainer.querySelectorAll('.rule-item');
            for (const element of ruleElements) {
                if (element.querySelector('.rule-text').value === rule) {
                    element.remove();
                    break;
                }
            }

            showStatus('Rule removed', 'success');
            notifyContentScript();
        } catch (error) {
            console.error('Error deleting rule:', error);
            showStatus('Error removing rule', 'error');
        }
    }

    // Helper function to show status messages
    function showStatus(message, type) {
        status.textContent = message;
        status.className = `status ${type}`;
        setTimeout(() => {
            status.className = 'status';
        }, 3000);
    }

    // Helper function to escape HTML
    function escapeHtml(unsafe) {
        return unsafe
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    // Notify content script of changes
    function notifyContentScript() {
        chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
            chrome.tabs.sendMessage(tabs[0].id, { action: "settingsUpdated" });
        });
    }
}); 