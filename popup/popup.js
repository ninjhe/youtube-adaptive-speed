// Popup script - mirrors player menu with shared state via chrome.storage

let currentState = {
  isEnabled: true,
  targetMultiplier: 1.0,
  basePace: null,
  adjustedPace: null,
  currentSpeed: 1.0
};

// Update slider fill (left of thumb = white, right = gray)
function updateSliderFill(slider) {
  const min = parseFloat(slider.min);
  const max = parseFloat(slider.max);
  const value = parseFloat(slider.value);
  const percent = ((value - min) / (max - min)) * 100;
  slider.style.background = `linear-gradient(to right, #fff ${percent}%, #404040 ${percent}%)`;
}

// Update UI with current state
function updateUI() {
  const toggleBtn = document.getElementById('toggle-btn');
  const basePaceEl = document.getElementById('base-pace');
  const adjustedPaceEl = document.getElementById('adjusted-pace');
  const targetSpeedEl = document.getElementById('target-speed');
  const actualSpeedEl = document.getElementById('actual-speed');
  const slider = document.getElementById('speed-slider');

  // Toggle button
  if (currentState.isEnabled) {
    toggleBtn.textContent = 'Disable';
    toggleBtn.className = 'toggle-btn disable';
  } else {
    toggleBtn.textContent = 'Enable';
    toggleBtn.className = 'toggle-btn enable';
  }

  // Stats
  basePaceEl.textContent = currentState.basePace ? currentState.basePace.toFixed(2) + ' wps' : '-- wps';
  adjustedPaceEl.textContent = currentState.adjustedPace ? currentState.adjustedPace.toFixed(2) + ' wps' : '-- wps';

  // Slider and speed
  slider.value = currentState.targetMultiplier;
  updateSliderFill(slider);
  targetSpeedEl.textContent = currentState.targetMultiplier.toFixed(2) + 'x';
  actualSpeedEl.textContent = currentState.currentSpeed ? ` (${currentState.currentSpeed.toFixed(2)}x speedup)` : '';
}

// Load settings from chrome.storage and get live data from content script
async function loadState() {
  // Get saved settings
  const saved = await chrome.storage.sync.get(['isEnabled', 'targetMultiplier']);
  if (saved.isEnabled !== undefined) currentState.isEnabled = saved.isEnabled;
  if (saved.targetMultiplier !== undefined) currentState.targetMultiplier = saved.targetMultiplier;

  // Try to get live data from content script
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.url && tab.url.includes('youtube.com/watch')) {
      const response = await chrome.tabs.sendMessage(tab.id, { action: 'getStatus' });
      if (response && response.hasTranscript) {
        currentState.basePace = response.speakingPace;
        currentState.adjustedPace = response.speakingPace * response.currentSpeed;
        currentState.currentSpeed = response.currentSpeed;
      }
    }
  } catch (e) {
    // Content script may not be ready
  }

  updateUI();
}

// Save settings and notify content script
async function saveAndSync() {
  await chrome.storage.sync.set({
    isEnabled: currentState.isEnabled,
    targetMultiplier: currentState.targetMultiplier
  });

  // Notify content script to update
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.url && tab.url.includes('youtube.com/watch')) {
      await chrome.tabs.sendMessage(tab.id, {
        action: 'updateSettings',
        isEnabled: currentState.isEnabled,
        targetMultiplier: currentState.targetMultiplier
      });
    }
  } catch (e) {
    // Content script may not be ready
  }
}

// Event listeners
document.addEventListener('DOMContentLoaded', () => {
  loadState();

  // Toggle button
  document.getElementById('toggle-btn').addEventListener('click', () => {
    currentState.isEnabled = !currentState.isEnabled;
    updateUI();
    saveAndSync();
  });

  // Slider
  const slider = document.getElementById('speed-slider');
  slider.addEventListener('input', (e) => {
    currentState.targetMultiplier = parseFloat(e.target.value);
    // Auto-enable if disabled
    if (!currentState.isEnabled) {
      currentState.isEnabled = true;
    }
    updateUI();
    saveAndSync();
  });
});

// Refresh every 2 seconds while popup is open
setInterval(loadState, 2000);
