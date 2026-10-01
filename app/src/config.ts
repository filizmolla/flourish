import { Platform } from 'react-native';
import { LaunchArguments } from 'react-native-launch-arguments';

// Dev-only: 10.0.2.2 is the Android emulator's alias for the host machine's
// localhost. A physical device needs the host's LAN IP instead.
const DEV_HOST = Platform.OS === 'android' ? '10.0.2.2' : 'localhost';

// Detox passes `apiPort` (see app/.detoxrc.js) so E2E runs hit the test server
// on the flourish_test database instead of the dev server.
const { apiPort, fakeImagePicker } = LaunchArguments.value<{
  apiPort?: string | number;
  fakeImagePicker?: string | boolean;
}>();
const API_PORT = apiPort ? String(apiPort) : '3000';

export const API_BASE_URL = `http://${DEV_HOST}:${API_PORT}`;

// Detox can't reach the camera app or the system photo picker (other
// processes), so E2E runs pass `fakeImagePicker` and get a bundled photo
// instead (src/fakeImagePicker.ts).
export const FAKE_IMAGE_PICKER =
  fakeImagePicker === true || fakeImagePicker === 'true';

// RevenueCat Test Store key: a public SDK key, meant to ship inside the app.
// Test Store only: the SDK crashes in a release build with this key, so a
// store release needs the Play Store key here.
// Empty turns Pro off (no RevenueCat calls, photo import open), for dev
// without a RevenueCat project.
export const REVENUECAT_API_KEY: string = 'test_zqbqVAOFmWktOdCmsNxdkJeyvGd';
export const PRO_ENTITLEMENT = 'pro';
export const PURCHASES_ENABLED = REVENUECAT_API_KEY !== '';
