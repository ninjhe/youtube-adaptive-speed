/**
 * Playback Speed Controller Module
 * Manages YouTube video playback speed
 */

const SpeedController = {
    // Speed constraints
    MIN_SPEED: 1.0,
    MAX_SPEED: 3.0,
    SPEED_INCREMENT: 0.05,

    // Cache for current speed
    _currentSpeed: 1.0,

    /**
     * Gets the YouTube video element
     * @returns {HTMLVideoElement|null}
     */
    getVideoElement() {
        return document.querySelector('video.html5-main-video') || document.querySelector('video');
    },

    /**
     * Gets the current video playback time in seconds
     * @returns {number}
     */
    getCurrentTime() {
        const video = this.getVideoElement();
        return video ? video.currentTime : 0;
    },

    /**
     * Gets the current playback speed
     * @returns {number}
     */
    getSpeed() {
        const video = this.getVideoElement();
        if (video) {
            this._currentSpeed = video.playbackRate;
        }
        return this._currentSpeed;
    },

    /**
     * Sets the playback speed
     * @param {number} speed - Target speed (will be clamped and rounded)
     * @returns {number} The actual speed that was set
     */
    setSpeed(speed) {
        const video = this.getVideoElement();
        if (!video) {
            console.warn('[AdaptiveSpeed] No video element found');
            return this._currentSpeed;
        }

        // Clamp and round the speed
        let targetSpeed = this.normalizeSpeed(speed);

        // Only update if different
        if (Math.abs(video.playbackRate - targetSpeed) >= 0.01) {
            video.playbackRate = targetSpeed;
            this._currentSpeed = targetSpeed;
            AdaptiveSpeedDebug.log(`Speed set to ${targetSpeed.toFixed(2)}x`);
        }

        return targetSpeed;
    },

    /**
     * Normalizes a speed value to valid YouTube increments
     * @param {number} speed - Raw speed value
     * @returns {number} Normalized speed
     */
    normalizeSpeed(speed) {
        // Clamp to range
        let normalized = Math.max(this.MIN_SPEED, Math.min(this.MAX_SPEED, speed));

        // Round to increment
        normalized = Math.round(normalized / this.SPEED_INCREMENT) * this.SPEED_INCREMENT;

        // Fix floating point issues
        normalized = Math.round(normalized * 100) / 100;

        return normalized;
    },

    /**
     * Checks if a video is currently playing
     * @returns {boolean}
     */
    isVideoPlaying() {
        const video = this.getVideoElement();
        return video && !video.paused && !video.ended && video.readyState > 2;
    },

    /**
     * Checks if we're on a video page
     * @returns {boolean}
     */
    isOnVideoPage() {
        return window.location.pathname === '/watch';
    },

    /**
     * Checks if an ad is currently playing
     * YouTube uses various indicators for ads
     * @returns {boolean}
     */
    isAdPlaying() {
        // Check for ad-showing class on the player container
        const player = document.querySelector('#movie_player');
        if (player && player.classList.contains('ad-showing')) {
            return true;
        }

        // Check for ad overlay
        if (document.querySelector('.ytp-ad-player-overlay')) {
            return true;
        }

        // Check for ad text indicator
        if (document.querySelector('.ytp-ad-text')) {
            return true;
        }

        // Check for "Skip ad" button (indicates ad is playing)
        if (document.querySelector('.ytp-ad-skip-button, .ytp-ad-skip-button-modern')) {
            return true;
        }

        return false;
    },

    /**
     * Gets the video duration
     * @returns {number}
     */
    getVideoDuration() {
        const video = this.getVideoElement();
        return video ? video.duration : 0;
    }
};

// Make available globally for content script
window.SpeedController = SpeedController;
