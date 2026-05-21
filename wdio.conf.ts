// Strategy B: Appium proxy
//
// WinAppDriver v1.2.1 only accepts the legacy JSONWP desiredCapabilities format.
// WebdriverIO v9 sends strict W3C — which WinAppDriver rejects.
// Appium 3.x bridges the gap: it receives W3C from WebdriverIO and forwards
// the correct JSONWP format to WinAppDriver internally.
//
// Prerequisites:
//   - Appium 3.x installed globally:  npm install -g appium
//   - Windows driver installed:        appium driver install windows
//   - WinAppDriver v1.2.1 at:         C:\Program Files (x86)\Windows Application Driver\WinAppDriver.exe
//   - IDM installed at:               C:\Program Files (x86)\Internet Download Manager\IDMan.exe

export const config: WebdriverIO.Config = {
    runner: 'local',
    tsConfigPath: './tsconfig.json',

    // WebdriverIO → Appium on port 4724
    // (WinAppDriver stays on its own port 4723; Appium-managed WinAppDriver uses a separate port)
    hostname: '127.0.0.1',
    port: 4724,
    path: '/',

    specs: ['./test/specs/**/*.ts'],
    exclude: [],

    maxInstances: 1,

    capabilities: [{
        platformName: 'Windows',
        // Tells Appium which driver to use → routes to appium-windows-driver
        'appium:automationName': 'Windows',
        'appium:app': 'C:\\Program Files (x86)\\Internet Download Manager\\IDMan.exe',
        'appium:appWorkingDir': 'C:\\Program Files (x86)\\Internet Download Manager',
        'appium:newCommandTimeout': 3600,
    } as WebdriverIO.Capabilities],

    logLevel: 'info',
    bail: 0,
    waitforTimeout: 10000,
    connectionRetryTimeout: 120000,
    connectionRetryCount: 3,

    // @wdio/appium-service starts and stops Appium automatically around the test run
    services: [
        ['appium', {
            command: 'appium',
            args: {
                port: 4724,
                basePath: '/',
            },
            logPath: './',
        }]
    ],

    framework: 'mocha',
    reporters: ['spec'],

    mochaOpts: {
        ui: 'bdd',
        timeout: 60000,
    },
};
