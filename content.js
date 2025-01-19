const DEBUG = false;

// Memory management constants
const CACHE_LIMITS = {
    MAX_PROCESSED_TWEETS: 1000,  // Maximum number of processed tweet IDs to keep
    CLEANUP_INTERVAL: 5 * 60 * 1000,  // Cleanup every 5 minutes
    MAX_QUEUE_SIZE: 100  // Maximum number of tweets in processing queue
};

// LRU Cache implementation
class LRUCache {
    constructor(maxSize) {
        this.maxSize = maxSize;
        this.cache = new Map();
    }

    add(key) {
        // Remove oldest if we're at capacity
        if (this.cache.size >= this.maxSize) {
            const firstKey = this.cache.keys().next().value;
            this.cache.delete(firstKey);
        }
        // Add new key with timestamp
        this.cache.set(key, Date.now());
    }

    has(key) {
        return this.cache.has(key);
    }

    clear() {
        this.cache.clear();
    }

    get size() {
        return this.cache.size;
    }
}

// Global variables
let apiKey = '';
let blockRule = '';
let processedTweetIds = new LRUCache(CACHE_LIMITS.MAX_PROCESSED_TWEETS);
let processingQueue = new Set();
let debounceTimer = null;
let hiddenTweetsCount = 0;
let totalProcessedCount = 0;

// Add debug logging function
function debugLog(...args) {
    if (DEBUG) {
        console.log(...args);
    }
}

// Add minimal logging function
function log(...args) {
    console.log(...args);
}

// Add decryption utility
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

// Update loadSettings function
function loadSettings() {
    debugLog('🔄 Loading extension settings...');
    return chrome.storage.local.get(['encryptedApiKey', 'apiKeyEncryptionKey', 'blockRule']).then(async result => {
        if (result.encryptedApiKey && result.apiKeyEncryptionKey) {
            try {
                apiKey = await decryptApiKey(result.encryptedApiKey, result.apiKeyEncryptionKey);
                debugLog('✅ API key loaded and decrypted');
            } catch (error) {
                console.error('Error decrypting API key:', error);
                apiKey = '';
            }
        } else {
            apiKey = '';
        }

        blockRule = result.blockRule || '';

        if (apiKey && blockRule) {
            debugLog('✅ Settings loaded - Rule:', blockRule);
            processTweets();
        } else {
            debugLog('⚠️ Missing settings - Please configure the extension');
        }
    });
}

// Update stats display
function updateStats() {
    const blockRate = ((hiddenTweetsCount / totalProcessedCount) * 100).toFixed(1);
    if (DEBUG) {
        debugLog(`📊 Stats: ${hiddenTweetsCount} blocked / ${totalProcessedCount} total (${blockRate}% block rate)`);
    }
}

// Debounce function
function debounce(func, wait) {
    return (...args) => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => func.apply(this, args), wait);
    };
}

// Extract full tweet content including text, images, and cashtags
function extractTweetContent(tweet) {
    try {
        let content = [];

        // Get main tweet text
        const tweetText = tweet.querySelector('[data-testid="tweetText"]')?.textContent || '';
        if (tweetText) content.push(tweetText);

        // Get image descriptions/alt text
        const images = tweet.querySelectorAll('img[alt]:not([alt=""])');
        images.forEach(img => {
            if (img.alt && !img.alt.includes("Image")) {
                content.push(`Image description: ${img.alt}`);
            }
        });

        // Get $cashtags and #hashtags
        const symbols = tweet.querySelectorAll('a[href*="/search?q=%24"], a[href*="/hashtag/"]');
        symbols.forEach(symbol => {
            content.push(symbol.textContent);
        });

        return content.join(' ');
    } catch (error) {
        console.error('Error extracting tweet content:', error);
        return '';
    }
}

