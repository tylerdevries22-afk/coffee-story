import { useState } from 'react';
import { Alert, Text, View } from 'react-native';

import { Body, Button, Card, Eyebrow, Screen, Title } from '@/components/ui';
import { BUSINESS } from '@/data/business';
import { isValidOtpCode, normalizePhone } from '@/features/auth/phone';
import { POINTS_LABEL } from '@/features/rewards/presentation';
import { useAuth } from '@/state/auth-context';
import { useDemo } from '@/state/demo-context';
import { useTokens as useBrandTokens } from '@platform/ui';

import { AuthField as Field, AuthLink, createAuthStyles } from './auth-screen-ui';

export { PasswordRecoveryScreen } from './password-recovery-screen';

type AuthView = 'sign-in' | 'create' | 'reset' | 'phone' | 'phone-code' | 'email-code' | 'email-code-verify';

export function AuthScreen() {
  const tokens = useBrandTokens();
  const styles = createAuthStyles(tokens);
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
