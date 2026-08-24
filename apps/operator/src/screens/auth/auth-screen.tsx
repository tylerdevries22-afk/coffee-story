import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Body, Button, Card, Eyebrow, Screen, Title } from '@/components/ui';
import { useAuth } from '@/state/auth-context';
import { useDemo } from '@/state/demo-context';
import { useTokens as useBrandTokens, type BrandTokens } from '@platform/ui';

/**
 * No 'create' view. Tenancy in this app is by login (rule 7): a barista's
 * account is made by the owner in the HQ console, which is also what writes
 * the brand_users row the claims hook reads. Self-service sign-up here only
 * ever produced an account with no brand and no role — a dead end for the
 * person who tried it, and an account nobody asked for on the platform.
 */
type AuthView = 'sign-in' | 'reset';

export function AuthScreen() {
  const tokens = useBrandTokens();
  const styles = createStyles(tokens);
  const { signIn, requestPasswordReset } = useAuth();
  const { chooseDemo } = useDemo();
  const [view, setView] = useState<AuthView>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
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
        <Eyebrow>Staff operations</Eyebrow>
        <Title>{view === 'reset' ? 'Reset your password.' : 'Welcome back.'}</Title>
        <Body muted>The order board, the day&rsquo;s numbers, and the menu — sign in with your staff account.</Body>
      </View>
      <Card style={styles.form}>
        <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" />
        {view !== 'reset' ? <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="current-password" /> : null}
        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
        <Button
          label={view === 'reset' ? 'Send reset link' : 'Sign in'}
          loading={loading}
          onPress={() => void submit()}
        />
      </Card>
      <View style={styles.links}>
        {view !== 'sign-in' ? <AuthLink label="Back to sign in" onPress={() => setView('sign-in')} /> : null}
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
