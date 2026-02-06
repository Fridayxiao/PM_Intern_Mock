const memory = new Map();

function canUseLocalStorage() {
  try {
    const k = "__ai_pm_sim_probe__";
    window.localStorage.setItem(k, "1");
    window.localStorage.removeItem(k);
    return true;
  } catch {
    return false;
  }
}

let _localOk = null;

export const storage = {
  getItem(key) {
    if (typeof window === "undefined") return memory.get(key) ?? null;
    if (_localOk === null) _localOk = canUseLocalStorage();
    if (_localOk) return window.localStorage.getItem(key);
    return memory.get(key) ?? null;
  },
  setItem(key, value) {
    if (typeof window === "undefined") {
      memory.set(key, String(value));
      return;
    }
    if (_localOk === null) _localOk = canUseLocalStorage();
    if (_localOk) window.localStorage.setItem(key, String(value));
    else memory.set(key, String(value));
  },
  removeItem(key) {
    if (typeof window === "undefined") {
      memory.delete(key);
      return;
    }
    if (_localOk === null) _localOk = canUseLocalStorage();
    if (_localOk) window.localStorage.removeItem(key);
    else memory.delete(key);
  }
};

