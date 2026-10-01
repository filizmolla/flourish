// Native module isn't linked under Jest; behave as if no launch args were passed.
module.exports = {
  LaunchArguments: {
    value: () => ({}),
  },
};
