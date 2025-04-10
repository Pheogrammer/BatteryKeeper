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
    // Get all battery information
    const batteryData = await systeminformation.battery();
    
    // Check if there are multiple batteries
    if (Array.isArray(batteryData) && batteryData.length > 1) {
      // Create an aggregate battery object
      const aggregateBattery = {
        hasMult: true,
        count: batteryData.length,
        batteries: batteryData.map(bat => {
          // Add health score to each individual battery
          if (bat.maxcapacity && bat.designcapacity) {
            bat.healthScore = Math.round((bat.maxcapacity / bat.designcapacity) * 100);
          }
          return bat;
        }),
        // Calculate aggregate values - weighted average based on capacity
        percent: calculateWeightedAverageBatteryLevel(batteryData),
        ischarging: batteryData.some(battery => battery.ischarging),
        // Total capacity
        maxcapacity: batteryData.reduce((sum, battery) => sum + (battery.maxcapacity || 0), 0),
        designcapacity: batteryData.reduce((sum, battery) => sum + (battery.designcapacity || 0), 0),
        // Average cycle count
        cyclecount: Math.round(
          batteryData.reduce((sum, battery) => sum + (battery.cyclecount || 0), 0) / batteryData.length
        ),
        // Use the minimum time remaining as the overall time (from discharging batteries)
        timeremaining: batteryData
          .filter(bat => !bat.ischarging && bat.timeremaining !== undefined)
          .reduce((min, bat) => 
            Math.min(min === null ? Infinity : min, bat.timeremaining === undefined ? Infinity : bat.timeremaining), 
            null
          )
      };
      
      // Fix Infinity case for timeremaining
      if (aggregateBattery.timeremaining === Infinity || aggregateBattery.timeremaining === null) {
        aggregateBattery.timeremaining = null;
      }
      
      // Add health score calculation
      aggregateBattery.healthScore = calculateBatteryHealth(aggregateBattery);
      
      return aggregateBattery;
    }
    
    // Single battery case (as before)
    const singleBattery = Array.isArray(batteryData) ? batteryData[0] : batteryData;
    singleBattery.healthScore = calculateBatteryHealth(singleBattery);
    return singleBattery;
  } catch (error) {
    console.error('Failed to get battery information:', error);
    return null;
  }
}

// Calculate a weighted average battery level based on capacities
function calculateWeightedAverageBatteryLevel(batteries) {
  // If no capacity info, use simple average
  const hasCapacityInfo = batteries.every(bat => bat.maxcapacity !== undefined);
  
  if (!hasCapacityInfo) {
    return batteries.reduce((sum, bat) => sum + bat.percent, 0) / batteries.length;
  }
  
  // Calculate weighted average based on capacity
  const totalCapacity = batteries.reduce((sum, bat) => sum + bat.maxcapacity, 0);
  const weightedSum = batteries.reduce((sum, bat) => sum + (bat.percent * bat.maxcapacity), 0);
  
  return weightedSum / totalCapacity;
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
  
  // Sort history data chronologically
  const sortedHistory = [...historyData].sort((a, b) => 
    new Date(a.timestamp) - new Date(b.timestamp)
  );
  
  // Calculate average drain rate
  let totalDrain = 0;
  let drainCount = 0;
  let chargingEvents = 0;
  let deepDischargeEvents = 0;
  let overchargeEvents = 0;
  
  for (let i = 1; i < sortedHistory.length; i++) {
    const prev = sortedHistory[i - 1];
    const current = sortedHistory[i];
    
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
  
  // Extract charging sessions
  const chargingSessions = extractChargingSessions(sortedHistory);
  
  const averageDrainRate = drainCount > 0 ? totalDrain / drainCount : null;
  const estimatedLifeHours = averageDrainRate ? 100 / averageDrainRate : null;
  const chargingFrequency = {
    total: chargingEvents,
    deepDischarge: deepDischargeEvents,
    overcharge: overchargeEvents,
    sessions: chargingSessions
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

// Extract charging sessions from history data
function extractChargingSessions(historyData) {
  const sessions = [];
  let currentSession = null;
  
  for (let i = 0; i < historyData.length; i++) {
    const current = historyData[i];
    
    // Start of charging session
    if (current.isCharging && (i === 0 || !historyData[i-1].isCharging)) {
      currentSession = {
        startTime: new Date(current.timestamp),
        startPercentage: current.percentage
      };
    }
    
    // End of charging session
    if (currentSession && (!current.isCharging || i === historyData.length - 1) && 
        (i > 0 && historyData[i-1].isCharging)) {
      currentSession.endTime = new Date(current.timestamp);
      currentSession.endPercentage = current.percentage;
      currentSession.duration = (currentSession.endTime - currentSession.startTime) / (1000 * 60); // in minutes
      
      // Only include valid sessions (at least 1 minute and some charging occurred)
      if (currentSession.duration >= 1 && currentSession.endPercentage > currentSession.startPercentage) {
        sessions.push(currentSession);
      }
      
      currentSession = null;
    }
  }
  
  return sessions;
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
  // If the OS provides an estimate, use it
  if (batteryData && !batteryData.ischarging && batteryData.timeremaining) {
    return batteryData.timeremaining;
  }
  
  // Otherwise calculate based on our own analysis
  if (!batteryData || batteryData.ischarging || !batteryAnalysis || !batteryAnalysis.averageDrainRate) {
    return null;
  }
  
  const currentPercentage = batteryData.percent;
  return (currentPercentage / batteryAnalysis.averageDrainRate) * 60; // Convert hours to minutes
}

// Predict charging time to full
function predictChargingTimeToFull(batteryData, historyData) {
  if (!batteryData || !batteryData.ischarging || !historyData || historyData.length < 5) {
    return null;
  }
  
  // Extract charging sessions
  const sortedHistory = [...historyData].sort((a, b) => 
    new Date(a.timestamp) - new Date(b.timestamp)
  );
  
  const chargingSessions = extractChargingSessions(sortedHistory);
  
  if (chargingSessions.length < 2) {
    return null; // Not enough data to predict
  }
  
  // Calculate average charging rate (percent per minute)
  let totalRate = 0;
  let count = 0;
  
  for (const session of chargingSessions) {
    const percentChange = session.endPercentage - session.startPercentage;
    const rate = percentChange / session.duration; // percent per minute
    
    if (rate > 0) {
      totalRate += rate;
      count++;
    }
  }
  
  if (count === 0) return null;
  
  const avgChargingRate = totalRate / count;
  const currentPercentage = batteryData.percent;
  const percentToFull = 100 - currentPercentage;
  
  // Estimate minutes until full
  return Math.round(percentToFull / avgChargingRate);
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
  
  // Create entry with essential data for historical tracking
  const historyEntry = {
    timestamp: now,
    percentage: batteryData.percent,
    isCharging: batteryData.ischarging,
    capacity: batteryData.maxcapacity,
    cycleCount: batteryData.cyclecount
  };
  
  // Add multi-battery info if present
  if (batteryData.hasMult) {
    historyEntry.isMultiBattery = true;
    historyEntry.batteryCount = batteryData.count;
    
    // Add individual battery percentages
    historyEntry.batteryPercentages = batteryData.batteries.map(battery => ({
      percentage: battery.percent,
      isCharging: battery.ischarging
    }));
  }
  
  historyData.push(historyEntry);
  
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
  predictChargingTimeToFull,
  predictOptimalChargeTime,
  saveBatteryData,
  extractChargingSessions
};