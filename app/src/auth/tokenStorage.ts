import * as Keychain from 'react-native-keychain';

const SERVICE = 'flourish.session-token';

export async function saveToken(token: string): Promise<void> {
  await Keychain.setGenericPassword('session', token, { service: SERVICE });
}

export async function loadToken(): Promise<string | null> {
  const credentials = await Keychain.getGenericPassword({ service: SERVICE });
  return credentials ? credentials.password : null;
}

export async function clearToken(): Promise<void> {
  await Keychain.resetGenericPassword({ service: SERVICE });
}
