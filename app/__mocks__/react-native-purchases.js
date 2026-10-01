// Native module isn't linked under Jest.
module.exports = {
  __esModule: true,
  default: {
    configure: jest.fn(),
    logIn: jest.fn().mockResolvedValue({ customerInfo: {}, created: false }),
    logOut: jest.fn().mockResolvedValue({}),
  },
};
