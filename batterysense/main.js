const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage } = require('electron');
const path = require('path');
const Store = require('electron-store');
const systeminformation = require('systeminformation');
const notifier = require('node-notifier');

// Store for settings
const store = new Store();

// Global references
let mainWindow;
let tray;
let batteryCheckInterval;
let isQuitting = false;

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
    width: 900,
    height: 700,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    },
    icon: path.join(__dirname, 'assets/icons/icon.png')
  });

  mainWindow.loadFile('index.html');

   // Add the DevTools line here
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
  
  const contextMenu = Menu.buildFromTemplate([
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

  tray.setToolTip('BatterySense');
  tray.setContextMenu(contextMenu);
  
  tray.on('click', () => {
    mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show();
  });
}

// Get battery information using systeminformation
async function getBatteryInfo() {
  try {
    const batteryData = await systeminformation.battery();
    return batteryData;
  } catch (error) {
    console.error('Failed to get battery information:', error);
    return null;
  }
}

// Check battery status and send notifications if needed
async function checkBatteryStatus() {
  const settings = store.get('settings');
  if (!settings.notificationsEnabled) return;

  const batteryInfo = await getBatteryInfo();
  if (!batteryInfo) return;

  const batteryPercentage = batteryInfo.percent;
  const isCharging = batteryInfo.ischarging;

  // Store the data point for history
  const now = new Date().toISOString();
  const historyData = store.get('batteryHistory') || [];
  historyData.push({
    timestamp: now,
    percentage: batteryPercentage,
    isCharging
  });
  
  // Keep only recent history (last 7 days)
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const recentHistory = historyData.filter(
    item => new Date(item.timestamp) >= sevenDaysAgo
  );
  store.set('batteryHistory', recentHistory);

  // Send current data to UI
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('battery-updated', {
      current: batteryInfo,
      history: recentHistory
    });
  }

  // Overcharge notification
  if (isCharging && batteryPercentage >= settings.overchargeThreshold) {
    notifier.notify({
      title: 'BatterySense - Overcharging Alert',
      message: `Your battery is at ${batteryPercentage}%. To maximize battery health, consider unplugging your charger.`,
      icon: path.join(__dirname, 'assets/icons/notification-icon.png'),
      sound: true
    });
  }

  // Low battery notification
  if (!isCharging && batteryPercentage <= settings.lowBatteryThreshold) {
    notifier.notify({
      title: 'BatterySense - Low Battery Alert',
      message: `Your battery is at ${batteryPercentage}%. Connect your charger soon.`,
      icon: path.join(__dirname, 'assets/icons/notification-icon.png'),
      sound: true
    });
  }

  // Optimal charging suggestion
  if (settings.optimalChargeCycles.enabled) {
    if (isCharging && batteryPercentage >= settings.optimalChargeCycles.upperLimit) {
      notifier.notify({
        title: 'BatterySense - Optimal Charging',
        message: `Battery reached ${batteryPercentage}%. For optimal battery life, unplug your charger now.`,
        icon: path.join(__dirname, 'assets/icons/notification-icon.png')
      });
    } else if (!isCharging && batteryPercentage <= settings.optimalChargeCycles.lowerLimit) {
      notifier.notify({
        title: 'BatterySense - Optimal Charging',
        message: `Battery at ${batteryPercentage}%. For optimal battery life, it's a good time to charge now.`,
        icon: path.join(__dirname, 'assets/icons/notification-icon.png')
      });
    }
  }
}

// Set up battery monitoring interval
function startBatteryMonitoring() {
  const settings = store.get('settings');
  const intervalMinutes = settings.checkIntervalMinutes;
  
  // Clear existing interval if any
  if (batteryCheckInterval) {
    clearInterval(batteryCheckInterval);
  }
  
  // Check immediately once
  checkBatteryStatus();
  
  // Then set up the interval
  batteryCheckInterval = setInterval(() => {
    checkBatteryStatus();
  }, intervalMinutes * 60 * 1000);
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
    history: historyData
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
});