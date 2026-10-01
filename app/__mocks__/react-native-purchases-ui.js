// Native module isn't linked under Jest. Default: the user already has Pro,
// so the paywall isn't shown.
const PAYWALL_RESULT = {
  NOT_PRESENTED: 'NOT_PRESENTED',
  ERROR: 'ERROR',
  CANCELLED: 'CANCELLED',
  PURCHASED: 'PURCHASED',
  RESTORED: 'RESTORED',
};

module.exports = {
  __esModule: true,
  PAYWALL_RESULT,
  default: {
    presentPaywallIfNeeded: jest
      .fn()
      .mockResolvedValue(PAYWALL_RESULT.NOT_PRESENTED),
  },
};
