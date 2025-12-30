/**
 * YouTube Adaptive Speed - Player UI Integration
 * Adds a speed indicator button to YouTube's native player controls
 */

const PlayerUI = {
    buttonId: 'adaptive-speed-button',
    panelId: 'adaptive-speed-panel',
    isInjected: false,
    targetMultiplier: 1.0, // User's target speed multiplier (1.0 = baseline, 1.5 = 1.5x faster than baseline)

    /**
     * Injects our speed button into YouTube's player controls
     */
    inject() {
        // Don't inject twice
        if (document.getElementById(this.buttonId)) {
            return true;
        }

        // Find the settings button to insert before it
        const settingsButton = document.querySelector('.ytp-settings-button');
        if (!settingsButton) {
            return false;
        }

        // Create our button
        const button = document.createElement('button');
        button.id = this.buttonId;
        button.className = 'ytp-button';
        button.setAttribute('aria-label', 'Adaptive Speed Settings');
        button.setAttribute('title', 'Adaptive Speed');
        button.innerHTML = this.getButtonContent(1.0);

        // Style the button text
        button.style.cssText = `
            font-size: 14px;
            font-weight: 500;
            color: white;
            display: flex;
            align-items: center;
            justify-content: center;
            min-width: 40px;
            cursor: pointer;
        `;

        // Add click handler
        button.addEventListener('click', (e) => {
            e.stopPropagation();
            this.togglePanel();
        });

        // Insert before settings button
        settingsButton.parentNode.insertBefore(button, settingsButton);

        // Create the settings panel (hidden by default)
        this.createPanel();

        this.isInjected = true;
        AdaptiveSpeedDebug.log('UI button injected');
        return true;
    },

    /**
     * Gets the button content (speed indicator)
     */
    getButtonContent(speed) {
        return `<span style="font-family: 'YouTube Sans', 'Roboto', sans-serif;">${speed.toFixed(2)}x</span>`;
    },

    /**
     * Updates the displayed speed
     */
    updateSpeed(speed) {
        const button = document.getElementById(this.buttonId);
        if (button) {
            button.innerHTML = this.getButtonContent(speed);
        }
    },

    /**
     * Creates the settings panel
     */
    createPanel() {
        if (document.getElementById(this.panelId)) {
            return;
        }

        const panel = document.createElement('div');
        panel.id = this.panelId;
        panel.style.cssText = `
            position: absolute;
            bottom: 60px;
            right: 100px;
            background: rgba(15, 15, 15, 0.75);
            border-radius: 12px;
            padding: 14px 18px;
            min-width: 260px;
            display: none;
            z-index: 9999;
            box-shadow: 0 2px 10px rgba(0,0,0,0.3);
            font-family: 'YouTube Sans', 'Roboto', sans-serif;
            color: white;
        `;

        panel.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px;">
                <span style="font-size: 18px; font-weight: 500;">YT Adaptive Speed</span>
                <button id="adaptive-speed-toggle" style="
                    padding: 4px 10px;
                    border: none;
                    border-radius: 4px;
                    background: #cc0000;
                    color: white;
                    font-size: 12px;
                    font-weight: 500;
                    cursor: pointer;
                ">Disable</button>
            </div>
            <div style="font-size: 15px; color: #aaa; margin-bottom: 8px;">
                Base speaking pace: <span id="adaptive-speed-pace">-- wps</span>
            </div>
            <div style="font-size: 15px; color: #aaa; margin-bottom: 14px;">
                Adjusted speaking pace: <span id="adaptive-speed-adjusted">-- wps</span>
            </div>
            <hr style="border: none; border-top: 1px solid #444; margin: 12px 0;">
            <div style="text-align: center; margin-bottom: 8px;">
                <span id="adaptive-speed-target" style="font-size: 16px; color: #fff;">1.00x</span>
                <span id="adaptive-speed-actual" style="font-size: 14px; color: #888;"></span>
            </div>
            <input type="range" id="adaptive-speed-slider" 
                min="1" max="2.5" step="0.05" value="1"
                style="width: 100%; cursor: pointer; background: linear-gradient(to right, #fff 0%, #404040 0%);">
            <style>
                #adaptive-speed-slider {
                    -webkit-appearance: none;
                    appearance: none;
                    height: 5px;
                    border-radius: 3px;
                    outline: none;
                }
                #adaptive-speed-slider::-webkit-slider-thumb {
                    -webkit-appearance: none;
                    appearance: none;
                    width: 14px;
                    height: 14px;
                    background: #fff;
                    border-radius: 50%;
                    cursor: pointer;
                }
                #adaptive-speed-slider::-moz-range-thumb {
                    width: 14px;
                    height: 14px;
                    background: #fff;
                    border-radius: 50%;
                    cursor: pointer;
                    border: none;
                }
                #adaptive-speed-slider::-moz-range-track {
                    background: #404040;
                    height: 5px;
                    border-radius: 3px;
                }
            </style>
        `;

        // Find the player container to append to
        const player = document.getElementById('movie_player');
        if (player) {
            player.appendChild(panel);
        } else {
            document.body.appendChild(panel);
        }

        // Add event listener for slider
        const slider = panel.querySelector('#adaptive-speed-slider');
        const targetLabel = panel.querySelector('#adaptive-speed-target');

        // Function to update slider fill (left of thumb = white, right = gray)
        const updateSliderFill = (slider) => {
            const min = parseFloat(slider.min);
            const max = parseFloat(slider.max);
            const value = parseFloat(slider.value);
            const percent = ((value - min) / (max - min)) * 100;
            slider.style.background = `linear-gradient(to right, #fff ${percent}%, #404040 ${percent}%)`;
        };

        // Initial fill
        updateSliderFill(slider);

        slider.addEventListener('input', (e) => {
            const value = parseFloat(e.target.value);
            this.targetMultiplier = value;
            targetLabel.textContent = value.toFixed(2) + 'x';
            updateSliderFill(e.target);
            this.onMultiplierChange(value);
        });

        // Toggle button for enabling/disabling the extension
        const toggleBtn = panel.querySelector('#adaptive-speed-toggle');
        toggleBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.onToggle();
        });

        // Track if mouse has entered the panel
        let mouseEntered = false;

        panel.addEventListener('mouseenter', () => {
            mouseEntered = true;
            // Clear the auto-close timeout since mouse entered
            if (this._autoCloseTimeout) {
                clearTimeout(this._autoCloseTimeout);
                this._autoCloseTimeout = null;
            }
        });

        // Close panel when mouse leaves (only if it had entered)
        panel.addEventListener('mouseleave', () => {
            if (mouseEntered) {
                this.hidePanel();
                mouseEntered = false;
            }
        });

        // Close panel when clicking outside
        document.addEventListener('click', (e) => {
            if (!panel.contains(e.target) && e.target.id !== this.buttonId) {
                this.hidePanel();
            }
        });
    },

    /**
     * Toggles the panel visibility
     */
    togglePanel() {
        const panel = document.getElementById(this.panelId);
        if (panel) {
            const isVisible = panel.style.display === 'block';
            if (isVisible) {
                this.hidePanel();
            } else {
                panel.style.display = 'block';
                // Auto-close after 5 seconds if mouse doesn't enter
                this._autoCloseTimeout = setTimeout(() => {
                    this.hidePanel();
                }, 5000);
            }
        }
    },

    /**
     * Hides the panel
     */
    hidePanel() {
        const panel = document.getElementById(this.panelId);
        if (panel) {
            panel.style.display = 'none';
        }
    },

    /**
     * Updates the panel with current stats
     */
    updatePanel(basePace, adjustedPace, actualSpeed) {
        const paceEl = document.getElementById('adaptive-speed-pace');
        const adjustedEl = document.getElementById('adaptive-speed-adjusted');
        const slider = document.getElementById('adaptive-speed-slider');
        const targetLabel = document.getElementById('adaptive-speed-target');
        const actualLabel = document.getElementById('adaptive-speed-actual');

        if (paceEl) paceEl.textContent = basePace ? basePace.toFixed(2) + ' wps' : '-- wps';
        if (adjustedEl) adjustedEl.textContent = adjustedPace ? adjustedPace.toFixed(2) + ' wps' : '-- wps';
        if (slider) {
            slider.value = this.targetMultiplier;
            // Update slider fill
            const min = parseFloat(slider.min);
            const max = parseFloat(slider.max);
            const percent = ((this.targetMultiplier - min) / (max - min)) * 100;
            slider.style.background = `linear-gradient(to right, #fff ${percent}%, #404040 ${percent}%)`;
        }
        if (targetLabel) targetLabel.textContent = this.targetMultiplier.toFixed(2) + 'x';
        if (actualLabel && actualSpeed) actualLabel.textContent = ` (${actualSpeed.toFixed(2)}x speedup)`;
    },

    /**
     * Gets the current target multiplier
     */
    getTargetMultiplier() {
        return this.targetMultiplier;
    },

    /**
     * Updates the toggle button state
     */
    updateToggleButton(isEnabled) {
        const toggleBtn = document.getElementById('adaptive-speed-toggle');
        if (toggleBtn) {
            if (isEnabled) {
                toggleBtn.textContent = 'Disable';
                toggleBtn.style.background = '#cc0000';
            } else {
                toggleBtn.textContent = 'Enable';
                toggleBtn.style.background = '#2e7d32';
            }
        }
    },

    // Callbacks - will be set by content.js
    onMultiplierChange: (multiplier) => { },
    onToggle: () => { },

    /**
     * Removes our injected UI
     */
    remove() {
        const button = document.getElementById(this.buttonId);
        const panel = document.getElementById(this.panelId);
        if (button) button.remove();
        if (panel) panel.remove();
        this.isInjected = false;
    }
};
