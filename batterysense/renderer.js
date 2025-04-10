const { ipcRenderer } = require('electron');
const Chart = require('chart.js/auto');

// DOM Elements
const tabButtons = document.querySelectorAll('.tab-btn');
const tabContents = document.querySelectorAll('.tab-content');

// Battery Status Elements
const batteryLevelEl = document.getElementById('battery-level');
const batteryPercentageEl = document.getElementById('battery-percentage');
const chargingStatusEl = document.getElementById('charging-status');
const batteryHealthEl = document.getElementById('battery-health');
const timeRemainingEl = document.getElementById('time-remaining');
const recommendationContentEl = document.getElementById('recommendation-content');
const chargeCyclesEl = document.getElementById('charge-cycles');
const designCapacityEl = document.getElementById('design-capacity');
const currentCapacityEl = document.getElementById('current-capacity');
const multiBatteryIndicatorEl = document.getElementById('multi-battery-indicator');
const batteryDetailsContainerEl = document.getElementById('battery-details-container');

// Settings Elements
const startAtLoginEl = document.getElementById('start-at-login');
const minimizeToTrayEl = document.getElementById('minimize-to-tray');
const notificationsEnabledEl = document.getElementById('notifications-enabled');
const overchargeThresholdEl = document.getElementById('overcharge-threshold');
const overchargeThresholdValueEl = document.getElementById('overcharge-threshold-value');
const lowBatteryThresholdEl = document.getElementById('low-battery-threshold');
const lowBatteryThresholdValueEl = document.getElementById('low-battery-threshold-value');
const optimalChargingEnabledEl = document.getElementById('optimal-charging-enabled');
const lowerLimitEl = document.getElementById('lower-limit');
const lowerLimitValueEl = document.getElementById('lower-limit-value');
const upperLimitEl = document.getElementById('upper-limit');
const upperLimitValueEl = document.getElementById('upper-limit-value');
const checkIntervalEl = document.getElementById('check-interval');
const saveSettingsBtn = document.getElementById('save-settings');

// Charts
let batteryChart = null;
let usageChart = null;

// Track the last battery state to detect changes
let lastBatteryState = {
  percentage: 0,
  isCharging: false
};

// Tab switching
tabButtons.forEach(button => {
  button.addEventListener('click', () => {
    // Remove active class from all buttons and contents
    tabButtons.forEach(btn => btn.classList.remove('active'));
    tabContents.forEach(content => content.classList.remove('active'));
    
    // Add active class to clicked button and corresponding content
    button.classList.add('active');
    const tabId = button.getAttribute('data-tab');
    document.getElementById(tabId).classList.add('active');
    
    // Request updated data when switching to a tab
    ipcRenderer.send('request-battery-data');
  });
});

// Initialize battery chart
function initBatteryChart(historyData) {
  const ctx = document.getElementById('battery-chart').getContext('2d');
  
  if (batteryChart) {
    batteryChart.destroy();
  }
  
  // Process data for chart
  const labels = [];
  const percentages = [];
  
  historyData.forEach(item => {
    const date = new Date(item.timestamp);
    labels.push(date.toLocaleString());
    percentages.push(item.percentage);
  });
  
  batteryChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [{
        label: 'Battery Percentage',
        data: percentages,
        borderColor: '#4caf50',
        backgroundColor: 'rgba(76, 175, 80, 0.1)',
        tension: 0.3,
        fill: true
      }]
    },
    options: {
      responsive: true,
      plugins: {
        title: {
          display: true,
          text: 'Battery Percentage Over Time'
        },
        tooltip: {
          mode: 'index',
          intersect: false
        }
      },
      scales: {
        y: {
          min: 0,
          max: 100,
          title: {
            display: true,
            text: 'Percentage (%)'
          }
        },
        x: {
          title: {
            display: true,
            text: 'Time'
          }
        }
      }
    }
  });
}

