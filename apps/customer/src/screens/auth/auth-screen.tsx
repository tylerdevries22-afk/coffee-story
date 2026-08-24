import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Body, Button, Card, Eyebrow, Screen, Title } from '@/components/ui';
import { BUSINESS } from '@/data/business';
import { isValidOtpCode, normalizePhone } from '@/features/auth/phone';
import { POINTS_LABEL } from '@/features/rewards/presentation';
import { useAuth } from '@/state/auth-context';
import { useDemo } from '@/state/demo-context';
import { useTokens as useBrandTokens, type BrandTokens } from '@platform/ui';

type AuthView = 'sign-in' | 'create' | 'reset' | 'phone' | 'phone-code' | 'email-code' | 'email-code-verify';

export function AuthScreen() {
  const tokens = useBrandTokens();
  const styles = createStyles(tokens);
  const { signIn, signInWithEmailOtp, signInWithPhone, signUp, requestPasswordReset, verifyEmailCode, verifyPhoneCode } = useAuth();
  const { chooseDemo } = useDemo();
  const [view, setView] = useState<AuthView>('sign-in');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function resendCode() {
    setError(null);
    setOtpCode('');
    setLoading(true);
    try {
      if (view === 'email-code-verify') {
        await signInWithEmailOtp(email);
      } else {
        const normalized = normalizePhone(phone);
        if (!normalized) return;
        await signInWithPhone(normalized);
      }
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'The code could not be sent.');
    } finally {
      setLoading(false);
    }
  }

  async function submit() {
    setError(null);
    if (view === 'email-code' || view === 'email-code-verify') {
      if (!email.includes('@')) {
        setError('Enter a valid email address.');
        return;
      }
      setLoading(true);
      try {
        if (view === 'email-code') {
          await signInWithEmailOtp(email);
          setOtpCode('');
          setView('email-code-verify');
        } else {
          if (!isValidOtpCode(otpCode)) throw new Error('Enter the six-digit code from the email.');
          await verifyEmailCode(email, otpCode.trim());
        }
      } catch (submitError) {
        setError(submitError instanceof Error ? submitError.message : 'The request could not be completed.');
      } finally {
        setLoading(false);
      }
      return;
    }
    if (view === 'phone' || view === 'phone-code') {
      const normalized = normalizePhone(phone);
      if (!normalized) {
        setError('Enter your phone number with area code.');
        return;
      }
      setLoading(true);
      try {
        if (view === 'phone') {
          await signInWithPhone(normalized);
          setView('phone-code');
        } else {
          if (!isValidOtpCode(otpCode)) throw new Error('Enter the six-digit code from the text.');
          await verifyPhoneCode(normalized, otpCode.trim());
        }
      } catch (submitError) {
        setError(submitError instanceof Error ? submitError.message : 'The request could not be completed.');
      } finally {
        setLoading(false);
      }
      return;
    }
    if (!email.includes('@')) {
      setError('Enter a valid email address.');
      return;
    }
    if (view !== 'reset' && password.length < 8) {
      setError('Use at least eight characters for your password.');
      return;
    }
    setLoading(true);
    try {
      if (view === 'sign-in') await signIn(email, password);
      if (view === 'create') {
        if (fullName.trim().length < 2) throw new Error('Enter your full name.');
        await signUp(fullName, email, password);
        Alert.alert('Check your email', 'Confirm your email address to finish creating your account.');
      }
      if (view === 'reset') {
        await requestPasswordReset(email);
        Alert.alert('Reset link sent', 'Check your inbox for a secure password-reset link.');
        setView('sign-in');
      }
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'The request could not be completed.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Screen keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
      <View style={styles.intro}>
        <Eyebrow>{BUSINESS.legalName}</Eyebrow>
        <Title>
          {view === 'create' ? 'Start your story.'
            : view === 'reset' ? 'Reset your password.'
            : view === 'phone' ? 'Sign in with your phone.'
            : view === 'phone-code' ? 'Enter the code we texted.'
            : view === 'email-code' ? 'Sign in with your email.'
            : view === 'email-code-verify' ? 'Enter the code we emailed.'
            : 'Welcome back.'}
        </Title>
        <Body muted>Order ahead, gifts, {POINTS_LABEL} rewards, and your favorites in one place. {BUSINESS.tagline}.</Body>
      </View>
      <Card style={styles.form}>
        {view === 'create' ? <Field label="Full name" value={fullName} onChangeText={setFullName} autoComplete="name" /> : null}
        {view === 'phone' || view === 'phone-code' ? (
          <Field
            label="Phone number"
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
            autoComplete="tel"
            editable={view === 'phone'}
          />
        ) : (
          <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" />
        )}
        {view === 'phone-code' || view === 'email-code-verify' ? (
          <Field label="Six-digit code" value={otpCode} onChangeText={setOtpCode} keyboardType="number-pad" autoComplete={view === 'phone-code' ? 'sms-otp' : 'one-time-code'} />
        ) : null}
        {view === 'sign-in' || view === 'create' ? (
          <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete={view === 'create' ? 'new-password' : 'current-password'} />
        ) : null}
        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
        <Button
          label={view === 'create' ? 'Create account'
            : view === 'reset' ? 'Send reset link'
            : view === 'phone' ? 'Text me a code'
            : view === 'email-code' ? 'Email me a code'
            : view === 'phone-code' || view === 'email-code-verify' ? 'Verify and sign in'
            : 'Sign in'}
          loading={loading}
          onPress={() => void submit()}
        />
      </Card>
      <View style={styles.links}>
        {view !== 'sign-in' ? <AuthLink label="Back to sign in" onPress={() => { setError(null); setView('sign-in'); }} /> : null}
        {view === 'sign-in' ? <AuthLink label="Email me a sign-in code instead" onPress={() => { setError(null); setView('email-code'); }} /> : null}
        {view === 'sign-in' ? <AuthLink label="Sign in with phone instead" onPress={() => { setError(null); setView('phone'); }} /> : null}
        {view === 'phone-code' || view === 'email-code-verify' ? <AuthLink label="Send a new code" onPress={() => void resendCode()} /> : null}
        {view === 'sign-in' ? <AuthLink label="Create an account" onPress={() => setView('create')} /> : null}
        {view === 'sign-in' ? <AuthLink label="Forgot password?" onPress={() => setView('reset')} /> : null}
      </View>
      <Button
        label="Preview the complete Demo"
        variant="secondary"
        onPress={() => void chooseDemo()}
      />
    </Screen>
  );
}

