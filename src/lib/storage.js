// window.storage シム。Claude アーティファクトの storage API（get/set/delete、
// 非同期、キーごとに JSON 文字列）と同じ形を localStorage で再現し、
// プロトタイプのコンポーネント側を書き換えずに動かすためのもの。
// 第2引数（グローバル/ユーザー別のフラグ）は受け取るが、この端末内保存では区別しない。
const PREFIX = "totonoe:";

window.storage = {
  get(key) {
    return new Promise((resolve, reject) => {
      const k = PREFIX + key;
      if (!(k in localStorage)) {
        reject(new Error("not found"));
        return;
      }
      resolve({ key, value: localStorage.getItem(k) });
    });
  },
  set(key, value) {
    return new Promise((resolve, reject) => {
      try {
        localStorage.setItem(PREFIX + key, value);
        resolve({ key, value });
      } catch (e) {
        reject(e);
      }
    });
  },
  delete(key) {
    return new Promise((resolve) => {
      localStorage.removeItem(PREFIX + key);
      resolve({ key, deleted: true });
    });
  },
  list(prefix) {
    return new Promise((resolve) => {
      const p = PREFIX + (prefix || "");
      const keys = Object.keys(localStorage)
        .filter((k) => k.indexOf(p) === 0)
        .map((k) => k.slice(PREFIX.length));
      resolve({ keys, prefix });
    });
  },
};