// Initialize usage chart
function initUsageChart(historyData) {
  const ctx = document.getElementById('usage-chart').getContext('2d');
  
  if (usageChart) {
    usageChart.destroy();
  }
  
  // Process data for chart - calculate average battery drain per hour
  const drainRates = [];
  const labels = [];
  
  // Need at least 2 data points to calculate drain rate
  if (historyData.length >= 2) {
    for (let i = 1; i < historyData.length; i++) {
      const prev = historyData[i - 1];
      const current = historyData[i];
      
      // Skip entries where the battery was charging
      if (!prev.isCharging && !current.isCharging) {
        const prevTime = new Date(prev.timestamp);
        const currTime = new Date(current.timestamp);
        const hoursDiff = (currTime - prevTime) / (1000 * 60 * 60);
        
        // Only calculate if time difference is meaningful
        if (hoursDiff > 0.01) {  // More than 36 seconds
          const percentDiff = prev.percentage - current.percentage;
          const hourlyDrain = percentDiff / hoursDiff;
          
          if (hourlyDrain > 0) {  // Only include positive drain rates
            drainRates.push(hourlyDrain);
            labels.push(currTime.toLocaleString());
          }
        }
      }
    }
  }
  
  usageChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [{
        label: 'Battery Drain Rate (%/hour)',
        data: drainRates,
        backgroundColor: 'rgba(33, 150, 243, 0.7)'
      }]
    },
    options: {
      responsive: true,
      plugins: {
        title: {
          display: true,
          text: 'Battery Drain Rate Over Time'
        }
      },
      scales: {
        y: {
          title: {
            display: true,
            text: 'Drain Rate (%/hour)'
          }
        }
      }
    }
  });
}

// Animate battery level changes
function animateBatteryLevel(from, to) {
  const duration = 500; // 500ms animation
  const start = performance.now();
  
  function step(timestamp) {
    const elapsed = timestamp - start;
    const progress = Math.min(elapsed / duration, 1);
    const currentValue = from + (to - from) * progress;
    
    batteryLevelEl.style.width = `${currentValue}%`;
    
    if (progress < 1) {
      window.requestAnimationFrame(step);
    }
  }
  
  window.requestAnimationFrame(step);
}

// Update battery UI with data
function updateBatteryUI(batteryInfo) {
  if (!batteryInfo) return;
  
  // Update battery level with animation
  const percentage = batteryInfo.percent;
  const currentWidth = parseFloat(batteryLevelEl.style.width || '0');
  
  // Only animate if there's a significant change (>0.5%)
  if (Math.abs(currentWidth - percentage) > 0.5) {
    animateBatteryLevel(currentWidth, percentage);
  } else {
    batteryLevelEl.style.width = `${percentage}%`;
  }
  
  batteryPercentageEl.textContent = `${Math.round(percentage)}%`;
  
  // Update charging status with visual indicator
  const isCharging = batteryInfo.ischarging;
  
  // Check if charging state changed to add visual feedback
  if (isCharging !== lastBatteryState.isCharging) {
    chargingStatusEl.classList.add('status-changed');
    setTimeout(() => {
      chargingStatusEl.classList.remove('status-changed');
    }, 2000);
  }
  
  if (isCharging) {
    chargingStatusEl.textContent = 'Charging';
    chargingStatusEl.classList.add('charging');
  } else {
    chargingStatusEl.textContent = 'Discharging';
    chargingStatusEl.classList.remove('charging');
  }
  
  // Update battery health if available
  if (batteryInfo.maxcapacity && batteryInfo.designcapacity) {
    const healthPercentage = Math.round((batteryInfo.maxcapacity / batteryInfo.designcapacity) * 100);
    batteryHealthEl.textContent = `${healthPercentage}%`;
  } else {
    batteryHealthEl.textContent = 'Unknown';
  }
  
  // Update time remaining
  if (!isCharging && batteryInfo.timeremaining) {
    const hours = Math.floor(batteryInfo.timeremaining / 60);
    const minutes = batteryInfo.timeremaining % 60;
    timeRemainingEl.textContent = `${hours}h ${minutes}m`;
  } else if (isCharging) {
    timeRemainingEl.textContent = 'Charging';
  } else {
    timeRemainingEl.textContent = 'Unknown';
  }
  
  // Update charge cycles and capacity if available
  if (batteryInfo.cyclecount) {
    chargeCyclesEl.textContent = batteryInfo.cyclecount;
  }
  
  if (batteryInfo.designcapacity) {
    designCapacityEl.textContent = `${batteryInfo.designcapacity} mWh`;
  }
  
  if (batteryInfo.maxcapacity) {
    currentCapacityEl.textContent = `${batteryInfo.maxcapacity} mWh`;
  }
  
  // Handle multiple batteries if present
  if (batteryInfo.hasMult) {
    updateMultiBatteryDisplay(batteryInfo);
    multiBatteryIndicatorEl.style.display = 'block';
  } else {
    multiBatteryIndicatorEl.style.display = 'none';
  }
  
  // Update recommendations based on battery status
  updateRecommendations(batteryInfo);
  
  // Save the current state for comparison with next update
  lastBatteryState.percentage = percentage;
  lastBatteryState.isCharging = isCharging;
}

