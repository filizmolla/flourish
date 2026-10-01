import {
  CameraOptions,
  ImageLibraryOptions,
  ImagePickerResponse,
} from 'react-native-image-picker';

// E2E only (see FAKE_IMAGE_PICKER in config.ts): both pickers return one
// small JPEG at once, the way the real ones return after the user picks.
// The server checks the bytes, so it must be a real JPEG.
const PHOTO_BASE64 =
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAoHBwgHBgoICAgLCgoLDhgQDg0NDh0VFhEYIx8lJCIf' +
  'IiEmKzcvJik0KSEiMEExNDk7Pj4+JS5ESUM8SDc9Pjv/2wBDAQoLCw4NDhwQEBw7KCIoOzs7Ozs7' +
  'Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozv/wAARCABAAEADASIA' +
  'AhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQA' +
  'AAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3' +
  'ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWm' +
  'p6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEA' +
  'AwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSEx' +
  'BhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElK' +
  'U1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3' +
  'uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD0uiis' +
  'e/udfjvJFsrGCW3GNjuwyeBn+Id89q5jY2KK5/7Z4q/6Btr/AN9D/wCLo+2eKv8AoG2v/fQ/+Lp2' +
  'A6Ciuf8Atnir/oG2v/fQ/wDi6Ptnir/oG2v/AH0P/i6LAdBRWHb3XiVrmJZ9Pt0iLgSMGGQueT9/' +
  '0rcpAFY9/wCJrLT7yS1minZ48ZKKCOQD6+9bFV5dQsoJDHNeQRuvVXkAI/DNAGP/AMJnp3/PG6/7' +
  '5X/4qj/hM9O/543X/fK//FVrf2rp3/QQtf8Av8v+NH9q6d/0ELX/AL/L/jTAyf8AhM9O/wCeN1/3' +
  'yv8A8VR/wmenf88br/vlf/iq1v7V07/oIWv/AH+X/Gj+1dO/6CFr/wB/l/xoAzbfxZYXNzFAkNwG' +
  'lcICVXGScetblVk1KwkdUS+t2ZjgKJVJJ9OtWaACs+60LTby4a4uLbfK+Nzb2GcDHY+1aFY9/o17' +
  'd3kk8OsT26NjESZwuAB/eH1oAf8A8Ixo/wDz5/8AkV/8aP8AhGNH/wCfP/yK/wDjVT/hHdR/6GC6' +
  '/wDHv/iqP+Ed1H/oYLr/AMe/+KoAt/8ACMaP/wA+f/kV/wDGj/hGNH/58/8AyK/+NVP+Ed1H/oYL' +
  'r/x7/wCKo/4R3Uf+hguv/Hv/AIqgC9F4d0qCZJo7Xa8bBlPmMcEcjvWlWHb6Dfw3MUr65cSqjhih' +
  '3YYA9PvVuUAFY9/c6/HeSLZWMEtuMbHdhk8DP8Q757VsUUgOf+2eKv8AoG2v/fQ/+Lo+2eKv+gba' +
  '/wDfQ/8Ai66CincDn/tnir/oG2v/AH0P/i6Ptnir/oG2v/fQ/wDi66Cii4GHb3XiVrmJZ9Pt0iLg' +
  'SMGGQueT9/0rcoopAf/Z';

async function pickOne(
  _options: CameraOptions | ImageLibraryOptions,
): Promise<ImagePickerResponse> {
  return {
    assets: [
      {
        uri: `data:image/jpeg;base64,${PHOTO_BASE64}`,
        base64: PHOTO_BASE64,
        type: 'image/jpeg',
      },
    ],
  };
}

export const fakeImagePicker = {
  launchCamera: pickOne,
  launchImageLibrary: pickOne,
};
