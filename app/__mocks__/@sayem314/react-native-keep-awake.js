// Native module isn't linked under Jest. Same behaviour as the real hook, with
// spies so tests can check the screen is kept awake on mount and released on unmount.
const { useEffect } = require('react');

const activateKeepAwake = jest.fn();
const deactivateKeepAwake = jest.fn();

function useKeepAwake() {
  useEffect(() => {
    activateKeepAwake();
    return () => deactivateKeepAwake();
  }, []);
}

module.exports = {
  __esModule: true,
  activateKeepAwake,
  deactivateKeepAwake,
  useKeepAwake,
  default: function KeepAwake() {
    useKeepAwake();
    return null;
  },
};