// Display multiple batteries information
function updateMultiBatteryDisplay(batteryInfo) {
  // Clear previous content
  batteryDetailsContainerEl.innerHTML = '';
  
  // Add individual battery cards
  batteryInfo.batteries.forEach((battery, index) => {
    const batteryCard = document.createElement('div');
    batteryCard.className = 'individual-battery';
    
    const batteryHeader = document.createElement('div');
    batteryHeader.className = 'individual-battery-header';
    batteryHeader.innerHTML = `
      <span>Battery ${index + 1}</span>
      <span>${Math.round(battery.percent)}%</span>
    `;
    
    const batteryBar = document.createElement('div');
    batteryBar.className = 'individual-battery-bar';
    
    const batteryLevel = document.createElement('div');
    batteryLevel.className = 'individual-battery-level';
    batteryLevel.style.width = `${battery.percent}%`;
    batteryLevel.style.backgroundColor = battery.ischarging ? 
      'var(--charging-color)' : 'var(--primary-color)';
    
    batteryBar.appendChild(batteryLevel);
    
    const batteryStatus = document.createElement('div');
    batteryStatus.className = 'individual-battery-status';
    
    // Add charging information
    const statusText = document.createElement('span');
    statusText.innerHTML = battery.ischarging ? 
      '<span class="individual-battery-charging">⚡ Charging</span>' : 
      'Discharging';
    
    // Add capacity information if available
    const capacityText = document.createElement('span');
    if (battery.maxcapacity && battery.designcapacity) {
      const healthPercentage = Math.round((battery.maxcapacity / battery.designcapacity) * 100);
      capacityText.textContent = `Health: ${healthPercentage}%`;
    } else {
      capacityText.textContent = '';
    }
    
    batteryStatus.appendChild(statusText);
    batteryStatus.appendChild(capacityText);
    
    // Assemble the card
    batteryCard.appendChild(batteryHeader);
    batteryCard.appendChild(batteryBar);
    batteryCard.appendChild(batteryStatus);
    
    // Add to container
    batteryDetailsContainerEl.appendChild(batteryCard);
  });
}

// Generate recommendations based on battery data
function updateRecommendations(batteryInfo) {
  const recommendations = [];
  
  if (!batteryInfo) {
    recommendationContentEl.innerHTML = '<p class="tip">No recommendations available yet. Keep BatterySense running to get personalized battery advice.</p>';
    return;
  }
  
  const percentage = batteryInfo.percent;
  const isCharging = batteryInfo.ischarging;
  
  // Battery level recommendations
  if (isCharging && percentage >= 80) {
    recommendations.push(`
      <div class="tip">
        <h3>🔌 Consider unplugging your charger</h3>
        <p>Your battery is at ${Math.round(percentage)}%. For optimal battery health, it's best to unplug at 80%.</p>
      </div>
    `);
  } else if (!isCharging && percentage <= 20) {
    recommendations.push(`
      <div class="tip">
        <h3>🔋 Time to charge</h3>
        <p>Your battery is at ${Math.round(percentage)}%. To prevent deep discharge, consider plugging in soon.</p>
      </div>
    `);
  }
  
  // Battery health recommendations
  if (batteryInfo.maxcapacity && batteryInfo.designcapacity) {
    const healthPercentage = Math.round((batteryInfo.maxcapacity / batteryInfo.designcapacity) * 100);
    
    if (healthPercentage < 70) {
      recommendations.push(`
        <div class="tip">
          <h3>⚠️ Battery health declining</h3>
          <p>Your battery health is at ${healthPercentage}%. Consider battery replacement if you notice reduced performance.</p>
        </div>
      `);
    }
  }
  
  // Multiple battery recommendations
  if (batteryInfo.hasMult) {
    // Check if batteries are unbalanced (>20% difference between any two batteries)
    const percentages = batteryInfo.batteries.map(bat => bat.percent);
    const maxPercentage = Math.max(...percentages);
    const minPercentage = Math.min(...percentages);
    
    if (maxPercentage - minPercentage > 20) {
      recommendations.push(`
        <div class="tip">
          <h3>⚖️ Unbalanced batteries detected</h3>
          <p>Your battery levels vary significantly (${Math.round(minPercentage)}% - ${Math.round(maxPercentage)}%). 
          Consider running a battery calibration by fully discharging and recharging once.</p>
        </div>
      `);
    }
  }
  
  // Add general tip for optimal battery usage if no other recommendations
  if (recommendations.length === 0) {
    recommendations.push(`
      <div class="tip">
        <h3>💡 Battery Tip</h3>
        <p>Keep your battery between 20% and 80% for optimal longevity. Avoid extreme temperatures.</p>
      </div>
    `);
  }
  
  // Update the recommendations content
  recommendationContentEl.innerHTML = recommendations.join('');
}

