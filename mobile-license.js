/**
 * ZEVA CBT MOBILE — DEVICE-LOCKED, ONE-TIME-PURCHASE LICENSING
 * ============================================================
 * Runs inside the Capacitor WebView (plain browser JS + the Capacitor
 * plugins below — no Node.js APIs are available on a phone, so this
 * is a from-scratch companion to licensing/license.js on the PC side,
 * not a port of it).
 *
 * HOW THIS DIFFERS FROM THE PC SERVER'S LICENSING
 * ------------------------------------------------------------
 * - PC: one-time purchase tiers of 30/60/90 DAYS, re-purchased
 *   repeatedly (recurring revenue), and a genuine reinstall on the
 *   SAME machine intentionally resets activation (forces a fresh
 *   purchase).
 * - Mobile: ONE-TIME purchase, no expiry, and a reinstall on the
 *   SAME phone must NOT lose the activation (per instruction — this
 *   is normal, forgivable user behaviour: freeing up storage, a
 *   phone update, etc.). Activation is lost only when the app moves
 *   to a genuinely DIFFERENT phone — which is what makes it
 *   "non-transferable" as specified.
 *
 * HOW DEVICE IDENTITY WORKS HERE
 * ------------------------------------------------------------
 * Ordinary app storage (localStorage, Capacitor Preferences using the
 * default store) is wiped on uninstall — that's normal app behaviour
 * on both Android and iOS. If the device ID lived there, "reinstall
 * on the same phone" and "install on a different phone" would look
 * identical (both wiped/absent), which can't satisfy "reinstall
 * keeps working" AND "different phone needs a new code" at once.
 *
 * So the device identifier here is read via a plugin that stores it
 * OUTSIDE normal app data:
 *   - Android: AccountManager (survives uninstall/reinstall)
 *   - iOS: Keychain with device-only accessibility (survives
 *     uninstall/reinstall, does NOT survive if the user restores a
 *     DIFFERENT phone from this phone's iCloud backup — Apple's
 *     Keychain design ties it to the physical Secure Enclave)
 * This repo expects the @capgo/capacitor-persistent-uuid plugin (or
 * any plugin with the same shape — see MOBILE-BUILD-GUIDE.txt for
 * exact install steps) for exactly this reason — do not swap in a
 * plugin whose ID resets on reinstall (e.g. one based on Android's
 * ANDROID_ID / getId() from @capawesome/capacitor-device-info), or
 * reinstall-persistence breaks.
 *
 * This module needs TWO things, both backed by storage that survives
 * a normal uninstall:
 *   1. The device ID itself — @capgo/capacitor-persistent-uuid's
 *      getId() => Promise<{ id: string }>. This plugin's real public
 *      API is ONLY getId()/resetId()/getPluginVersion() — it does
 *      NOT expose a general key/value store, so it cannot also hold
 *      the activation record (an earlier draft of this file assumed
 *      it could; that was wrong and has been corrected here).
 *   2. A small persisted STRING (the activation code) alongside that
 *      ID, so a same-phone reinstall comes back already activated
 *      with zero user action — not just "the same code would work
 *      again if re-typed." For this, install the companion plugin
 *      @capgo/capacitor-persistent-account (same author, same
 *      AccountManager/Keychain mechanism, but built to store
 *      arbitrary account data rather than just a UUID):
 *        writeAccount({ data }) / readAccount() => Promise<{ data }>
 *      See MOBILE-BUILD-GUIDE.txt for exact install steps for both
 *      plugins together.
 *
 * HONESTY ABOUT THE LIMITS OF THIS (same caveat as the PC version):
 * a factory reset, clearing the Keychain via device settings, or a
 * jailbroken/rooted device with the right tools can still reset this
 * identifier. That raises the bar to "you'd have to deliberately dig
 * for it," not "impossible" — the same practical-not-perfect
 * tradeoff documented in the PC licensing module.
 *
 * ------------------------------------------------------------
 * THE SECRET
 * ------------------------------------------------------------
 * Same model as the PC side: ZEVA_LICENSE_SECRET must be IDENTICAL to
 * the one used by licensing/generate-activation-code.js (the PC-side
 * tool Zeus Technologies Innovations staff already use) so one script
 * can issue codes for both platforms. Change it in BOTH files
 * together, never one without the other.
 */

