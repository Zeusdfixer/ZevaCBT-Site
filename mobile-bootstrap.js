/**
 * MOBILE BOOTSTRAP — replaces lan-data-store.js for the mobile practice
 * app. The mobile app NEVER runs in LAN mode (it's a personal practice
 * tool, not the school's exam server), so this skips all the
 * network-probing logic in lan-data-store.js entirely — no point
 * trying to ping a LAN server on a phone that's on mobile data or has
 * no network at all. Always resolves to LocalDataStore/standalone.
 *
 * ZEVA_DATASTORE_READY is deliberately a promise WE control the
 * resolution of (via window.ZEVA_RESOLVE_DATASTORE_READY), rather
 * than an already-resolved Promise.resolve(). app.js's own init()
 * IIFE awaits this before doing anything else — holding it open lets
 * mobile-activation.js finish any content-capping patches it needs
 * to apply BEFORE app.js proceeds to call render(), with no race
 * condition, since app.js is provably blocked on this exact promise
 * rather than merely likely to run after some other unrelated await.
 */
window.DataStore = LocalDataStore;
window.ZEVA_MODE = 'standalone';
window.ZEVA_DATASTORE_READY = new Promise((resolve) => {
  window.ZEVA_RESOLVE_DATASTORE_READY = resolve;
});
