const systeminformation = require('systeminformation');
const Store = require('electron-store');
const path = require('path');

// Store for battery data
const store = new Store();

// Battery health calculation based on cycles and capacity
function calculateBatteryHealth(batteryData) {
  if (!batteryData) return null;
  
  let healthScore = 100;
  
  // Factor 1: Current capacity vs design capacity
  if (batteryData.maxcapacity && batteryData.designcapacity) {
    const capacityRatio = batteryData.maxcapacity / batteryData.designcapacity;
    healthScore *= capacityRatio;
  }
  
  // Factor 2: Cycle count
  if (batteryData.cyclecount) {
    // Most batteries are rated for 500-1000 cycles
    // Start deducting points after 300 cycles
    if (batteryData.cyclecount > 300) {
      const cycleImpact = Math.min(0.5, (batteryData.cyclecount - 300) / 1000);
      healthScore *= (1 - cycleImpact);
    }
  }
  
  return Math.round(healthScore);
}

// Get detailed battery information
async function getBatteryDetails() {
  try {
    const batteryData = await systeminformation.battery();
    
    // Add health score calculation
    batteryData.healthScore = calculateBatteryHealth(batteryData);
    
    return batteryData;
  } catch (error) {
    console.error('Failed to get battery information:', error);
    return null;
  }
}

// Analyze battery usage patterns
function analyzeBatteryUsage(historyData) {
  if (!historyData || historyData.length < 5) {
    return {
      averageDrainRate: null,
      estimatedLifeHours: null,
      chargingFrequency: null,
      recommendations: []
    };
  }
  
  // Calculate average drain rate
  let totalDrain = 0;
  let drainCount = 0;
  let chargingEvents = 0;
  let deepDischargeEvents = 0;
  let overchargeEvents = 0;
  
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
    
    // Calculate drain rate
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
  
  const averageDrainRate = drainCount > 0 ? totalDrain / drainCount : null;
  const estimatedLifeHours = averageDrainRate ? 100 / averageDrainRate : null;
  const chargingFrequency = {
    total: chargingEvents,
    deepDischarge: deepDischargeEvents,
    overcharge: overchargeEvents
  };
  
  // Generate recommendations
  const recommendations = [];
  
  if (averageDrainRate > 15) {
    recommendations.push({
      type: 'high-drain',
      message: 'Your battery is draining quickly. Consider reducing screen brightness and closing unnecessary applications.'
    });
  }
  
  if (deepDischargeEvents > chargingEvents * 0.3) {
    recommendations.push({
      type: 'deep-discharge',
      message: 'You frequently let your battery discharge below 20%. This can reduce battery lifespan.'
    });
  }
  
  if (overchargeEvents > 5) {
    recommendations.push({
      type: 'overcharge',
      message: 'You often keep your laptop plugged in at high charge levels. Consider unplugging once your battery reaches 80%.'
    });
  }
  
  return {
    averageDrainRate,
    estimatedLifeHours,
    chargingFrequency,
    recommendations
  };
}

// Calculate battery wear level
function calculateBatteryWear(batteryData) {
  if (!batteryData || !batteryData.maxcapacity || !batteryData.designcapacity) {
    return null;
  }
  
  const wearPercentage = 100 - Math.round((batteryData.maxcapacity / batteryData.designcapacity) * 100);
  return wearPercentage;
}

// Get estimated remaining battery life
function getEstimatedTimeRemaining(batteryData, batteryAnalysis) {
  if (!batteryData || batteryData.ischarging || !batteryAnalysis || !batteryAnalysis.averageDrainRate) {
    return null;
  }
  
  const currentPercentage = batteryData.percent;
  return currentPercentage / batteryAnalysis.averageDrainRate;
}

// Predict optimal charge time
function predictOptimalChargeTime(batteryData, settings) {
  if (!batteryData || !settings) {
    return null;
  }
  
  const currentPercentage = batteryData.percent;
  const optimalThreshold = settings.optimalChargeCycles.lowerLimit;
  
  if (currentPercentage > optimalThreshold || batteryData.ischarging) {
    return null;
  }
  
  // Rough estimate based on average drain rate
  const historicalData = store.get('batteryHistory') || [];
  const analysis = analyzeBatteryUsage(historicalData);
  
  if (!analysis.averageDrainRate) {
    return null;
  }
  
  // How many hours until the battery reaches the optimal lower threshold
  const hoursUntilThreshold = (currentPercentage - optimalThreshold) / analysis.averageDrainRate;
  
  if (hoursUntilThreshold <= 0) {
    return 'now';
  }
  
  // Convert to minutes for more precise notification
  const minutesUntilThreshold = Math.round(hoursUntilThreshold * 60);
  
  if (minutesUntilThreshold < 60) {
    return `${minutesUntilThreshold} minutes`;
  } else {
    const hours = Math.floor(hoursUntilThreshold);
    const minutes = Math.round((hoursUntilThreshold - hours) * 60);
    return `${hours} hour${hours > 1 ? 's' : ''} ${minutes > 0 ? `and ${minutes} minutes` : ''}`;
  }
}

// Save battery history data
function saveBatteryData(batteryData) {
  if (!batteryData) return;
  
  const now = new Date().toISOString();
  const historyData = store.get('batteryHistory') || [];
  
  historyData.push({
    timestamp: now,
    percentage: batteryData.percent,
    isCharging: batteryData.ischarging,
    capacity: batteryData.maxcapacity,
    cycleCount: batteryData.cyclecount
  });
  
  // Keep only recent history (last 7 days)
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const recentHistory = historyData.filter(
    item => new Date(item.timestamp) >= sevenDaysAgo
  );
  
  store.set('batteryHistory', recentHistory);
  
  return recentHistory;
}

module.exports = {
  getBatteryDetails,
  analyzeBatteryUsage,
  calculateBatteryHealth,
  calculateBatteryWear,
  getEstimatedTimeRemaining,
  predictOptimalChargeTime,
  saveBatteryData
};