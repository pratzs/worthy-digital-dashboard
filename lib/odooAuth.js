/**
 * Odoo's `authenticate` call is not cheap - it takes 3 to 13 seconds when Odoo is
 * busy, and every dashboard route used to make it again on every request, with a
 * 15 second limit. A page load makes about ten requests, so under load the page
 * failed at the login step before it had asked for a single figure.
 *
 * The user id does not change between requests, so it is kept for the life of the
 * server instance and shared by requests that arrive together. A failed login is
 * never kept, and the id expires after 30 minutes so a changed password or
 * deactivated user is noticed.
 */
const TTL_MS = 30 * 60 * 1000;
const held = new Map(); // key -> { at, promise }

/** `login` performs the authenticate call and returns Odoo's JSON response ({ result: uid }). */
export async function cachedAuth(login, ...keyParts) {
  const key = keyParts.join('|');
  const hit = held.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.promise;
  const promise = Promise.resolve(login()).then(
    (res) => { if (!res?.result) held.delete(key); return res; },
    (err) => { held.delete(key); throw err; },
  );
  held.set(key, { at: Date.now(), promise });
  return promise;
}
