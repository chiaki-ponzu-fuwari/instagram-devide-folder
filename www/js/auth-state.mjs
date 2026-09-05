export function getLoginUiState({ currentUser, lastLoginProvider }) {
  const signedIn = !!currentUser?.uid;
  return {
    signedIn,
    providerId: signedIn ? String(lastLoginProvider || '').trim() : '',
    badgeText: signedIn ? 'ログイン中' : '',
  };
}

export function getLoginRowUiState({ currentUser, lastLoginProvider, rowProviderId }) {
  const signedIn = !!currentUser?.uid;
  const providerId = signedIn ? String(lastLoginProvider || '').trim() : '';
  const isActive = signedIn && providerId === String(rowProviderId || '').trim();
  return {
    signedIn,
    providerId,
    rowProviderId: String(rowProviderId || '').trim(),
    isActive,
    badgeText: isActive ? 'ログイン中' : '',
    action: shouldOpenLogoutSheet({ currentUser, lastLoginProvider, rowProviderId }) ? 'logout-sheet' : 'login',
  };
}

export function getAccountDeletionUiState({ currentUser, lastLoginProvider }) {
  const signedIn = !!currentUser?.uid;
  if (!signedIn) return { signedIn: false, providerId: '' };
  const providerIds = new Set(
    (Array.isArray(currentUser.providerData) ? currentUser.providerData : [])
      .map((provider) => String(provider?.providerId || '').trim())
      .filter((providerId) => providerId === 'google.com' || providerId === 'apple.com'),
  );
  const lastProvider = String(lastLoginProvider || '').trim();
  const providerId = ['google.com', 'apple.com'].includes(lastProvider)
    ? lastProvider
    : providerIds.size === 1 ? [...providerIds][0] : '';
  return { signedIn, providerId };
}

export function getLoginAccountLabel({ currentUser }) {
  if (!currentUser?.uid) return '';
  const email = String(currentUser.email || '').trim();
  if (email) return email;
  const providerEmail = (Array.isArray(currentUser.providerData) ? currentUser.providerData : [])
    .map((p) => String(p?.email || '').trim())
    .find(Boolean);
  if (providerEmail) return providerEmail;
  const displayName = String(currentUser.displayName || '').trim();
  if (displayName) return displayName;
  return String(currentUser.uid || '').trim();
}

export function shouldOpenLogoutSheet({ currentUser, lastLoginProvider, rowProviderId }) {
  if (!currentUser?.uid) return false;
  if (!rowProviderId) return true;
  return String(lastLoginProvider || '').trim() === String(rowProviderId || '').trim();
}
