import { Platform } from 'react-native';

// Warm, editorial palette for the recipe screens — cream paper, dark ink,
// terracotta accents — in the spirit of long-form recipe blogs.
export const colors = {
  paper: '#FAF6F0',
  card: '#FFFDF9',
  ink: '#2B2420',
  inkMuted: '#7D7168',
  hairline: '#EADFD3',
  accent: '#B5562F',
  placeholder: '#E9DCCB',
  // Light enough that example text in inputs never reads as a filled-in value.
  placeholderText: '#B9ADA2',
  danger: '#B3261E',
};

// System serifs only, so no font assets need to be bundled.
export const fonts = {
  serif: Platform.select({ ios: 'Georgia', default: 'serif' }),
};
