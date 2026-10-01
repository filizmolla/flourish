import {
  CameraOptions,
  ImageLibraryOptions,
  launchCamera,
  launchImageLibrary,
} from 'react-native-image-picker';
import { FAKE_IMAGE_PICKER } from './config';
import { fakeImagePicker } from './fakeImagePicker';

// The camera and gallery, or a bundled photo in E2E runs (Detox can't reach
// the camera app or the system picker).
export const picker = FAKE_IMAGE_PICKER
  ? fakeImagePicker
  : { launchCamera, launchImageLibrary };

// Long side ~1600 px is enough for the model to read text, and keeps five
// photos well under the server's 10 MB body limit. The picker keeps PNG
// screenshots as PNG; everything else comes back as JPEG.
export const PICKER_OPTIONS = {
  mediaType: 'photo',
  maxWidth: 1600,
  maxHeight: 1600,
  quality: 0.8,
  includeBase64: true,
} as const satisfies CameraOptions & ImageLibraryOptions;
