const Store = require('electron-store');
const { app } = require('electron');

// Create store instance
const store = new Store();

// Default settings
const DEFAULT_SETTINGS = {
  startAtLogin: true,
  minimizeToTray: true,
  notificationsEnabled: true,
  overchargeThreshold: 80, // Notify when charging above 80%
  lowBatteryThreshold: 20, // Notify when battery below 20%
  checkIntervalMinutes: 5, // Check battery every 5 minutes
  optimalChargeCycles: {
    enabled: true,
    lowerLimit: 20,
    upperLimit: 80
  }
};

// Initialize settings if not set
function initializeSettings() {
  if (!store.has('settings')) {
    store.set('settings', DEFAULT_SETTINGS);
  }
}

// Get all settings
function getSettings() {
  return store.get('settings') || DEFAULT_SETTINGS;
}

// Update settings
function updateSettings(newSettings) {
  // Merge with existing settings to ensure all fields exist
  const existingSettings = getSettings();
  const mergedSettings = {
    ...existingSettings,
    ...newSettings,
    optimalChargeCycles: {
      ...existingSettings.optimalChargeCycles,
      ...(newSettings.optimalChargeCycles || {})
    }
  };
  
  store.set('settings', mergedSettings);
  
  // Configure auto-start at login
  app.setLoginItemSettings({
    openAtLogin: mergedSettings.startAtLogin
  });
  
  return mergedSettings;
}

// Reset to default settings
function resetSettings() {
  store.set('settings', DEFAULT_SETTINGS);
  
  // Configure auto-start at login
  app.setLoginItemSettings({
    openAtLogin: DEFAULT_SETTINGS.startAtLogin
  });
  
  return DEFAULT_SETTINGS;
}

// Get a specific setting
function getSetting(key) {
  const settings = getSettings();
  const keys = key.split('.');
  
  let value = settings;
  for (const k of keys) {
    if (value && typeof value === 'object' && k in value) {
      value = value[k];
    } else {
      return undefined;
    }
  }
  
  return value;
}

// Update a specific setting
function updateSetting(key, value) {
  const settings = getSettings();
  const keys = key.split('.');
  
  // If it's a simple key, update directly
  if (keys.length === 1) {
    settings[key] = value;
  } else {
    // Handle nested keys
    let current = settings;
    for (let i = 0; i < keys.length - 1; i++) {
      const k = keys[i];
      if (!(k in current) || typeof current[k] !== 'object') {
        current[k] = {};
      }
      current = current[k];
    }
    current[keys[keys.length - 1]] = value;
  }
  
  store.set('settings', settings);
  
  // Special case for startAtLogin
  if (key === 'startAtLogin') {
    app.setLoginItemSettings({
      openAtLogin: value
    });
  }
  
  return settings;
}

// Export functions
module.exports = {
  initializeSettings,
  getSettings,
  updateSettings,
  resetSettings,
  getSetting,
  updateSetting
};