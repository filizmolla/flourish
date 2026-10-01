module.exports = {
  preset: '@react-native/jest-preset',
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|@react-native-async-storage|@react-navigation|react-native-screens|react-native-safe-area-context)/)',
  ],
  // Detox e2e specs run under e2e/jest.config.js, not this unit test config.
  testPathIgnorePatterns: ['/node_modules/', '<rootDir>/e2e/'],
};
