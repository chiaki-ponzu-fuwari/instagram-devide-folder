export function getLoginUiState({ currentUser, lastLoginProvider }) {
  const signedIn = !!currentUser?.uid;
  return {
    signedIn,
    providerId: signedIn ? String(lastLoginProvider || '').trim() : '',
    badgeText: signedIn ? 'ログイン中' : '',
  };
}

export function shouldOpenLogoutSheet({ currentUser }) {
  return !!currentUser?.uid;
}
