export function defaultMetrics() {
  return {
    efficiency: 0,
    accuracy: 0,
    ux: 0,
    cost: 0,
    risk: 0
  };
}

export function createStore(initial) {
  let state = structuredClone(initial);
  const subs = new Set();

  function get() {
    return state;
  }

  function set(patch) {
    state = { ...state, ...patch };
    for (const fn of subs) fn(state);
  }

  function subscribe(fn) {
    subs.add(fn);
    return () => subs.delete(fn);
  }

  return { get, set, subscribe };
}