const ZEVA_LICENSE_SECRET = 'CHANGE-ME-2a8f3e9c1b7d4f6081a2c3e4b5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718';
const PRODUCT_TAG = 'ZEVAMOB';
const STORAGE_KEY = 'zeva_mobile_license_v1';

// ---- Web Crypto based HMAC-SHA256 (works in any modern WebView, no
// Node.js required — this is the browser-native equivalent of what
// licensing/license.js does with require('crypto')) ----
async function hmacSha256Hex(secret, message) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
async function sha256Hex(message) {
  const enc = new TextEncoder();
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(message));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function formatFromHex(hexString, prefix, maxChars) {
  const alphabet = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'; // no 0/O/1/I/L
  let bits = '';
  for (let i = 0; i < hexString.length; i += 2) {
    bits += parseInt(hexString.slice(i, i + 2), 16).toString(2).padStart(8, '0');
  }
  let out = '';
  for (let i = 0; i + 5 <= bits.length && out.length < maxChars; i += 5) {
    out += alphabet[parseInt(bits.slice(i, i + 5), 2) % alphabet.length];
  }
  const groups = out.match(/.{1,4}/g) || [];
  return prefix ? `${prefix}-${groups.join('-')}` : groups.join('-');
}

/** Reads this device's persistent identifier via the native plugin.
 * See MOBILE-BUILD-GUIDE.txt for which plugin to install — this
 * function expects a global `window.Capacitor.Plugins.PersistentUuid`
 * (or the equivalent import wired up in app-entry.js) exposing
 * getId() => Promise<{ id: string }>. */
async function getPersistentDeviceId() {
  const plugin = window.Capacitor?.Plugins?.PersistentUuid;
  if (!plugin) {
    throw new Error(
      'PersistentUuid plugin not found. This module requires a Capacitor ' +
      'plugin that persists an identifier OUTSIDE normal app storage ' +
      '(Android AccountManager / iOS Keychain) so it survives reinstall ' +
      'on the same device. See MOBILE-BUILD-GUIDE.txt.'
    );
  }
  const result = await plugin.getId();
  return result.id;
}

/** Derives this device's human-readable serial number from its
 * persistent identifier. Same physical device => same serial every
 * time, including after an uninstall + reinstall. A genuinely
 * different device => a different serial. */
async function computeDeviceSerial() {
  const deviceId = await getPersistentDeviceId();
  const hash = await sha256Hex(deviceId + '|' + PRODUCT_TAG);
  return formatFromHex(hash, PRODUCT_TAG, 16);
}

/** Computes the one valid activation code for a given serial number.
 * Only Zeus Technologies Innovations staff (holding the secret, via
 * the PC-side generate-activation-code.js --mobile flag) should ever
 * call this meaningfully. Unlike the PC version there is no plan
 * parameter — mobile is a single one-time-purchase tier. */
async function computeActivationCode(serialNumber, secret = ZEVA_LICENSE_SECRET) {
  const hmac = await hmacSha256Hex(secret, `${serialNumber}|MOBILE-ONETIME`);
  return formatFromHex(hmac, null, 12);
}

async function isActivationCodeValid(serialNumber, activationCode, secret = ZEVA_LICENSE_SECRET) {
  const expected = await computeActivationCode(serialNumber, secret);
  const normalise = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return normalise(expected) === normalise(activationCode);
}