// Update usage analysis
function updateUsageAnalysis(historyData) {
  if (!historyData || historyData.length < 5) {
    document.getElementById('usage-analysis').innerHTML = 
      '<p>Keep BatterySense running to gather more data for personalized insights.</p>';
    return;
  }
  
  // Calculate average drain rate
  let totalDrain = 0;
  let drainCount = 0;
  
  for (let i = 1; i < historyData.length; i++) {
    const prev = historyData[i - 1];
    const current = historyData[i];
    
    if (!prev.isCharging && !current.isCharging) {
      const prevTime = new Date(prev.timestamp);
      const currTime = new Date(current.timestamp);
      const hoursDiff = (currTime - prevTime) / (1000 * 60 * 60);
      
      if (hoursDiff > 0.01) {
        const percentDiff = prev.percentage - current.percentage;
        const hourlyDrain = percentDiff / hoursDiff;
        
        if (hourlyDrain > 0) {
          totalDrain += hourlyDrain;
          drainCount++;
        }
      }
    }
  }
  
  const avgDrainRate = drainCount > 0 ? (totalDrain / drainCount).toFixed(1) : 0;
  const estimatedLifeHours = avgDrainRate > 0 ? (100 / avgDrainRate).toFixed(1) : 0;
  
  let analysisHTML = `
    <h3>Battery Usage Analysis</h3>
    <p>Average battery drain: <strong>${avgDrainRate}% per hour</strong></p>
    <p>Estimated battery life: <strong>${estimatedLifeHours} hours</strong> (from 100% to 0%)</p>
  `;
  
  // Add recommendations based on drain rate
  if (avgDrainRate > 15) {
    analysisHTML += `
      <div class="tip">
        <p>Your battery drain rate is relatively high. Consider:</p>
        <ul>
          <li>Reducing screen brightness</li>
          <li>Closing unused applications</li>
          <li>Checking for resource-intensive background processes</li>
        </ul>
      </div>
    `;
  }
  
  document.getElementById('usage-analysis').innerHTML = analysisHTML;
}

// Update charging habits analysis
function updateChargingAnalysis(historyData) {
  if (!historyData || historyData.length < 5) {
    document.getElementById('charging-analysis').innerHTML = 
      '<p>BatterySense is learning your charging habits. More insights will appear soon.</p>';
    return;
  }
  
  // Analyze charging patterns
  let chargingEvents = 0;
  let overchargeEvents = 0;
  let deepDischargeEvents = 0;
  
  for (let i = 1; i < historyData.length; i++) {
    const prev = historyData[i - 1];
    const current = historyData[i];
    
    // Count charging events
    if (!prev.isCharging && current.isCharging) {
      chargingEvents++;
      
      // Check if it was a deep discharge (below 20%)
      if (prev.percentage < 20) {
        deepDischargeEvents++;
      }
    }
    
    // Check for overcharging (kept above 90% while charging)
    if (current.isCharging && current.percentage > 90 && prev.isCharging && prev.percentage > 90) {
      overchargeEvents++;
    }
  }
  
  // Calculate percentages
  const deepDischargePercentage = chargingEvents > 0 ? 
    Math.round((deepDischargeEvents / chargingEvents) * 100) : 0;
  
  let analysisHTML = `
    <h3>Charging Habits Analysis</h3>
    <p>Charging sessions detected: <strong>${chargingEvents}</strong></p>
    <p>Deep discharge events: <strong>${deepDischargeEvents}</strong> (${deepDischargePercentage}% of charges)</p>
  `;
  
  // Add recommendations
  if (deepDischargePercentage > 30) {
    analysisHTML += `
      <div class="tip">
        <p>You frequently let your battery discharge below 20%. This can reduce battery lifespan.</p>
        <p>Try to charge your battery before it drops below 20%.</p>
      </div>
    `;
  }
  
  if (overchargeEvents > 5) {
    analysisHTML += `
      <div class="tip">
        <p>You often keep your laptop plugged in at high charge levels for extended periods.</p>
        <p>Consider unplugging once your battery reaches 80% to extend battery lifespan.</p>
      </div>
    `;
  }
  
  document.getElementById('charging-analysis').innerHTML = analysisHTML;
}

