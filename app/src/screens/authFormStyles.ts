import { StyleSheet } from 'react-native';
import { colors, fonts } from '../theme';

// Shared layout for the signed-out screens (Login, Register), in the same
// look as the recipe list header.
export const authFormStyles = StyleSheet.create({
  keyboard: {
    flex: 1,
    backgroundColor: colors.paper,
  },
  screen: {
    backgroundColor: colors.paper,
  },
  container: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 24,
    gap: 12,
    backgroundColor: colors.paper,
  },
  containerAboveKeyboard: {
    justifyContent: 'flex-end',
  },
  header: {
    marginBottom: 12,
  },
  // The flower-on-a-plate mark above the app name.
  logo: {
    width: 72,
    height: 72,
    marginBottom: 12,
  },
  kicker: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 2,
    color: colors.accent,
  },
  title: {
    fontFamily: fonts.serif,
    fontSize: 30,
    lineHeight: 37,
    color: colors.ink,
    marginTop: 8,
  },
  subhead: {
    fontFamily: fonts.serif,
    fontStyle: 'italic',
    fontSize: 15,
    lineHeight: 21,
    color: colors.inkMuted,
    marginTop: 8,
  },
  error: {
    color: colors.danger,
  },
  button: {
    minHeight: 48,
    borderRadius: 999,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    color: colors.card,
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  switchLink: {
    alignSelf: 'center',
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  switchLinkText: {
    color: colors.inkMuted,
    fontSize: 15,
  },
  switchLinkAction: {
    color: colors.accent,
    fontWeight: '700',
  },
});
