/**
 * Debug Logging Utility
 * Set DEBUG_MODE to true to enable console logging
 */

const AdaptiveSpeedDebug = {
    // Set to true to enable debug logging
    DEBUG_MODE: false,

    /**
     * Log a debug message (only if DEBUG_MODE is true)
     */
    log(...args) {
        if (this.DEBUG_MODE) {
            console.log('[AdaptiveSpeed]', ...args);
        }
    },

    /**
     * Log a warning (always shown)
     */
    warn(...args) {
        console.warn('[AdaptiveSpeed]', ...args);
    },

    /**
     * Log an error (always shown)
     */
    error(...args) {
        console.error('[AdaptiveSpeed]', ...args);
    }
};

// Make available globally
window.AdaptiveSpeedDebug = AdaptiveSpeedDebug;
