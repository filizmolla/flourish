// Both pickers resolve as if the user cancelled; tests override per call.
module.exports = {
  launchCamera: jest.fn().mockResolvedValue({ didCancel: true }),
  launchImageLibrary: jest.fn().mockResolvedValue({ didCancel: true }),
};
