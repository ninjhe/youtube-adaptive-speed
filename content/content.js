/**
 * YouTube Adaptive Speed - Content Script
 * Main orchestration script that coordinates transcript fetching,
 * pace analysis, and speed adjustment
 */

(function () {
    'use strict';

    // Debug logging helper - uses global AdaptiveSpeedDebug
    const log = (...args) => AdaptiveSpeedDebug.log(...args);

    // Configuration
    const CONFIG = {
        // How often to recalculate speed (in video seconds played)
        RECALC_INTERVAL_SECONDS: 16,

        // Minimum time before first calculation (let video load)
        INITIAL_DELAY_MS: 2000,

        // How often to check video time (real ms)
        CHECK_INTERVAL_MS: 1000,


    };

    // State
    let state = {
        initialized: false,
        currentVideoId: null,
        transcript: null,
        hasTranscript: false,
        currentSpeed: 1.0,
        speakingPace: null,
        lastCalculationVideoTime: 0,
        wasAdPlaying: false,
        lastVideoTimeBeforeAd: 0,
        firstCalcDone: false,
        manualSpeedOverride: false,
        isEnabled: true, // Extension enabled/disabled state
        error: null
    };

    // Interval handles
    let checkInterval = null;

    /**
     * Initialize the extension for the current video
     */
    async function initialize() {
        if (!SpeedController.isOnVideoPage()) {
            cleanup();
            return;
        }

        const videoId = TranscriptFetcher.getVideoId();

        // If same video, don't reinitialize
        if (videoId === state.currentVideoId && state.initialized) {
            return;
        }

        log('Initializing for video:', videoId);

        // Load saved settings from chrome.storage
        const savedSettings = await new Promise(resolve => {
            chrome.storage.sync.get(['isEnabled', 'targetMultiplier'], (result) => {
                resolve(result);
            });
        });

        // Preserve isEnabled from saved settings or keep current value
        const preservedEnabled = savedSettings.isEnabled !== undefined ? savedSettings.isEnabled : state.isEnabled;

        // Set target multiplier from saved settings
        if (savedSettings.targetMultiplier !== undefined) {
            PlayerUI.targetMultiplier = savedSettings.targetMultiplier;
        }

        // Reset state for new video (preserve isEnabled)
        state = {
            initialized: true,
            currentVideoId: videoId,
            transcript: null,
            hasTranscript: false,
            currentSpeed: 1.0,
            speakingPace: null,
            lastCalculationVideoTime: 0,
            wasAdPlaying: false,
            lastVideoTimeBeforeAd: 0,
            firstCalcDone: false,
            manualSpeedOverride: false,
            isEnabled: preservedEnabled,
            error: null
        };

        // Wait for video element to be ready
        await waitForVideo();

        // Fetch transcript
        try {
            state.transcript = await TranscriptFetcher.fetchTranscript();
            state.hasTranscript = state.transcript && state.transcript.length > 0;

            if (state.hasTranscript) {
                log(`Loaded ${state.transcript.length} transcript segments`);

                // Do initial speed calculation
                await performSpeedCalculation();
                state.firstCalcDone = true; // Prevent duplicate calc in monitoring loop
            } else {
                log('No transcript available, using default speed');
                state.error = 'No transcript available';
            }
        } catch (error) {
            console.error('[AdaptiveSpeed] Error during initialization:', error);
            state.error = 'Failed to load transcript';
        }

        // Start monitoring video playback
        startMonitoring();

        // Listen for manual speed changes via YouTube's UI
        setupSpeedChangeListener();

        // Inject our UI button into YouTube's player
        setupPlayerUI();
    }

    /**
     * Sets up the player UI button and panel
     */
    function setupPlayerUI() {
        // Set up callback for when user changes the target multiplier slider
        PlayerUI.onMultiplierChange = (multiplier) => {
            // Auto-enable if currently disabled
            if (!state.isEnabled) {
                state.isEnabled = true;
                PlayerUI.updateToggleButton(true);
                log('Auto-enabled by slider change');
            }

            // Save settings to chrome.storage
            chrome.storage.sync.set({
                targetMultiplier: multiplier,
                isEnabled: state.isEnabled
            });

            // Recalculate speed with the new multiplier
            performSpeedCalculation();
            log(`Target multiplier set to ${multiplier}x`);
        };

        // Set up callback for enable/disable toggle
        PlayerUI.onToggle = () => {
            state.isEnabled = !state.isEnabled;
            PlayerUI.updateToggleButton(state.isEnabled);

            // Save to chrome.storage
            chrome.storage.sync.set({ isEnabled: state.isEnabled });

            if (state.isEnabled) {
                // Re-enable: recalculate and set speed
                log('Extension enabled');
                performSpeedCalculation();
            } else {
                // Disable: reset to 1.0x so YouTube's native speed takes over
                log('Extension disabled, resetting to 1.0x');
                SpeedController.setSpeed(1.0);
                state.currentSpeed = 1.0;
                PlayerUI.updateSpeed(1.0); // Show 1.00x when disabled
            }
        };

        // Try to inject immediately, retry quickly if player not ready
        const tryInject = () => {
            if (PlayerUI.inject()) {
                PlayerUI.updateSpeed(state.isEnabled ? PlayerUI.targetMultiplier : 1.0);
                PlayerUI.updatePanel(state.speakingPace, state.speakingPace * state.currentSpeed, state.currentSpeed);
                PlayerUI.updateToggleButton(state.isEnabled);
            } else {
                // Retry after a short delay
                setTimeout(tryInject, 200);
            }
        };

        tryInject();
    }

    /**
     * Waits for video element to be ready
     */
    function waitForVideo() {
        return new Promise((resolve) => {
            const check = () => {
                const video = SpeedController.getVideoElement();
                if (video && video.readyState >= 2) {
                    resolve();
                } else {
                    setTimeout(check, 500);
                }
            };
            check();
        });
    }

    /**
     * Sets up listener to detect manual speed changes by user
     */
    function setupSpeedChangeListener() {
        const video = SpeedController.getVideoElement();
        if (!video) return;

        video.addEventListener('ratechange', () => {
            // If speed changed and it doesn't match what we set, user changed it manually
            const currentSpeed = video.playbackRate;
            if (state.currentSpeed !== currentSpeed && state.firstCalcDone) {
                log(`Manual speed change detected: ${currentSpeed}x - pausing auto-adjust`);
                state.manualSpeedOverride = true;
                state.currentSpeed = currentSpeed;
            }
        });
    }

    /**
     * Performs speed calculation based on current position
     */
    async function performSpeedCalculation() {
        if (!state.hasTranscript) return;

        // Skip if extension is disabled
        if (!state.isEnabled) return;

        // Respect manual speed override
        if (state.manualSpeedOverride) {
            return;
        }

        // Skip speed changes during ads
        if (SpeedController.isAdPlaying()) {
            log('Ad detected, skipping speed calculation');
            return;
        }

        const currentTime = SpeedController.getCurrentTime();
        const analysis = SpeedAnalyzer.analyze(state.transcript, currentTime);

        state.speakingPace = analysis.wordsPerSec;

        // Apply the user's target multiplier on top of the normalized speed
        // Formula: finalSpeed = normalizedSpeed × targetMultiplier
        // Raw speed is effectively unlimited (browser supports up to 16x)
        const targetMultiplier = PlayerUI.getTargetMultiplier();
        let targetSpeed = analysis.recommendedSpeed * targetMultiplier;

        // Clamp to valid range [1.0, 3.0]
        targetSpeed = Math.max(1.0, Math.min(3.0, targetSpeed));
        targetSpeed = Math.round(targetSpeed * 20) / 20; // Round to 0.05 increments

        // Check if we should update speed
        const currentSpeed = SpeedController.getSpeed();
        const shouldUpdate = currentSpeed !== targetSpeed;

        if (shouldUpdate || state.lastCalculationVideoTime === 0) {
            state.currentSpeed = SpeedController.setSpeed(targetSpeed);
        } else {
            state.currentSpeed = currentSpeed;
        }

        state.lastCalculationVideoTime = currentTime;

        // Update the player UI
        // Show target multiplier on button, but keep actual speed for panel stats
        PlayerUI.updateSpeed(PlayerUI.targetMultiplier);
        PlayerUI.updatePanel(state.speakingPace, state.speakingPace * state.currentSpeed, state.currentSpeed);
    }

    /**
     * Starts monitoring video playback for recalculation
     */
    function startMonitoring() {
        if (checkInterval) {
            clearInterval(checkInterval);
        }

        checkInterval = setInterval(() => {
            if (!SpeedController.isOnVideoPage()) {
                cleanup();
                return;
            }

            // Track ad state using multiple methods
            const isAdPlaying = SpeedController.isAdPlaying();
            const currentTime = SpeedController.getCurrentTime();

            // Debug logging for ad detection
            if (isAdPlaying && !state.wasAdPlaying) {
                log('Ad started');
            }

            if (isAdPlaying) {
                state.wasAdPlaying = true;
                state.lastVideoTimeBeforeAd = currentTime;
                return;
            }

            // Detect ad end in multiple ways:
            // 1. wasAdPlaying flag from class detection
            // 2. Video time reset (jumped back to near 0 or to a different position)
            const justEndedAd = state.wasAdPlaying;
            const videoTimeReset = state.lastVideoTimeBeforeAd > 0 &&
                Math.abs(currentTime - state.lastVideoTimeBeforeAd) > 5;

            if (justEndedAd || (state.firstCalcDone === false && currentTime > 0)) {
                state.wasAdPlaying = false;
                state.lastVideoTimeBeforeAd = 0;
                log('Video started/resumed, recalculating speed');
                performSpeedCalculation();
                state.firstCalcDone = true;
                return;
            }

            if (!state.hasTranscript || !SpeedController.isVideoPlaying()) {
                return;
            }

            const timeSinceLastCalc = currentTime - state.lastCalculationVideoTime;

            // Recalculate if:
            // 1. Moved forward by N seconds (normal playback)
            // 2. Seeked backward (negative difference indicates seek)
            const shouldRecalc = timeSinceLastCalc >= CONFIG.RECALC_INTERVAL_SECONDS ||
                timeSinceLastCalc < -2; // Seeked back more than 2 seconds

            if (shouldRecalc) {
                performSpeedCalculation();
            }
        }, CONFIG.CHECK_INTERVAL_MS);
    }

    /**
     * Cleans up when leaving video page
     */
    function cleanup() {
        if (checkInterval) {
            clearInterval(checkInterval);
            checkInterval = null;
        }
        state.initialized = false;
    }

    /**
     * Handles messages from popup
     */
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === 'getStatus') {
            sendResponse({
                hasTranscript: state.hasTranscript,
                speakingPace: state.speakingPace,
                currentSpeed: state.currentSpeed,
                error: state.error
            });
        }

        // Handle settings update from popup
        if (request.action === 'updateSettings') {
            if (request.isEnabled !== undefined) {
                state.isEnabled = request.isEnabled;
                PlayerUI.updateToggleButton(state.isEnabled);
            }
            if (request.targetMultiplier !== undefined) {
                PlayerUI.targetMultiplier = request.targetMultiplier;
            }

            // Recalculate if enabled, reset to 1.0x if disabled
            if (state.isEnabled) {
                performSpeedCalculation();
            } else {
                SpeedController.setSpeed(1.0);
                state.currentSpeed = 1.0;
            }

            // Update player UI to reflect changes
            PlayerUI.updateSpeed(state.isEnabled ? PlayerUI.targetMultiplier : 1.0);
            PlayerUI.updatePanel(state.speakingPace, state.speakingPace * state.currentSpeed, state.currentSpeed);

            sendResponse({ success: true });
        }
        return true;
    });

    /**
     * Immediately resets speed to 1.0x - called before the delayed initialize
     */
    function immediateSpeedReset() {
        // Clear YouTube's sessionStorage speed preference
        try {
            sessionStorage.removeItem('yt-player-playback-rate');
        } catch (e) { }

        // Reset video element directly
        const video = document.querySelector('video');
        if (video) {
            video.playbackRate = 1.0;
        }
    }

    /**
     * Observes URL changes (YouTube is SPA)
     */
    function observeNavigation() {
        // Listen for YouTube's navigation events
        let lastUrl = location.href;

        const observer = new MutationObserver(() => {
            const currentUrl = location.href;
            if (currentUrl !== lastUrl) {
                lastUrl = currentUrl;
                // Reset speed IMMEDIATELY on navigation
                immediateSpeedReset();
                setTimeout(initialize, CONFIG.INITIAL_DELAY_MS);
            }
        });

        observer.observe(document.body, { childList: true, subtree: true });

        // Also listen for popstate
        window.addEventListener('popstate', () => {
            immediateSpeedReset();
            setTimeout(initialize, CONFIG.INITIAL_DELAY_MS);
        });

        // Listen for YouTube's spf events (if available)
        window.addEventListener('yt-navigate-finish', () => {
            immediateSpeedReset();
            setTimeout(initialize, CONFIG.INITIAL_DELAY_MS);
        });
    }

    // Start the extension
    log('YouTube Adaptive Speed extension loaded');

    // Wait for page to be ready before initializing
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            setTimeout(initialize, CONFIG.INITIAL_DELAY_MS);
        });
    } else {
        setTimeout(initialize, CONFIG.INITIAL_DELAY_MS);
    }

    // Set up navigation observer for YouTube SPA
    observeNavigation();

})();