// Update checkSimilarity function for efficiency
async function checkSimilarity(tweetText, tweetId) {
    if (!apiKey || !blockRule) return false;

    // Check cache first
    try {
        const cachedResult = await TweetCache.getCachedResult(tweetId);
        if (cachedResult !== null) {
            debugLog(`🎯 Cache hit for tweet ${tweetId.substring(0, 8)}...`);
            return cachedResult;
        }
    } catch (error) {
        console.error('Cache error:', error);
    }

    try {
        debugLog(`🔄 API request for tweet ${tweetId.substring(0, 8)}...`);
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: "gpt-3.5-turbo",
                messages: [
                    {
                        role: "system",
                        content: `
                        You are an advanced semantic content analyzer specializing in modern internet discourse and cultural context. 
                        Your task is to determine if content should be blocked based on both explicit and implicit semantic relationships to specified topics. 
                        You operate with deep understanding of internet linguistics, meme culture, and evolving digital communication patterns.

                        PRIMARY ANALYSIS FRAMEWORK:

                        1. Multi-Layer Content Analysis:
                        - Surface Level: Direct mentions and explicit references
                        - Contextual Level: Implied meanings and cultural references
                        - Linguistic Level: Internet-specific language patterns and evolving terminology
                        - Cultural Level: Memes, inside jokes, and community-specific references
                        - Intent Level: True purpose of the message beyond literal meaning

                        2. Context Vectors:
                        - Temporal Context: Current trends and timely references
                        - Community Context: Subculture-specific communication patterns
                        - Platform Context: Twitter-specific language and behavior patterns
                        - Symbolic Context: Emojis, formatting, and visual language markers

                        3. Pattern Recognition:
                        - Historical Pattern Matching: Common expressions within topic communities
                        - Linguistic Mutations: How terms evolve and transform in online discourse
                        - Cross-Reference Analysis: Related topics and adjacent discussions
                        - Sentiment Pattern Analysis: How communities express enthusiasm/criticism
                        
                        1 = block (high confidence match)
                        0 = allow (not a match)
                        
                        Respond with ONLY the number 1 or 0.`
                    },
                    {
                        role: "user",
                        content: `Rule: "${blockRule}" Content: "${tweetText}"`
                    }
                ],
                temperature: 0,
                max_tokens: 1,
                response_format: { "type": "text" }
            })
        });

        if (!response.ok) {
            throw new Error(`API request failed: ${response.status}`);
        }

        const data = await response.json();
        if (!data.choices?.[0]?.message?.content) {
            throw new Error('Invalid API response format');
        }

        const result = parseInt(data.choices[0].message.content.trim());
        const shouldBlock = result === 1;

        if (DEBUG) {
            debugLog(`✨ Analysis for ${tweetId.substring(0, 8)}...`);
            debugLog(`🎯 Decision: ${shouldBlock ? '🚫 Block' : '✅ Allow'}`);
        }

        // Cache the result
        try {
            await TweetCache.cacheResult(tweetId, tweetText, shouldBlock);
        } catch (error) {
            console.error('Cache error:', error);
        }

        return shouldBlock;
    } catch (error) {
        console.error('API error:', error);
        return false;
    }
}

// Hide a tweet in an accessible way
function hideTweet(tweet) {
    try {
        // Use a more accessible approach to hiding
        tweet.style.position = 'absolute';
        tweet.style.width = '1px';
        tweet.style.height = '1px';
        tweet.style.padding = '0';
        tweet.style.margin = '-1px';
        tweet.style.overflow = 'hidden';
        tweet.style.clip = 'rect(0, 0, 0, 0)';
        tweet.style.whiteSpace = 'nowrap';
        tweet.style.border = '0';

        // Add proper ARIA attributes
        tweet.setAttribute('aria-hidden', 'true');
        tweet.setAttribute('inert', '');  // Prevents focus and interaction

        hiddenTweetsCount++;
        updateStats();
    } catch (error) {
        console.error('Error hiding tweet:', error);
    }
}

// Add cleanup function
function cleanupProcessingQueue() {
    if (processingQueue.size > CACHE_LIMITS.MAX_QUEUE_SIZE) {
        debugLog('🧹 Cleaning up processing queue...');
        const queueArray = Array.from(processingQueue);
        const toRemove = queueArray.slice(0, queueArray.length - CACHE_LIMITS.MAX_QUEUE_SIZE);
        toRemove.forEach(id => processingQueue.delete(id));
    }
}

// Add periodic cleanup
function startPeriodicCleanup() {
    setInterval(() => {
        const beforeSize = processedTweetIds.size;
        cleanupProcessingQueue();
        const afterSize = processedTweetIds.size;

        if (DEBUG && beforeSize !== afterSize) {
            debugLog(`🧹 Cleanup complete: Removed ${beforeSize - afterSize} entries`);
            debugLog(`📊 Current cache size: ${afterSize}`);
            debugLog(`📊 Current queue size: ${processingQueue.size}`);
        }
    }, CACHE_LIMITS.CLEANUP_INTERVAL);
}

