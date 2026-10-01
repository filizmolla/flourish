import { zodResolver } from '@hookform/resolvers/zod';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { useAuth } from '../auth/AuthContext';
import { useKeyboardShown } from '../hooks/useKeyboardShown';
import { LoginFormValues, loginSchema } from '../auth/loginSchema';
import FormTextInput from '../components/FormTextInput';
import { AuthStackParamList, Screens } from '../navigation/types';
import { strings } from '../strings';
import { colors } from '../theme';
import { authFormStyles as styles } from './authFormStyles';

type Props = NativeStackScreenProps<AuthStackParamList, Screens.Login>;

export default function LoginScreen({ navigation }: Props) {
  const { signIn } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const {
    control,
    handleSubmit,
    formState: { isSubmitting, isValid },
  } = useForm<LoginFormValues>({
    defaultValues: { email: '', password: '' },
    resolver: zodResolver(loginSchema),
    mode: 'onChange',
  });

  const onSubmit = async ({ email, password }: LoginFormValues) => {
    setError(null);
    try {
      await signIn(email, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : strings.login.failed);
    }
  };

  const keyboardShown = useKeyboardShown();

  return (
    // Edge-to-edge ignores adjustResize, so the screen shrinks by the
    // keyboard's height itself. With the keyboard up the form sits just
    // above it instead of re-centering, so it moves only as far as needed.
    <KeyboardAvoidingView style={styles.keyboard} behavior="padding">
      <ScrollView
        style={styles.screen}
        contentContainerStyle={[
          styles.container,
          keyboardShown && styles.containerAboveKeyboard,
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          {/* Decorative: the app name below says the same. */}
          <Image
            testID="auth-logo"
            source={require('../assets/logo.png')}
            style={styles.logo}
            accessible={false}
            importantForAccessibility="no"
          />
          <Text style={styles.kicker}>{strings.appName.toUpperCase()}</Text>
          <Text accessibilityRole="header" style={styles.title}>
            {strings.login.title}
          </Text>
          <Text style={styles.subhead}>{strings.login.subhead}</Text>
        </View>

        <FormTextInput
          control={control}
          name="email"
          testID="login-email-input"
          errorTestID="login-email-error-text"
          placeholder={strings.login.emailPlaceholder}
          autoCapitalize="none"
          keyboardType="email-address"
          autoComplete="email"
        />

        <FormTextInput
          control={control}
          name="password"
          testID="login-password-input"
          errorTestID="login-password-error-text"
          placeholder={strings.login.passwordPlaceholder}
          secureTextEntry
          autoComplete="password"
        />

        {error ? (
          <Text testID="login-error-text" style={styles.error}>
            {error}
          </Text>
        ) : null}

        <Pressable
          testID="login-submit-button"
          style={[
            styles.button,
            (isSubmitting || !isValid) && styles.buttonDisabled,
          ]}
          onPress={() => handleSubmit(onSubmit)()}
          disabled={isSubmitting || !isValid}
        >
          {isSubmitting ? (
            <ActivityIndicator color={colors.card} />
          ) : (
            <Text style={styles.buttonText}>{strings.login.submit}</Text>
          )}
        </Pressable>

        <Pressable
          testID="login-register-link"
          style={styles.switchLink}
          onPress={() => navigation.navigate(Screens.Register)}
        >
          <Text style={styles.switchLinkText}>
            {strings.login.registerLinkQuestion}{' '}
            <Text style={styles.switchLinkAction}>
              {strings.login.registerLinkAction}
            </Text>
          </Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
