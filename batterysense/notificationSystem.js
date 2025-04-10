const notifier = require('node-notifier');
const path = require('path');
const Store = require('electron-store');

// Store for notification settings and history
const store = new Store();

// Get notification settings
function getNotificationSettings() {
  const settings = store.get('settings') || {};
  return {
    enabled: settings.notificationsEnabled !== false, // Default to true if not set
    overchargeThreshold: settings.overchargeThreshold || 80,
    lowBatteryThreshold: settings.lowBatteryThreshold || 20,
    optimalChargingEnabled: settings.optimalChargeCycles?.enabled !== false, // Default to true
    optimalUpperLimit: settings.optimalChargeCycles?.upperLimit || 80,
    optimalLowerLimit: settings.optimalChargeCycles?.lowerLimit || 20
  };
}

// Send a notification
function sendNotification(title, message, type = 'info') {
  const settings = getNotificationSettings();
  if (!settings.enabled) return false;
  
  // Check if a similar notification was sent recently (within 15 minutes)
  const recentNotifications = store.get('recentNotifications') || [];
  const now = new Date();
  
  // Remove notifications older than 15 minutes
  const fifteenMinutesAgo = new Date(now.getTime() - 15 * 60 * 1000);
  const filteredNotifications = recentNotifications.filter(
    notification => new Date(notification.timestamp) >= fifteenMinutesAgo
  );
  
  // Check if a similar notification exists
  const similarNotificationExists = filteredNotifications.some(
    notification => notification.type === type && notification.title === title
  );
  
  if (similarNotificationExists) {
    return false; // Skip this notification to avoid spam
  }
  
  // Add to recent notifications
  filteredNotifications.push({
    type,
    title,
    timestamp: now.toISOString()
  });
  
  store.set('recentNotifications', filteredNotifications);
  
  // Determine icon based on notification type
  let iconPath;
  switch (type) {
    case 'warning':
      iconPath = path.join(__dirname, 'assets/icons/warning-icon.png');
      break;
    case 'critical':
      iconPath = path.join(__dirname, 'assets/icons/critical-icon.png');
      break;
    case 'success':
      iconPath = path.join(__dirname, 'assets/icons/success-icon.png');
      break;
    case 'info':
    default:
      iconPath = path.join(__dirname, 'assets/icons/notification-icon.png');
  }
  
  // Send the notification
  notifier.notify({
    title,
    message,
    icon: iconPath,
    sound: type === 'critical', // Only play sound for critical notifications
    timeout: 10, // Auto-close after 10 seconds
    actions: ['Dismiss', 'Open BatterySense']
  });
  
  return true;
}

