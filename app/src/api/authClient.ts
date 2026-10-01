import { API_BASE_URL } from '../config';
import { strings } from '../strings';

export type AuthUser = {
  id: string;
  name: string;
  email: string;
};

export class AuthError extends Error {}

async function parseError(response: Response): Promise<string> {
  try {
    const body = await response.json();
    return body?.message ?? body?.error ?? strings.common.requestFailed(response.status);
  } catch {
    return strings.common.requestFailed(response.status);
  }
}

// Sign-in and sign-up both create a session and return it the same way.
async function requestSession(
  path: string,
  body: Record<string, string>,
): Promise<{ token: string; user: AuthUser }> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    // We authenticate with the bearer token, not cookies. Sending a stale
    // cookie without an Origin header trips Better Auth's CSRF check
    // ("Missing or null origin"), so opt this client out of cookies entirely.
    credentials: 'omit',
  });

  if (!response.ok) {
    throw new AuthError(await parseError(response));
  }

  // The bearer plugin returns the usable session token in this response
  // header — the `token` field in the JSON body is only the token's id half.
  const token = response.headers.get('set-auth-token');
  if (!token) {
    throw new AuthError('Request succeeded but no session token was returned');
  }

  const data = await response.json();
  return { token, user: data.user as AuthUser };
}

export function signInWithEmail(email: string, password: string) {
  return requestSession('/api/auth/sign-in/email', { email, password });
}

// Better Auth signs the new user in automatically (autoSignIn defaults to true).
export function signUpWithEmail(name: string, email: string, password: string) {
  return requestSession('/api/auth/sign-up/email', { name, email, password });
}

export async function signOut(token: string): Promise<void> {
  await fetch(`${API_BASE_URL}/api/auth/sign-out`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    credentials: 'omit',
  });
}

export async function fetchCurrentUser(token: string): Promise<AuthUser | null> {
  const response = await fetch(`${API_BASE_URL}/me`, {
    headers: { Authorization: `Bearer ${token}` },
    credentials: 'omit',
  });

  if (response.status === 401) {
    return null;
  }
  if (!response.ok) {
    throw new AuthError(await parseError(response));
  }
  return (await response.json()) as AuthUser;
}
