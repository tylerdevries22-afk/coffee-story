import { useState } from 'react';
import { Alert, Text, View } from 'react-native';

import { Body, Button, Card, Eyebrow, Screen, Title } from '@/components/ui';
import { useAuth } from '@/state/auth-context';
import { useTokens as useBrandTokens } from '@platform/ui';

import { AuthField, createAuthStyles } from './auth-screen-ui';

export function PasswordRecoveryScreen() {
  const styles = createAuthStyles(useBrandTokens());
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
        <AuthField label="New password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="new-password" />
        <AuthField label="Confirm password" value={confirmation} onChangeText={setConfirmation} secureTextEntry autoComplete="new-password" />
        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
        <Button label="Update password" loading={loading} onPress={() => void save()} />
      </Card>
    </Screen>
  );
}