// Update processTweets function to use new cache
async function processTweets() {
    if (!apiKey || !blockRule) return;

    try {
        const tweets = document.querySelectorAll([
            'article[data-testid="tweet"]:not([data-processed="true"]):not([data-processing="true"])',
            'div[data-testid="tweet"]:not([data-processed="true"]):not([data-processing="true"])',
            'div[data-testid="tweetDetail"]:not([data-processed="true"]):not([data-processing="true"])'
        ].join(','));

        const newTweets = Array.from(tweets).filter(tweet => {
            const tweetId = tweet.querySelector('time')?.closest('a')?.href?.split('/status/')?.[1] ||
                tweet.closest('div[data-testid="tweetDetail"]')?.getAttribute('aria-labelledby')?.split('-')[0];
            return tweetId && !processedTweetIds.has(tweetId) && !processingQueue.has(tweetId);
        });

        if (newTweets.length > 0) {
            debugLog(`🔍 Processing ${newTweets.length} new tweets...`);
        }

        // Process tweets in parallel batches
        const BATCH_SIZE = 5;
        for (let i = 0; i < newTweets.length; i += BATCH_SIZE) {
            const batch = newTweets.slice(i, i + BATCH_SIZE);
            await Promise.all(batch.map(async (tweet) => {
                const tweetId = tweet.querySelector('time')?.closest('a')?.href?.split('/status/')?.[1] ||
                    tweet.closest('div[data-testid="tweetDetail"]')?.getAttribute('aria-labelledby')?.split('-')[0];
                if (!tweetId) return;

                tweet.dataset.processing = 'true';
                processingQueue.add(tweetId);
                cleanupProcessingQueue();  // Check queue size after adding

                const tweetContent = extractTweetContent(tweet);
                if (!tweetContent) {
                    processingQueue.delete(tweetId);
                    delete tweet.dataset.processing;
                    return;
                }

                try {
                    totalProcessedCount++;
                    const shouldBlock = await checkSimilarity(tweetContent, tweetId);
                    if (shouldBlock) {
                        hideTweet(tweet);
                        tweet.dataset.blocked = 'true';
                    }
                    updateStats();
                } catch (error) {
                    console.error('Error processing tweet:', error);
                }

                processedTweetIds.add(tweetId);
                processingQueue.delete(tweetId);
                tweet.dataset.processed = 'true';
                delete tweet.dataset.processing;
            }));
        }
    } catch (error) {
        console.error('Error in processTweets:', error);
    }
}

// Optimized debounce with shorter delay
const debouncedProcessTweets = debounce(() => {
    if (apiKey && blockRule) {
        processTweets();
    }
}, 100);

// Update storage change listener
chrome.storage.onChanged.addListener((changes) => {
    debugLog('🔄 Settings changed');

    // Handle encrypted API key changes
    if (changes.encryptedApiKey && changes.apiKeyEncryptionKey) {
        const encryptedApiKey = changes.encryptedApiKey.newValue;
        const apiKeyEncryptionKey = changes.apiKeyEncryptionKey.newValue;

        if (encryptedApiKey && apiKeyEncryptionKey) {
            decryptApiKey(encryptedApiKey, apiKeyEncryptionKey)
                .then(decryptedKey => {
                    apiKey = decryptedKey;
                    processTweets();
                })
                .catch(error => {
                    console.error('Error decrypting new API key:', error);
                    apiKey = '';
                });
        } else {
            apiKey = '';
        }
    }

    if (changes.blockRule) {
        blockRule = changes.blockRule.newValue || '';
    }

    if (changes.encryptedApiKey || changes.apiKeyEncryptionKey || changes.blockRule) {
        processedTweetIds.clear();
        processingQueue.clear();
        hiddenTweetsCount = 0;
        totalProcessedCount = 0;
        processTweets();
    }
});

// Main execution with optimized observer
async function init() {
    debugLog('🚀 Initializing Semantic Mute...');
    try {
        await loadSettings();
        startPeriodicCleanup();  // Start periodic cleanup

        // Create observer for new tweets with optimized configuration
        const observer = new MutationObserver((mutations) => {
            if (!apiKey || !blockRule) return;

            // Check if we need to process by looking for specific tweet elements
            const hasNewTweets = mutations.some(mutation => {
                // Only process addedNodes
                if (mutation.type !== 'childList') return false;

                // Check for tweet-related elements
                return Array.from(mutation.addedNodes).some(node => {
                    if (node.nodeType !== 1) return false;  // Skip non-element nodes

                    // Check for tweet elements or containers
                    return (
                        node.matches?.('article[data-testid="tweet"]') ||
                        node.matches?.('div[data-testid="tweet"]') ||
                        node.matches?.('div[data-testid="tweetDetail"]') ||
                        node.querySelector?.([
                            'article[data-testid="tweet"]',
                            'div[data-testid="tweet"]',
                            'div[data-testid="tweetDetail"]'
                        ].join(','))
                    );
                });
            });

            if (hasNewTweets) {
                debouncedProcessTweets();
            }
        });

        // More specific observer configuration
        observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: false,
            characterData: false
        });

        debugLog('👀 Tweet observer active');
        await processTweets();
    } catch (error) {
        console.error('Initialization error:', error);
    }
}

// Initialize the extension
init();

// Add message listener for cache clearing and rule updates
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    debugLog('Message received in content script:', request);

    if (request.action === "clearCache") {
        TweetCache.clearAllCache().then(() => {
            processedTweetIds.clear();
            processingQueue.clear();
            hiddenTweetsCount = 0;
            totalProcessedCount = 0;
            debugLog('🧹 Cache and stats reset');
        }).catch(error => {
            console.error('Error clearing cache:', error);
        });
    } else if (request.action === "updateRule") {
        // Update the block rule and reset processing
        if (blockRule === request.oldRule) {
            blockRule = request.newRule;
            processedTweetIds.clear();
            processingQueue.clear();
            hiddenTweetsCount = 0;
            totalProcessedCount = 0;
            debugLog('🔄 Rule updated, reprocessing tweets...');
            processTweets();
        }
    }
}); 