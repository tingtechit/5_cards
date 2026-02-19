import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import { getAnalytics, isSupported } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-analytics.js";
import {
  getDatabase,
  ref,
  set,
  get,
  update,
  onValue,
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-database.js";
import { firebaseConfig } from "./firebase-config.js";

const requiredKeys = ["apiKey", "authDomain", "databaseURL", "projectId", "appId"];
const missingKeys = requiredKeys.filter((key) => !firebaseConfig[key] || String(firebaseConfig[key]).trim() === "");

let app = null;
let database = null;
let analytics = null;
let initError = "";

function wrapRef(path) {
  const pathRef = ref(database, path);
  const listeners = [];

  return {
    set: (value) => set(pathRef, value),
    get: () => get(pathRef),
    update: (value) => update(pathRef, value),
    child: (subPath) => wrapRef(path ? `${path}/${subPath}` : subPath),
    on: (event, callback) => {
      if (event !== "value") throw new Error(`Unsupported event: ${event}`);
      const unsubscribe = onValue(pathRef, callback);
      listeners.push(unsubscribe);
      return unsubscribe;
    },
    off: () => {
      while (listeners.length) {
        const un = listeners.pop();
        try {
          un();
        } catch (_e) {
          // ignore listener cleanup errors
        }
      }
    },
  };
}

if (missingKeys.length > 0) {
  initError = `Firebase config incomplete. Missing: ${missingKeys.join(", ")}`;
} else {
  app = initializeApp(firebaseConfig);
  database = getDatabase(app);

  if (typeof window !== "undefined" && window.location.protocol.startsWith("http")) {
    isSupported()
      .then((supported) => {
        if (supported) analytics = getAnalytics(app);
      })
      .catch(() => {
        // Analytics optional for this game.
      });
  }
}

window.firebaseServices = {
  app,
  analytics,
  initError,
  missingKeys,
  database: database
    ? {
        ref: (path) => wrapRef(path),
      }
    : null,
};
