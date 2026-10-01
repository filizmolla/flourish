// The library's own in-memory mock. Storage persists across tests in a file,
// so call AsyncStorage.clear() in beforeEach where it matters.
module.exports = require('@react-native-async-storage/async-storage/jest');
