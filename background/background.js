/**
 * Background Script for YouTube Adaptive Speed
 * Handles transcript fetching from a privileged context
 */

// Debug mode - set to true to enable logging
const DEBUG_MODE = true;
const log = (...args) => { if (DEBUG_MODE) console.log('[AdaptiveSpeed BG]', ...args); };

// Listen for transcript fetch requests from content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === 'FETCH_TRANSCRIPT') {
        fetchTranscript(request.url)
            .then(data => sendResponse({ success: true, data }))
            .catch(error => sendResponse({ success: false, error: error.message }));
        return true; // Keep the message channel open for async response
    }
});

/**
 * Fetch transcript from YouTube's timedtext API
 */
async function fetchTranscript(url) {
    log('Fetching transcript:', url);

    const response = await fetch(url, {
        credentials: 'include',
        headers: {
            'Accept': 'application/json, text/plain, */*',
            'Accept-Language': 'en-US,en;q=0.9'
        }
    });

    if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const text = await response.text();
    log('Response length:', text.length);

    if (!text || text.trim() === '') {
        throw new Error('Empty response from YouTube');
    }

    try {
        return JSON.parse(text);
    } catch (e) {
        log('Response preview:', text.substring(0, 200));
        throw new Error('Failed to parse JSON response');
    }
}

log('Background script loaded');