// Update battery health report
function updateHealthReport(batteryInfo, historyData) {
  if (!batteryInfo || !historyData || historyData.length < 5) {
    document.getElementById('health-report').innerHTML = 
      '<p>Collecting data to generate your battery health report...</p>';
    return;
  }
  
  let healthScore = 100;
  let reportHTML = '<h3>Battery Health Report</h3>';
  
  // Factor 1: Current capacity vs design capacity
  if (batteryInfo.maxcapacity && batteryInfo.designcapacity) {
    const healthPercentage = Math.round((batteryInfo.maxcapacity / batteryInfo.designcapacity) * 100);
    reportHTML += `<p>Current capacity: <strong>${healthPercentage}% of original</strong></p>`;
    
    // Reduce health score based on capacity loss
    healthScore -= (100 - healthPercentage) * 0.5;
  }
  
  // Factor 2: Charge cycles
  if (batteryInfo.cyclecount) {
    reportHTML += `<p>Charge cycles: <strong>${batteryInfo.cyclecount}</strong></p>`;
    
    // Most batteries are rated for 300-500 cycles
    const estimatedLifePercentage = Math.max(0, 100 - (batteryInfo.cyclecount / 5));
    healthScore -= (100 - estimatedLifePercentage) * 0.2;
  }
  
  // Factor 3: Charging habits (from analysis)
  let chargingEvents = 0;
  let overchargeEvents = 0;
  let deepDischargeEvents = 0;
  
  for (let i = 1; i < historyData.length; i++) {
    const prev = historyData[i - 1];
    const current = historyData[i];
    
    if (!prev.isCharging && current.isCharging) {
      chargingEvents++;
      if (prev.percentage < 20) {
        deepDischargeEvents++;
      }
    }
    
    if (current.isCharging && current.percentage > 90 && prev.isCharging && prev.percentage > 90) {
      overchargeEvents++;
    }
  }
  
  const badHabitsScore = Math.max(0, 100 - 
    (deepDischargeEvents * 5) - (overchargeEvents * 2));
  
  healthScore -= (100 - badHabitsScore) * 0.3;
  
  // Ensure health score is between 0 and 100
  healthScore = Math.max(0, Math.min(100, Math.round(healthScore)));
  
  // Generate visual health meter
  reportHTML += `
    <div class="health-meter">
      <div class="health-bar" style="width: ${healthScore}%; 
        background-color: ${healthScore > 70 ? '#4caf50' : healthScore > 40 ? '#ff9800' : '#f44336'};">
        ${healthScore}%
      </div>
    </div>
  `;
  
  // Add recommendations based on health score
  if (healthScore < 50) {
    reportHTML += `
      <div class="tip">
        <p>Your battery health is declining. Consider:</p>
        <ul>
          <li>Replacing your battery soon</li>
          <li>Using your laptop plugged in when possible</li>
          <li>Backing up your data regularly</li>
        </ul>
      </div>
    `;
  } else if (healthScore < 80) {
    reportHTML += `
      <div class="tip">
        <p>Your battery is showing signs of wear. To slow the decline:</p>
        <ul>
          <li>Keep battery between 20-80% charge</li>
          <li>Avoid exposing your laptop to high temperatures</li>
          <li>Consider using battery saver mode when mobile</li>
        </ul>
      </div>
    `;
  } else {
    reportHTML += `
      <div class="tip">
        <p>Your battery is in good health! Keep up the good habits.</p>
      </div>
    `;
  }
  
  document.getElementById('health-report').innerHTML = reportHTML;
}

