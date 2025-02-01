document.addEventListener('DOMContentLoaded', () => {
    const apiKeyInput = document.getElementById('apiKey');
    const tagInput = document.getElementById('tagInput');
    const tagContainer = document.getElementById('tagContainer');

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
            }
        }
        if (result.blockRule) {
            const tags = result.blockRule.split('\n').filter(tag => tag.trim());
            tags.forEach(tag => addTagToUI(tag));
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
                notifyContentScript();
            } catch (error) {
                console.error('Error encrypting API key:', error);
            }
        }
    });

    // Handle tag input
    tagInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && tagInput.value.trim()) {
            e.preventDefault();
            const tag = tagInput.value.trim().toLowerCase();
            addTag(tag);
            tagInput.value = '';
        }
    });

    // Add new tag
    async function addTag(tag) {
        try {
            const result = await chrome.storage.local.get(['blockRule']);
            const tags = result.blockRule ? result.blockRule.split('\n').filter(t => t.trim()) : [];

            if (tags.includes(tag)) {
                highlightExistingTag(tag);
                return;
            }

            tags.push(tag);
            await chrome.storage.local.set({ blockRule: tags.join('\n') });
            addTagToUI(tag);
            notifyContentScript();
        } catch (error) {
            console.error('Error adding tag:', error);
        }
    }

    // Highlight existing tag briefly
    function highlightExistingTag(tag) {
        const tagElements = tagContainer.querySelectorAll('.tag');
        for (const element of tagElements) {
            if (element.querySelector('.tag-text').textContent === tag) {
                element.style.borderColor = 'var(--text-primary)';
                element.style.transform = 'translateY(-2px)';
                setTimeout(() => {
                    element.style.borderColor = '';
                    element.style.transform = '';
                }, 1000);
                break;
            }
        }
    }

    // Add tag to UI
    function addTagToUI(tag) {
        const tagElement = document.createElement('div');
        tagElement.className = 'tag';

        const tagText = document.createElement('span');
        tagText.className = 'tag-text';
        tagText.textContent = tag;

        const deleteButton = document.createElement('button');
        deleteButton.className = 'tag-delete';
        deleteButton.textContent = 'x';
        deleteButton.setAttribute('aria-label', `Remove ${tag}`);
        deleteButton.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            deleteTag(tag, tagElement);
        });

        tagElement.appendChild(tagText);
        tagElement.appendChild(deleteButton);
        tagContainer.appendChild(tagElement);

        requestAnimationFrame(() => {
            tagElement.style.animation = 'tagAppear 0.2s ease forwards';
        });
    }

    // Delete tag with animation
    async function deleteTag(tag, tagElement) {
        try {
            tagElement.style.animation = 'tagRemove 0.15s ease forwards';

            await new Promise(resolve => setTimeout(resolve, 150));

            const result = await chrome.storage.local.get(['blockRule']);
            let tags = result.blockRule ? result.blockRule.split('\n').filter(t => t.trim()) : [];
            tags = tags.filter(t => t !== tag);

            await chrome.storage.local.set({ blockRule: tags.join('\n') });
            tagElement.remove();
            notifyContentScript();
        } catch (error) {
            console.error('Error deleting tag:', error);
        }
    }

    // Notify content script of changes
    function notifyContentScript() {
        chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
            chrome.tabs.sendMessage(tabs[0].id, { action: "settingsUpdated" });
        });
    }
}); 