// Check if notifications should be sent based on battery state
function checkBatteryNotifications(batteryData, batteryAnalysis) {
  if (!batteryData) return;
  
  const settings = getNotificationSettings();
  const percentage = batteryData.percent;
  const isCharging = batteryData.ischarging;
  
  // Handle multiple batteries case
  if (batteryData.hasMult) {
    // Check each individual battery for critical conditions
    batteryData.batteries.forEach((battery, index) => {
      // Critical low battery notification (per battery)
      if (!battery.ischarging && battery.percent <= 5) {
        sendNotification(
          'BatterySense - Critical Battery Level',
          `Battery ${index + 1} is critically low (${Math.round(battery.percent)}%)! Save your work and connect to power immediately.`,
          'critical'
        );
      }
      
      // Significant imbalance between batteries
      if (index === 0 && batteryData.batteries.length > 1) {
        const batteryLevels = batteryData.batteries.map(b => b.percent);
        const maxLevel = Math.max(...batteryLevels);
        const minLevel = Math.min(...batteryLevels);
        
        if (maxLevel - minLevel > 30) {
          // Only notify once a week
          const oneWeekAgo = new Date();
          oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
          
          const recentNotifications = store.get('recentNotifications') || [];
          const similarNotificationExists = recentNotifications.some(
            notification => 
              notification.type === 'battery-imbalance' && 
              new Date(notification.timestamp) >= oneWeekAgo
          );
          
          if (!similarNotificationExists) {
            sendNotification(
              'BatterySense - Battery Imbalance Detected',
              `Your batteries have a significant charge imbalance (${Math.round(minLevel)}% - ${Math.round(maxLevel)}%). Consider calibrating your batteries.`,
              'warning'
            );
            
            // Track this special notification type
            const now = new Date();
            recentNotifications.push({
              type: 'battery-imbalance',
              title: 'Battery Imbalance',
              timestamp: now.toISOString()
            });
            
            store.set('recentNotifications', recentNotifications);
          }
        }
      }
    });
  }
  
  // Overcharge notification
  if (isCharging && percentage >= settings.overchargeThreshold) {
    sendNotification(
      'BatterySense - Overcharging Alert',
      `Your battery is at ${Math.round(percentage)}%. To maximize battery health, consider unplugging your charger.`,
      'warning'
    );
  }
  
  // Low battery notification
  if (!isCharging && percentage <= settings.lowBatteryThreshold) {
    const severity = percentage <= 10 ? 'critical' : 'warning';
    sendNotification(
      'BatterySense - Low Battery Alert',
      `Your battery is at ${Math.round(percentage)}%. Connect your charger soon.`,
      severity
    );
  }
  
  // Critical low battery notification
  if (!isCharging && percentage <= 5) {
    sendNotification(
      'BatterySense - Critical Battery Level',
      'Your battery is critically low! Save your work and connect to power immediately.',
      'critical'
    );
  }
  
  // Optimal charging notifications
  if (settings.optimalChargingEnabled) {
    if (isCharging && percentage >= settings.optimalUpperLimit) {
      sendNotification(
        'BatterySense - Optimal Charging',
        `Battery reached ${Math.round(percentage)}%. For optimal battery life, unplug your charger now.`,
        'info'
      );
    } else if (!isCharging && percentage <= settings.optimalLowerLimit) {
      sendNotification(
        'BatterySense - Optimal Charging',
        `Battery at ${Math.round(percentage)}%. For optimal battery life, it's a good time to charge now.`,
        'info'
      );
    }
  }
  
  // Battery health notifications
  if (batteryData.maxcapacity && batteryData.designcapacity) {
    const healthPercentage = Math.round((batteryData.maxcapacity / batteryData.designcapacity) * 100);
    
    if (healthPercentage < 50) {
      // Only send this notification if it wasn't sent in the last 24 hours
      const twentyFourHoursAgo = new Date(new Date().getTime() - 24 * 60 * 60 * 1000);
      const recentNotifications = store.get('recentNotifications') || [];
      const similarNotificationExists = recentNotifications.some(
        notification => 
          notification.type === 'health-warning' && 
          new Date(notification.timestamp) >= twentyFourHoursAgo
      );
      
      if (!similarNotificationExists) {
        sendNotification(
          'BatterySense - Battery Health Warning',
          `Your battery health is at ${healthPercentage}%. Consider battery replacement soon.`,
          'warning'
        );
        
        // Add a special notification type to track this
        const now = new Date();
        recentNotifications.push({
          type: 'health-warning',
          title: 'Battery Health Warning',
          timestamp: now.toISOString()
        });
        
        store.set('recentNotifications', recentNotifications);
      }
    }
  }
  
  // Usage pattern notifications
  if (batteryAnalysis && batteryAnalysis.recommendations) {
    for (const recommendation of batteryAnalysis.recommendations) {
      // Only send each type of recommendation once every 3 days
      const threeDaysAgo = new Date(new Date().getTime() - 3 * 24 * 60 * 60 * 1000);
      const recentNotifications = store.get('recentNotifications') || [];
      const similarNotificationExists = recentNotifications.some(
        notification => 
          notification.type === `usage-${recommendation.type}` && 
          new Date(notification.timestamp) >= threeDaysAgo
      );
      
      if (!similarNotificationExists) {
        sendNotification(
          'BatterySense - Battery Usage Tip',
          recommendation.message,
          'info'
        );
        
        // Add a special notification type to track this
        const now = new Date();
        recentNotifications.push({
          type: `usage-${recommendation.type}`,
          title: 'Battery Usage Tip',
          timestamp: now.toISOString()
        });
        
        store.set('recentNotifications', recentNotifications);
      }
    }
  }
  
  // Charging/discharging state changes
  const lastBatteryState = store.get('lastBatteryState');
  if (lastBatteryState) {
    if (lastBatteryState.isCharging !== isCharging) {
      // Notify of state change
      if (isCharging) {
        sendNotification(
          'BatterySense - Charging Started',
          `Your laptop is now charging. Current battery level: ${Math.round(percentage)}%.`,
          'info'
        );
      } else {
        sendNotification(
          'BatterySense - On Battery Power',
          `Your laptop is now running on battery power. Current battery level: ${Math.round(percentage)}%.`,
          'info'
        );
      }
    }
  }
  
  // Store current state for future comparison
  store.set('lastBatteryState', {
    isCharging: isCharging,
    percentage: percentage
  });
}

// Clear notification history
function clearNotificationHistory() {
  store.set('recentNotifications', []);
}

module.exports = {
  sendNotification,
  checkBatteryNotifications,
  clearNotificationHistory,
  getNotificationSettings
};