/** Reads the locally-stored activation record. This is intentionally
 * read from the SAME persistent store as the device ID (see
 * getPersistentDeviceId), not normal app storage — because normal
 * app storage is wiped on uninstall, and per spec a reinstall on the
 * SAME phone must keep the existing activation working without the
 * user re-entering their code. Falls back to Capacitor Preferences,
 * then plain localStorage, only for local web development where the
 * native persistent-storage plugin isn't available (those fallbacks
 * do NOT survive uninstall — see MOBILE-BUILD-GUIDE.txt). */
async function readLocalRecord() {
  try {
    const accountPlugin = window.Capacitor?.Plugins?.PersistentAccount;
    if (accountPlugin && accountPlugin.readAccount) {
      const result = await accountPlugin.readAccount();
      if (result && result.data) {
        return typeof result.data === 'string' ? JSON.parse(result.data) : result.data;
      }
    }
  } catch (e) { /* fall through */ }
  try {
    const Preferences = window.Capacitor?.Plugins?.Preferences;
    if (Preferences) {
      const { value } = await Preferences.get({ key: STORAGE_KEY });
      return value ? JSON.parse(value) : null;
    }
  } catch (e) { /* fall through to localStorage */ }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}
async function writeLocalRecord(record) {
  const json = JSON.stringify(record);
  try {
    const accountPlugin = window.Capacitor?.Plugins?.PersistentAccount;
    if (accountPlugin && accountPlugin.writeAccount) {
      await accountPlugin.writeAccount({ data: json });
      return;
    }
  } catch (e) { /* fall through */ }
  try {
    const Preferences = window.Capacitor?.Plugins?.Preferences;
    if (Preferences) {
      await Preferences.set({ key: STORAGE_KEY, value: json });
      return;
    }
  } catch (e) { /* fall through to localStorage */ }
  try { localStorage.setItem(STORAGE_KEY, json); } catch (e) { /* non-fatal */ }
}

const TRIAL_QUESTION_LIMIT_PER_SUBJECT = 5;
const TRIAL_SUBJECT_LIMIT = 3;

/** The function the app calls on startup. Never throws — a failure
 * to read the persistent device ID (e.g. plugin missing during local
 * web development) degrades to "trial, this session only" rather
 * than crashing the app. */
async function checkLicenseStatus() {
  let serialNumber;
  try {
    serialNumber = await computeDeviceSerial();
  } catch (e) {
    return {
      serialNumber: null,
      activated: false,
      source: 'trial',
      error: e.message,
      trial: { subjectLimit: TRIAL_SUBJECT_LIMIT, questionLimitPerSubject: TRIAL_QUESTION_LIMIT_PER_SUBJECT },
    };
  }

  const record = await readLocalRecord();
  const activated = !!(record && record.activationCode && await isActivationCodeValid(serialNumber, record.activationCode));

  return {
    serialNumber,
    activated,
    source: activated ? 'paid' : 'trial',
    activatedAt: activated ? record.activatedAt : null,
    trial: activated ? null : { subjectLimit: TRIAL_SUBJECT_LIMIT, questionLimitPerSubject: TRIAL_QUESTION_LIMIT_PER_SUBJECT },
  };
}

/** Attempts to activate this device with a customer-entered code. */
async function activateWithCode(activationCode) {
  const serialNumber = await computeDeviceSerial();
  const valid = await isActivationCodeValid(serialNumber, activationCode);
  if (!valid) {
    return { success: false, message: 'That activation code does not match this device.' };
  }
  await writeLocalRecord({
    serialNumber,
    activationCode: String(activationCode).toUpperCase().trim(),
    activatedAt: new Date().toISOString(),
  });
  return { success: true, message: 'Activated — full access unlocked.' };
}

window.ZevaMobileLicense = {
  computeDeviceSerial,
  computeActivationCode,
  isActivationCodeValid,
  checkLicenseStatus,
  activateWithCode,
  TRIAL_QUESTION_LIMIT_PER_SUBJECT,
  TRIAL_SUBJECT_LIMIT,
};
