# BatterySense

BatterySense is a desktop application that monitors and optimizes your laptop's battery health with smart charging recommendations. It helps extend battery life through better charging habits and provides real-time insights into battery performance.

## Features

- Real-time monitoring of battery charge level and health status
- Smart notifications for optimal charging and discharging
- Battery health analysis with personalized recommendations
- Customizable charging thresholds to maximize battery lifespan
- Historical battery usage data visualization
- System tray integration for easy access

## Installation

### Requirements

- Node.js 14+ and npm

### Setup

1. Clone this repository or download the source code
2. Navigate to the project directory in your terminal
3. Install dependencies:

```bash
npm install
```

4. Start the application:

```bash
npm start
```

### Building for Distribution

To build the application for distribution:

```bash
npm run package
```

This will create distributable packages for your current platform in the `dist` directory.

## Project Structure

```
battery-sense/
├── assets/
│   └── icons/              # Application icons
├── main.js                 # Main Electron process
├── index.html              # Main application UI
├── renderer.js             # Renderer process (UI logic)
├── styles.css              # Application styling
├── batteryMonitor.js       # Core battery monitoring functionality
├── notificationSystem.js   # Notification management
├── settings.js             # User preferences management
└── package.json            # Project configuration
```

## Development

### Adding Icons

You'll need to create the following icon files and place them in the `assets/icons` directory:

- `icon.png` - Main application icon
- `tray-icon.png` - System tray icon
- `notification-icon.png` - Default notification icon
- `warning-icon.png` - Warning notification icon
- `critical-icon.png` - Critical notification icon
- `success-icon.png` - Success notification icon

### Dependencies

BatterySense uses the following key technologies:

- [Electron](https://www.electronjs.org/) - For cross-platform desktop app development
- [systeminformation](https://www.npmjs.com/package/systeminformation) - For battery data access
- [Chart.js](https://www.chartjs.org/) - For data visualization
- [electron-store](https://github.com/sindresorhus/electron-store) - For settings persistence
- [node-notifier](https://github.com/mikaelbr/node-notifier) - For system notifications

## License

MIT

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.