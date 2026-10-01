// Where sign-in stands; RootNavigator shows the auth or the app screens.
// Its own module so tests can mock AuthContext and still use the values.
export enum AuthStatus {
  Loading = 'loading',
  SignedIn = 'signedIn',
  SignedOut = 'signedOut',
}
