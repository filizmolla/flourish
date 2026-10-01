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
import { RegisterFormValues, registerSchema } from '../auth/registerSchema';
import FormTextInput from '../components/FormTextInput';
import { AuthStackParamList, Screens } from '../navigation/types';
import { strings } from '../strings';
import { colors } from '../theme';
import { authFormStyles as styles } from './authFormStyles';

type Props = NativeStackScreenProps<AuthStackParamList, Screens.Register>;

export default function RegisterScreen({ navigation }: Props) {
  const { signUp } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const {
    control,
    handleSubmit,
    formState: { isSubmitting, isValid },
  } = useForm<RegisterFormValues>({
    defaultValues: { name: '', email: '', password: '', confirmPassword: '' },
    resolver: zodResolver(registerSchema),
    mode: 'onChange',
  });

  // A successful sign-up starts a session, so RootNavigator swaps to the
  // signed-in stack on its own — no navigation needed here.
  const onSubmit = async ({ name, email, password }: RegisterFormValues) => {
    setError(null);
    try {
      await signUp(name, email, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : strings.register.failed);
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
            {strings.register.title}
          </Text>
          <Text style={styles.subhead}>{strings.register.subhead}</Text>
        </View>

        <FormTextInput
          control={control}
          name="name"
          testID="register-name-input"
          errorTestID="register-name-error-text"
          placeholder={strings.register.namePlaceholder}
          autoCapitalize="words"
          autoComplete="name"
        />

        <FormTextInput
          control={control}
          name="email"
          testID="register-email-input"
          errorTestID="register-email-error-text"
          placeholder={strings.register.emailPlaceholder}
          autoCapitalize="none"
          keyboardType="email-address"
          autoComplete="email"
        />

        <FormTextInput
          control={control}
          name="password"
          testID="register-password-input"
          errorTestID="register-password-error-text"
          placeholder={strings.register.passwordPlaceholder}
          secureTextEntry
          autoComplete="new-password"
        />

        <FormTextInput
          control={control}
          name="confirmPassword"
          testID="register-confirm-password-input"
          errorTestID="register-confirm-password-error-text"
          placeholder={strings.register.confirmPasswordPlaceholder}
          secureTextEntry
          autoComplete="new-password"
        />

        {error ? (
          <Text testID="register-error-text" style={styles.error}>
            {error}
          </Text>
        ) : null}

        <Pressable
          testID="register-submit-button"
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
            <Text style={styles.buttonText}>{strings.register.submit}</Text>
          )}
        </Pressable>

        <Pressable
          testID="register-login-link"
          style={styles.switchLink}
          onPress={() => navigation.navigate(Screens.Login)}
        >
          <Text style={styles.switchLinkText}>
            {strings.register.loginLinkQuestion}{' '}
            <Text style={styles.switchLinkAction}>
              {strings.register.loginLinkAction}
            </Text>
          </Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
