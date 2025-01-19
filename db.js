// Database configuration
const DB_NAME = 'TweetCacheDB';
const STORE_NAME = 'tweetCache';
const DB_VERSION = 1;
const CACHE_DURATION = 30 * 60 * 1000; // 30 minutes in milliseconds

// Global DB connection
let dbConnection = null;

// Initialize database
async function initDB() {
    if (dbConnection) return dbConnection;

    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
            dbConnection = request.result;
            resolve(dbConnection);
        };

        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                const store = db.createObjectStore(STORE_NAME, { keyPath: 'tweetId' });
                store.createIndex('timestamp', 'timestamp', { unique: false });
            }
        };
    });
}

// Memory cache for super-fast lookups
const memoryCache = new Map();

// Clean old cache entries (both memory and DB)
async function cleanOldCache(db) {
    const cutoffTime = Date.now() - CACHE_DURATION;

    // Clean memory cache
    for (const [key, value] of memoryCache.entries()) {
        if (value.timestamp < cutoffTime) {
            memoryCache.delete(key);
        }
    }

    // Clean DB cache
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const index = store.index('timestamp');

        const range = IDBKeyRange.upperBound(cutoffTime);
        const request = index.openCursor(range);

        request.onsuccess = (event) => {
            const cursor = event.target.result;
            if (cursor) {
                store.delete(cursor.primaryKey);
                cursor.continue();
            }
        };

        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
    });
}

// Get cached result for a tweet
async function getCachedResult(tweetId) {
    // Check memory cache first
    const memoryCacheEntry = memoryCache.get(tweetId);
    if (memoryCacheEntry) {
        if (Date.now() - memoryCacheEntry.timestamp <= CACHE_DURATION) {
            return memoryCacheEntry.shouldBlock;
        }
        memoryCache.delete(tweetId);
    }

    // Check DB cache
    const db = await initDB();
    await cleanOldCache(db);

    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.get(tweetId);

        request.onsuccess = () => {
            const result = request.result;
            if (result && Date.now() - result.timestamp <= CACHE_DURATION) {
                // Update memory cache
                memoryCache.set(tweetId, result);
                resolve(result.shouldBlock);
            } else {
                resolve(null);
            }
        };

        request.onerror = () => reject(request.error);
    });
}

// Cache result for a tweet
async function cacheResult(tweetId, tweetText, shouldBlock) {
    const cacheEntry = {
        tweetId,
        tweetText,
        shouldBlock,
        timestamp: Date.now()
    };

    // Update memory cache immediately
    memoryCache.set(tweetId, cacheEntry);

    // Update DB cache
    const db = await initDB();

    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.put(cacheEntry);

        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

// Clear all cache (both memory and DB)
async function clearAllCache() {
    // Clear memory cache
    memoryCache.clear();

    // Clear DB cache
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.clear();

        request.onsuccess = () => {
            console.log('🧹 Cache cleared successfully');
            resolve();
        };
        request.onerror = () => reject(request.error);
    });
}

// Export functions
window.TweetCache = {
    getCachedResult,
    cacheResult,
    clearAllCache
}; 