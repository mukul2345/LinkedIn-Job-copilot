// credential-migration.js - One-way removal of obsolete stored credentials.

const LEGACY_CREDENTIAL_KEYS = Object.freeze([
  'linkedinEmail',
  'linkedinPassword',
  'credentialsObfuscated',
  'credentialOwnerUid',
  'pendingAutoLogin',
]);

/**
 * Delete obsolete LinkedIn credentials without copying them to another store.
 * Cloud cleanup is best-effort so local removal cannot be blocked by network
 * availability or older Firestore security rules.
 * @param {string|null} uid Firebase user identifier when authenticated.
 * @returns {Promise<boolean>} Whether the cloud field was removed or absent.
 */
async function removeLegacyLinkedInCredentials(uid = null) {
  await new Promise(resolve => {
    chrome.storage.local.remove(LEGACY_CREDENTIAL_KEYS, resolve);
  });

  if (!uid || typeof db === 'undefined' || typeof firebase === 'undefined') {
    return true;
  }

  try {
    await db.collection('users').doc(uid).update({
      linkedinCredentials: firebase.firestore.FieldValue.delete(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    if (typeof invalidateCache === 'function') await invalidateCache('fullProfile');
    return true;
  } catch (error) {
    ExtensionLogger.warn('Legacy credential cloud cleanup was unavailable.', {
      code: error?.code,
    });
    return false;
  }
}
