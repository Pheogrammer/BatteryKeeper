const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage } = require('electron');
const path = require('path');
const Store = require('electron-store');
const batteryMonitor = require('./batteryMonitor');
const notificationSystem = require('./notificationSystem');
const settingsManager = require('./settings');

// Store for settings
const store = new Store();

// Global references
let mainWindow;
let tray;
let batteryCheckInterval;
let historyInterval;
let isQuitting = false;
let lastBatteryState = {
  isCharging: null,
  percentage: null
};

// Initialize default settings if not set
function initializeSettings() {
  if (!store.has('settings')) {
    store.set('settings', {
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
    });
  }
}

// Create the main application window
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 950,
    height: 720,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    },
    icon: path.join(__dirname, 'assets/icons/icon.png'),
    show: false // Don't show until ready-to-show
  });

  mainWindow.loadFile('index.html');
  
  // Only show window when it's fully loaded to prevent flickering
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });
  
  // Open DevTools for debugging (comment out for production)
  mainWindow.webContents.openDevTools();

  // Handle window close event
  mainWindow.on('close', (event) => {
    if (!isQuitting && store.get('settings.minimizeToTray')) {
      event.preventDefault();
      mainWindow.hide();
      return false;
    }
    return true;
  });

  // Send settings to renderer
  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.send('settings-updated', store.get('settings'));
  });
}

// Create system tray icon
function createTray() {
  const iconPath = path.join(__dirname, 'assets/icons/tray-icon.png');
  tray = new Tray(nativeImage.createFromPath(iconPath));
  
  updateTrayMenu();
  
  tray.on('click', () => {
    mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show();
  });
}

// Update tray menu with current battery info
async function updateTrayMenu() {
  const batteryInfo = await getBatteryInfo();
  const isCharging = batteryInfo ? batteryInfo.ischarging : false;
  const percentage = batteryInfo ? Math.round(batteryInfo.percent) : 'Unknown';
  
  const menu = Menu.buildFromTemplate([
    { label: `Battery: ${percentage}%${isCharging ? ' (Charging)' : ''}`, enabled: false },
    { type: 'separator' },
    { label: 'Open BatterySense', click: () => mainWindow.show() },
    { type: 'separator' },
    { label: 'Start at Login', type: 'checkbox', checked: store.get('settings.startAtLogin'), click: (menuItem) => {
      store.set('settings.startAtLogin', menuItem.checked);
      app.setLoginItemSettings({ openAtLogin: menuItem.checked });
    }},
    { label: 'Minimize to Tray', type: 'checkbox', checked: store.get('settings.minimizeToTray'), click: (menuItem) => {
      store.set('settings.minimizeToTray', menuItem.checked);
    }},
    { type: 'separator' },
    { label: 'Quit', click: () => {
      isQuitting = true;
      app.quit();
    }}
  ]);
  
  tray.setContextMenu(menu);
  
  // Update tooltip with battery information
  if (batteryInfo) {
    const hasMult = batteryInfo.hasMult;
    let tooltipText = `BatterySense - ${percentage}%${isCharging ? ' (Charging)' : ''}`;
    
    if (hasMult) {
      tooltipText += `\nMultiple batteries (${batteryInfo.count})`;
      batteryInfo.batteries.forEach((bat, idx) => {
        tooltipText += `\nBattery ${idx + 1}: ${Math.round(bat.percent)}%${bat.ischarging ? ' (Charging)' : ''}`;
      });
    }
    
    tray.setToolTip(tooltipText);
  } else {
    tray.setToolTip('BatterySense');
  }
  
  // Update tray icon based on battery status (if needed in the future)
  // const iconName = `tray-icon${isCharging ? '-charging' : ''}.png`;
  // tray.setImage(nativeImage.createFromPath(path.join(__dirname, 'assets/icons', iconName)));
}

// Get battery information using batteryMonitor
async function getBatteryInfo() {
  try {
    return await batteryMonitor.getBatteryDetails();
  } catch (error) {
    console.error('Failed to get battery information:', error);
    return null;
  }
}