export function PasswordRecoveryScreen() {
  const tokens = useBrandTokens();
  const styles = createStyles(tokens);
  const { updatePassword } = useAuth();
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setError(null);
    if (password.length < 8) {
      setError('Use at least eight characters for your new password.');
      return;
    }
    if (password !== confirmation) {
      setError('The two passwords do not match.');
      return;
    }
    setLoading(true);
    try {
      await updatePassword(password);
      Alert.alert('Password updated', 'Your account is secure and ready to use.');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Your password could not be updated.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Screen keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
      <View style={styles.intro}>
        <Eyebrow>Secure recovery</Eyebrow>
        <Title>Choose a new password.</Title>
        <Body muted>Your reset link has been verified.</Body>
      </View>
      <Card style={styles.form}>
        <Field label="New password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="new-password" />
        <Field label="Confirm password" value={confirmation} onChangeText={setConfirmation} secureTextEntry autoComplete="new-password" />
        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
        <Button label="Update password" loading={loading} onPress={() => void save()} />
      </Card>
    </Screen>
  );
}

function Field({ label, ...props }: React.ComponentProps<typeof TextInput> & { label: string }) {
  const tokens = useBrandTokens();
  const styles = createStyles(tokens);
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput accessibilityLabel={label} {...props} placeholderTextColor={tokens.textMuted} style={styles.input} />
    </View>
  );
}

function AuthLink({ label, onPress }: { label: string; onPress: () => void }) {
  const tokens = useBrandTokens();
  const styles = createStyles(tokens);
  return (
    <Pressable
      accessibilityRole="button"
      hitSlop={4}
      onPress={onPress}
      style={({ pressed }) => [styles.linkButton, pressed && styles.pressed]}
    >
      <Text style={styles.link}>{label}</Text>
    </Pressable>
  );
}

const createStyles = (tokens: BrandTokens) => StyleSheet.create({
  content: { flexGrow: 1, justifyContent: 'center', paddingBottom: tokens.spacing.xxl },
  intro: { gap: tokens.spacing.md, marginBottom: tokens.spacing.lg },
  form: { gap: tokens.spacing.lg },
  field: { gap: tokens.spacing.md },
  label: { color: tokens.textPrimary, fontFamily: tokens.fontBody, fontSize: 14 },
  input: { minHeight: 56, borderRadius: tokens.radius.lg, borderWidth: 1, borderColor: tokens.textMuted, paddingHorizontal: tokens.spacing.lg, backgroundColor: tokens.surfaceElevated, color: tokens.textPrimary, fontFamily: tokens.fontBody, fontSize: 16 },
  error: { color: tokens.danger, fontFamily: tokens.fontBody, fontSize: 13, lineHeight: 19 },
  links: { alignItems: 'center', gap: tokens.spacing.lg },
  linkButton: { minHeight: 44, justifyContent: 'center', paddingHorizontal: tokens.spacing.lg },
  link: { color: tokens.primary, fontFamily: tokens.fontBody, fontSize: 14 },
  pressed: { opacity: 0.72 },
});
