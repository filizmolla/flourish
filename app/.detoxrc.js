// Windows cmd can't run `./gradlew`; it needs the .bat wrapper, path-qualified
// because cmd may not search the current directory for executables.
const gradlew = process.platform === 'win32' ? '.\\gradlew.bat' : './gradlew';

/** @type {Detox.DetoxConfig} */
module.exports = {
  testRunner: {
    args: {
      $0: 'jest',
      config: 'e2e/jest.config.js',
    },
    jest: {
      setupTimeout: 120000,
    },
  },
  apps: {
    'android.debug': {
      type: 'android.apk',
      binaryPath: 'android/app/build/outputs/apk/debug/app-debug.apk',
      build:
        `cd android && ${gradlew} assembleDebug assembleAndroidTest -DtestBuildType=debug`,
      reversePorts: [3000],
      // Read by app/src/config.ts: point the app at the test server
      // (server/.env.test), and fake the camera and gallery.
      launchArgs: { apiPort: 3001, fakeImagePicker: true },
    },
    'android.release': {
      type: 'android.apk',
      binaryPath: 'android/app/build/outputs/apk/release/app-release.apk',
      build:
        `cd android && ${gradlew} assembleRelease assembleAndroidTest -DtestBuildType=release`,
      launchArgs: { apiPort: 3001, fakeImagePicker: true },
    },
  },
  devices: {
    attached: {
      type: 'android.attached',
      device: {
        adbName: '.*',
      },
    },
    emulator: {
      type: 'android.emulator',
      device: {
        // Update to match the AVD name shown by `emulator -list-avds` on this machine.
        avdName: 'Medium_Phone_API_36.1',
      },
    },
  },
  configurations: {
    'android.att.debug': {
      device: 'attached',
      app: 'android.debug',
    },
    'android.att.release': {
      device: 'attached',
      app: 'android.release',
    },
    'android.emu.debug': {
      device: 'emulator',
      app: 'android.debug',
    },
    'android.emu.release': {
      device: 'emulator',
      app: 'android.release',
    },
  },
};
