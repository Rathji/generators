window.CRM_EVENTS = (function () {
  const listeners = {};

  function on(ev, fn) {
    (listeners[ev] = listeners[ev] || []).push(fn);
  }

  function off(ev, fn) {
    const arr = listeners[ev];
    if (!arr) return;
    const i = arr.indexOf(fn);
    if (i >= 0) arr.splice(i, 1);
  }

  function fire(ev, data) {
    const arr = (listeners[ev] || []).slice();
    for (const fn of arr) {
      Promise.resolve().then(() => fn(data)).catch(err => console.error("CRM_EVENTS " + ev, err));
    }
  }

  function fireSync(ev, data) {
    const arr = (listeners[ev] || []).slice();
    return Promise.allSettled(arr.map(fn => Promise.resolve().then(() => fn(data))));
  }

  return { on, off, fire, fireSync };
})();