// Update settings UI with stored values
function updateSettingsUI(settings) {
  startAtLoginEl.checked = settings.startAtLogin;
  minimizeToTrayEl.checked = settings.minimizeToTray;
  notificationsEnabledEl.checked = settings.notificationsEnabled;
  
  overchargeThresholdEl.value = settings.overchargeThreshold;
  overchargeThresholdValueEl.textContent = `${settings.overchargeThreshold}%`;
  
  lowBatteryThresholdEl.value = settings.lowBatteryThreshold;
  lowBatteryThresholdValueEl.textContent = `${settings.lowBatteryThreshold}%`;
  
  optimalChargingEnabledEl.checked = settings.optimalChargeCycles.enabled;
  lowerLimitEl.value = settings.optimalChargeCycles.lowerLimit;
  lowerLimitValueEl.textContent = `${settings.optimalChargeCycles.lowerLimit}%`;
  
  upperLimitEl.value = settings.optimalChargeCycles.upperLimit;
  upperLimitValueEl.textContent = `${settings.optimalChargeCycles.upperLimit}%`;
  
  checkIntervalEl.value = settings.checkIntervalMinutes;
}

// Update sliders text as they change
overchargeThresholdEl.addEventListener('input', () => {
  overchargeThresholdValueEl.textContent = `${overchargeThresholdEl.value}%`;
});

lowBatteryThresholdEl.addEventListener('input', () => {
  lowBatteryThresholdValueEl.textContent = `${lowBatteryThresholdEl.value}%`;
});

lowerLimitEl.addEventListener('input', () => {
  lowerLimitValueEl.textContent = `${lowerLimitEl.value}%`;
});

upperLimitEl.addEventListener('input', () => {
  upperLimitValueEl.textContent = `${upperLimitEl.value}%`;
});

// Save settings button click handler
saveSettingsBtn.addEventListener('click', () => {
  const newSettings = {
    startAtLogin: startAtLoginEl.checked,
    minimizeToTray: minimizeToTrayEl.checked,
    notificationsEnabled: notificationsEnabledEl.checked,
    overchargeThreshold: parseInt(overchargeThresholdEl.value),
    lowBatteryThreshold: parseInt(lowBatteryThresholdEl.value),
    checkIntervalMinutes: parseInt(checkIntervalEl.value),
    optimalChargeCycles: {
      enabled: optimalChargingEnabledEl.checked,
      lowerLimit: parseInt(lowerLimitEl.value),
      upperLimit: parseInt(upperLimitEl.value)
    }
  };
  
  ipcRenderer.send('update-settings', newSettings);
  
  // Show a success message
  const messageEl = document.createElement('div');
  messageEl.className = 'save-message';
  messageEl.textContent = 'Settings saved successfully!';
  saveSettingsBtn.parentNode.appendChild(messageEl);
  
  setTimeout(() => {
    messageEl.remove();
  }, 3000);
});

// Selective chart updates based on visible tab
function updateVisibleCharts(history) {
  if (!history || history.length === 0) return;
  
  // Get active tab
  const activeTab = document.querySelector('.tab-content.active').id;
  
  if (activeTab === 'dashboard') {
    initBatteryChart(history);
  } else if (activeTab === 'insights') {
    initUsageChart(history);
    updateUsageAnalysis(history);
    updateChargingAnalysis(history);
  }
}

// Battery data update handler
ipcRenderer.on('battery-updated', (event, data) => {
  const { current, history } = data;
  
  // Update battery status UI
  updateBatteryUI(current);
  
  // Update charts and analysis based on active tab
  if (history && history.length > 0) {
    updateVisibleCharts(history);
    updateHealthReport(current, history);
  }
});

// Settings update handler
ipcRenderer.on('settings-updated', (event, settings) => {
  updateSettingsUI(settings);
});

// Initial data request
ipcRenderer.send('request-battery-data');

// Add CSS for status change animations
const style = document.createElement('style');
style.textContent = `
  .status-changed {
    animation: flash 1s;
  }
  
  @keyframes flash {
    0% { background-color: rgba(76, 175, 80, 0.3); }
    100% { background-color: transparent; }
  }
`;
document.head.appendChild(style);