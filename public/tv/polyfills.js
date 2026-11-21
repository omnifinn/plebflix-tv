/* Plebflix TV for Samsung Tizen TVs: the few runtime APIs the deck uses that a 2018-2020 TV browser (Chromium 56-69)
   lacks. Syntax is lowered by esbuild; these are the library gaps. Loaded first in /tv/bundle.js. */
if (typeof globalThis === "undefined") window.globalThis = window;
if (!Object.fromEntries) {
  Object.fromEntries = (entries) => {
    const out = {};
    for (const [key, value] of entries) out[key] = value;
    return out;
  };
}
if (!Array.prototype.at) {
  Object.defineProperty(Array.prototype, "at", {
    configurable: true,
    writable: true,
    value(n) {
      const i = Math.trunc(n) || 0;
      return this[i < 0 ? this.length + i : i];
    },
  });
}
if (!String.prototype.replaceAll) {
  Object.defineProperty(String.prototype, "replaceAll", {
    configurable: true,
    writable: true,
    value(find, replace) {
      return find instanceof RegExp ? this.replace(find, replace) : this.split(find).join(replace);
    },
  });
}
for (const proto of [Element.prototype, Document.prototype, DocumentFragment.prototype]) {
  if (!proto.replaceChildren) {
    Object.defineProperty(proto, "replaceChildren", {
      configurable: true,
      writable: true,
      value(...nodes) {
        while (this.lastChild) this.removeChild(this.lastChild);
        if (nodes.length) this.append(...nodes);
      },
    });
  }
}
if (window.crypto && !window.crypto.randomUUID) {
  window.crypto.randomUUID = () =>
    "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
      (Number(c) ^ (window.crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (Number(c) / 4)))).toString(16),
    );
}
if (window.MediaQueryList && !MediaQueryList.prototype.addEventListener) {
  MediaQueryList.prototype.addEventListener = function addEventListener(type, fn) {
    if (type === "change") this.addListener(fn);
  };
}
// The TV is a living-room set: sound is on from the first frame (a TV app may autoplay with sound).
try {
  sessionStorage.setItem("plebflix-sound", "1");
} catch {
  /* ignore */
}
document.documentElement.classList.add("is-tv");