// Check battery status and send notifications if needed
async function checkBatteryStatus() {
  const settings = store.get('settings');

  const batteryInfo = await getBatteryInfo();
  if (!batteryInfo) return;

  // Check if significant change occurred to avoid redundant UI updates 
  const significantChange = isSignificantBatteryChange(batteryInfo, lastBatteryState);
  
  // Update tray menu with new battery info
  updateTrayMenu();
  
  // Store the updated state
  lastBatteryState = {
    isCharging: batteryInfo.ischarging,
    percentage: batteryInfo.percent
  };

  // Send current data to UI
  if (mainWindow && !mainWindow.isDestroyed()) {
    const historyData = store.get('batteryHistory') || [];
    mainWindow.webContents.send('battery-updated', {
      current: batteryInfo,
      history: historyData,
      significantChange
    });
  }

  // Check for notifications only if they're enabled
  if (settings.notificationsEnabled) {
    // Get battery analysis
    const historyData = store.get('batteryHistory') || [];
    const analysis = batteryMonitor.analyzeBatteryUsage(historyData);
    
    // Send notifications based on battery status
    notificationSystem.checkBatteryNotifications(batteryInfo, analysis);
  }
}

// Determine if a battery change is significant enough to update UI
function isSignificantBatteryChange(currentState, lastState) {
  if (!lastState.percentage) return true; // First check
  
  // Always report charging state changes
  if (currentState.ischarging !== lastState.isCharging) return true;
  
  // Report percentage changes that are >= 1%
  if (Math.abs(currentState.percent - lastState.percentage) >= 1) return true;
  
  return false;
}

// Save battery history data less frequently
async function saveBatteryHistoryData() {
  const batteryInfo = await getBatteryInfo();
  if (batteryInfo) {
    batteryMonitor.saveBatteryData(batteryInfo);
  }
}

// Set up battery monitoring interval
function startBatteryMonitoring() {
  const settings = store.get('settings');
  const realTimeIntervalSeconds = 5; // Check every 5 seconds for real-time updates
  
  // Clear existing intervals if any
  if (batteryCheckInterval) {
    clearInterval(batteryCheckInterval);
  }
  
  if (historyInterval) {
    clearInterval(historyInterval);
  }
  
  // Check immediately once
  checkBatteryStatus();
  saveBatteryHistoryData();
  
  // Set up the interval for real-time monitoring (UI updates)
  batteryCheckInterval = setInterval(() => {
    checkBatteryStatus();
  }, realTimeIntervalSeconds * 1000); // Convert to milliseconds
  
  // Set up a less frequent interval for saving historical data
  // to avoid creating too many data points
  historyInterval = setInterval(() => {
    saveBatteryHistoryData();
  }, settings.checkIntervalMinutes * 60 * 1000);
}

// IPC handler for settings updates
ipcMain.on('update-settings', (event, newSettings) => {
  store.set('settings', newSettings);
  app.setLoginItemSettings({ openAtLogin: newSettings.startAtLogin });
  
  // Restart monitoring with new settings
  startBatteryMonitoring();
  
  // Update renderer
  event.reply('settings-updated', newSettings);
});

// IPC handler for battery data request
ipcMain.on('request-battery-data', async (event) => {
  const batteryInfo = await getBatteryInfo();
  const historyData = store.get('batteryHistory') || [];
  
  event.reply('battery-updated', {
    current: batteryInfo,
    history: historyData,
    significantChange: true // Force full update on direct request
  });
});

// App initialization
app.whenReady().then(() => {
  initializeSettings();
  createWindow();
  createTray();
  
  // Configure auto-start at login
  app.setLoginItemSettings({
    openAtLogin: store.get('settings.startAtLogin')
  });
  
  // Start battery monitoring
  startBatteryMonitoring();
});

// Quit when all windows are closed, except on macOS
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// Cleanup on app quit
app.on('before-quit', () => {
  isQuitting = true;
  if (batteryCheckInterval) {
    clearInterval(batteryCheckInterval);
  }
  if (historyInterval) {
    clearInterval(historyInterval);
  }
});