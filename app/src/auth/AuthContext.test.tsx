import { act, renderHook, waitFor } from '@testing-library/react-native';
import Purchases from 'react-native-purchases';
import {
  AuthUser,
  fetchCurrentUser,
  signInWithEmail,
  signOut as requestSignOut,
  signUpWithEmail,
} from '../api/authClient';
import { AuthProvider, useAuth } from './AuthContext';
import { AuthStatus } from './authStatus';
import { clearToken, loadToken, saveToken } from './tokenStorage';

// A RevenueCat key is set, so the provider links purchases to the account.
jest.mock('../config', () => ({
  ...jest.requireActual('../config'),
  PURCHASES_ENABLED: true,
}));
jest.mock('../api/authClient', () => ({
  ...jest.requireActual('../api/authClient'),
  fetchCurrentUser: jest.fn(),
  signInWithEmail: jest.fn(),
  signUpWithEmail: jest.fn(),
  signOut: jest.fn(),
}));
jest.mock('./tokenStorage', () => ({
  loadToken: jest.fn(),
  saveToken: jest.fn(),
  clearToken: jest.fn(),
}));

const mockedLogIn = jest.mocked(Purchases.logIn);
const mockedLogOut = jest.mocked(Purchases.logOut);
const mockedFetchCurrentUser = jest.mocked(fetchCurrentUser);
const mockedSignIn = jest.mocked(signInWithEmail);
const mockedSignUp = jest.mocked(signUpWithEmail);
const mockedRequestSignOut = jest.mocked(requestSignOut);
const mockedLoadToken = jest.mocked(loadToken);
const mockedSaveToken = jest.mocked(saveToken);
const mockedClearToken = jest.mocked(clearToken);

function makeUser(overrides: Partial<AuthUser> = {}): AuthUser {
  return { id: 'user-1', name: 'Ada', email: 'ada@example.com', ...overrides };
}

async function renderAuth() {
  const hook = await renderHook(() => useAuth(), { wrapper: AuthProvider });
  await waitFor(() =>
    expect(hook.result.current.status).not.toBe(AuthStatus.Loading),
  );
  return hook;
}

beforeEach(() => {
  jest.resetAllMocks();
  mockedLoadToken.mockResolvedValue(null);
  mockedSaveToken.mockResolvedValue();
  mockedClearToken.mockResolvedValue();
  mockedRequestSignOut.mockResolvedValue();
  mockedLogIn.mockResolvedValue({} as Awaited<ReturnType<typeof Purchases.logIn>>);
  mockedLogOut.mockResolvedValue(
    {} as Awaited<ReturnType<typeof Purchases.logOut>>,
  );
});

describe('AuthProvider, RevenueCat account', () => {
  it('does not log in to RevenueCat while signed out', async () => {
    const { result } = await renderAuth();

    expect(result.current.status).toBe(AuthStatus.SignedOut);
    expect(mockedLogIn).not.toHaveBeenCalled();
  });

  it('logs in to RevenueCat with the restored user id', async () => {
    mockedLoadToken.mockResolvedValue('stored-tok');
    mockedFetchCurrentUser.mockResolvedValue(makeUser({ id: 'user-7' }));

    const { result } = await renderAuth();

    expect(result.current.status).toBe(AuthStatus.SignedIn);
    expect(mockedLogIn).toHaveBeenCalledTimes(1);
    expect(mockedLogIn).toHaveBeenCalledWith('user-7');
  });

  it('logs in to RevenueCat with the user id after sign-in', async () => {
    mockedSignIn.mockResolvedValue({ token: 'tok', user: makeUser() });
    const { result } = await renderAuth();

    await act(() => result.current.signIn('ada@example.com', 'secret123'));

    expect(result.current.status).toBe(AuthStatus.SignedIn);
    expect(mockedLogIn).toHaveBeenCalledTimes(1);
    expect(mockedLogIn).toHaveBeenCalledWith('user-1');
  });

  it('logs in to RevenueCat with the new user id after sign-up', async () => {
    mockedSignUp.mockResolvedValue({
      token: 'tok',
      user: makeUser({ id: 'user-new' }),
    });
    const { result } = await renderAuth();

    await act(() =>
      result.current.signUp('Ada', 'ada@example.com', 'secret123'),
    );

    expect(mockedLogIn).toHaveBeenCalledWith('user-new');
  });

  it('still signs in when the RevenueCat login fails', async () => {
    mockedLogIn.mockRejectedValue(new Error('offline'));
    mockedSignIn.mockResolvedValue({ token: 'tok', user: makeUser() });
    const { result } = await renderAuth();

    await act(() => result.current.signIn('ada@example.com', 'secret123'));

    expect(mockedLogIn).toHaveBeenCalledWith('user-1');
    expect(result.current.status).toBe(AuthStatus.SignedIn);
    expect(result.current.user).toEqual(makeUser());
    expect(result.current.token).toBe('tok');
  });

  it('logs out of RevenueCat on sign-out', async () => {
    mockedSignIn.mockResolvedValue({ token: 'tok', user: makeUser() });
    const { result } = await renderAuth();
    await act(() => result.current.signIn('ada@example.com', 'secret123'));

    await act(() => result.current.signOut());

    expect(mockedLogOut).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe(AuthStatus.SignedOut);
  });

  it('still signs out when the RevenueCat logout fails', async () => {
    mockedLogOut.mockRejectedValue(new Error('offline'));
    mockedSignIn.mockResolvedValue({ token: 'tok', user: makeUser() });
    const { result } = await renderAuth();
    await act(() => result.current.signIn('ada@example.com', 'secret123'));

    await act(() => result.current.signOut());

    expect(mockedClearToken).toHaveBeenCalled();
    expect(result.current.status).toBe(AuthStatus.SignedOut);
    expect(result.current.user).toBeNull();
    expect(result.current.token).toBeNull();
  });

  it('logs in again with the next user after signing out', async () => {
    mockedSignIn
      .mockResolvedValueOnce({ token: 'tok-1', user: makeUser({ id: 'a' }) })
      .mockResolvedValueOnce({ token: 'tok-2', user: makeUser({ id: 'b' }) });
    const { result } = await renderAuth();

    await act(() => result.current.signIn('a@example.com', 'secret123'));
    await act(() => result.current.signOut());
    await act(() => result.current.signIn('b@example.com', 'secret123'));

    expect(mockedLogIn.mock.calls).toEqual([['a'], ['b']]);
  });
});
