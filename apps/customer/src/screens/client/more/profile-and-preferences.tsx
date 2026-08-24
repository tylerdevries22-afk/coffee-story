import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import { Alert, Platform, StyleSheet, Text, TextInput, View } from 'react-native';

import { ProfileAvatar } from '@/components/profile-avatar';
import { CollapsingScreen } from '@/components/collapsing-screen';
import { Body, Button, Card, SectionTitle } from '@/components/ui';
import { mobileApi } from '@/lib/mobile-api';
import { requestKey } from '@platform/domain';
import { STRENGTH_OPTIONS, strengthLabel } from '@/features/setup/setup';
import { useAuth } from '@/state/auth-context';
import { useDemo } from '@/state/demo-context';
import type { GuestPreferences, PortalProfile } from '@platform/domain';

import { useInformationStyles } from './information-page';
import { useTokens as useBrandTokens, type BrandTokens } from '@platform/ui';

const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

function avatarExtension(mimeType: string | null | undefined): 'jpg' | 'png' | 'webp' {
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'image/webp') return 'webp';
  return 'jpg';
}

async function webDemoAvatarDataUrl(sourceUri: string): Promise<string> {
  const image = new window.Image();
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('The selected photo could not be read.'));
    image.src = sourceUri;
  });
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('The selected photo could not be processed.');
  const sourceSize = Math.min(image.naturalWidth, image.naturalHeight);
  if (sourceSize <= 0) throw new Error('The selected photo has no readable dimensions.');
  context.drawImage(
    image,
    (image.naturalWidth - sourceSize) / 2,
    (image.naturalHeight - sourceSize) / 2,
    sourceSize,
    sourceSize,
    0,
    0,
    512,
    512,
  );
  return canvas.toDataURL('image/jpeg', 0.82);
}

async function durableDemoAvatarUri(
  asset: ImagePicker.ImagePickerAsset,
  previousAvatarUrl: string | null,
): Promise<string> {
  if (Platform.OS === 'web') return webDemoAvatarDataUrl(asset.uri);
  const { File, Paths } = await import('expo-file-system');
  const extension = avatarExtension(asset.mimeType);
  const destination = new File(Paths.document, `demo-profile-avatar-${Date.now()}.${extension}`);
  await new File(asset.uri).copy(destination);
  if (previousAvatarUrl?.startsWith(Paths.document.uri) && previousAvatarUrl.includes('demo-profile-avatar')) {
    const previous = new File(previousAvatarUrl);
    if (previous.exists) previous.delete();
  }
  for (const candidateExtension of ['jpg', 'png', 'webp'] as const) {
    const candidate = new File(Paths.document, `demo-profile-avatar.${candidateExtension}`);
    if (candidate.exists) candidate.delete();
  }
  return destination.uri;
}

export function Profile({
  onBack,
  onExit,
  onSignOut,
}: {
  onBack: () => void;
  onExit?: () => void;
  onSignOut?: () => void;
}) {
  const tokens = useBrandTokens();
  const profileStyles = createProfileStyles(tokens);
  const { portal, isDemo, refresh, role, signOut } = useAuth();
  const demo = useDemo();
  const [profile, setProfile] = useState<PortalProfile>(portal.profile);
  const [saving, setSaving] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function chooseProfilePhoto() {
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Photo access needed', 'Allow photo access to choose a profile picture.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.82,
      });
      const asset = result.canceled ? null : result.assets[0];
      if (!asset) return;
      if (asset.fileSize && asset.fileSize > MAX_AVATAR_BYTES) {
        Alert.alert('Photo too large', 'Choose a profile photo smaller than 5 MB.');
        return;
      }

      setUploadingPhoto(true);
      if (isDemo) {
        const avatarUrl = await durableDemoAvatarUri(asset, portal.profile.avatarUrl);
        demo.updateProfile({ ...portal.profile, avatarUrl });
        setProfile((current) => ({ ...current, avatarUrl }));
      } else {
        const localResponse = await fetch(asset.uri);
        if (!localResponse.ok) throw new Error('The selected photo could not be read.');
        const photo = await localResponse.blob();
        if (photo.size > MAX_AVATAR_BYTES) throw new Error('Choose a profile photo smaller than 5 MB.');
        const declaredMime = asset.mimeType === 'image/jpg' ? 'image/jpeg' : asset.mimeType;
        const response = await mobileApi.uploadProfileAvatar(
          photo,
          declaredMime || photo.type || 'image/jpeg',
          `profile-avatar-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        );
        setProfile((current) => ({ ...current, avatarUrl: response.profile.avatarUrl }));
        await refresh();
      }
      Alert.alert('Profile photo saved', isDemo
        ? 'Your photo is saved in this preview.'
        : 'Your photo now appears in every portal.');
    } catch (error) {
      Alert.alert('Photo not saved', error instanceof Error ? error.message : 'Try again later.');
    } finally {
      setUploadingPhoto(false);
    }
  }

  async function saveProfile() {
    if (!profile.fullName.trim()) {
      Alert.alert('Name required', 'Enter your full name before saving.');
      return;
    }
    setSaving(true);
    try {
      if (isDemo) {
        demo.updateProfile(profile);
      } else {
        await mobileApi.updateProfile({
          fullName: profile.fullName,
          phone: profile.phone,
          birthday: profile.birthday,
        }, `profile-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);
        await refresh();
      }
      Alert.alert('Profile saved', 'Your account details are up to date.');
    } catch (error) {
      Alert.alert('Profile not saved', error instanceof Error ? error.message : 'Try again later.');
    } finally {
      setSaving(false);
    }
  }

  async function deleteAccount() {
    setDeleting(true);
    try {
      await mobileApi.deleteProfile();
      await signOut();
    } catch (error) {
      Alert.alert('Account not deleted', error instanceof Error ? error.message : 'Try again later.');
      setDeleting(false);
    }
  }

  function confirmAccountDeletion() {
    Alert.alert(
      'Delete account?',
      'This permanently removes your sign-in and personal details. Order history stays anonymized for shop records.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete account', style: 'destructive', onPress: () => void deleteAccount() },
      ],
    );
  }
  return (
    <CollapsingScreen title="Profile" eyebrow="My account" onBack={onBack} keyboardShouldPersistTaps="handled">
      <View style={profileStyles.avatarHeader}>
        <ProfileAvatar
          name={profile.fullName || 'Oasis member'}
          avatarUrl={profile.avatarUrl}
          size={104}
          editable={!uploadingPhoto}
          onEdit={() => void chooseProfilePhoto()}
        />
        <View style={profileStyles.avatarCopy}>
          <Text numberOfLines={2} style={profileStyles.profileName}>{profile.fullName || 'Oasis member'}</Text>
          <Body muted>{role === 'admin' ? 'Owner profile' : role === 'staff' ? 'Team member profile' : 'Oasis member profile'}</Body>
          <Button
            label={uploadingPhoto ? 'Uploading…' : 'Choose profile photo'}
            variant="soft"
            disabled={uploadingPhoto}
            onPress={() => void chooseProfilePhoto()}
          />
        </View>
      </View>
      <Field label="Full name" value={profile.fullName} onChangeText={(fullName) => setProfile({ ...profile, fullName })} />
      <Field label="Email" value={profile.email} editable={false} />
      <Body muted>Contact support to change the email used for secure sign in.</Body>
      <Field label="Phone" value={profile.phone ?? ''} keyboardType="phone-pad" onChangeText={(phone) => setProfile({ ...profile, phone })} />
      <Field label="Birthday" value={profile.birthday ?? ''} placeholder="YYYY-MM-DD" onChangeText={(birthday) => setProfile({ ...profile, birthday })} />
      <Button label="Save profile" loading={saving} onPress={() => void saveProfile()} />
      {!isDemo && role === 'client' ? (
        <Card style={profileStyles.accessCard}>
          <SectionTitle>Delete account</SectionTitle>
          <Body muted>Your personal details and sign-in will be removed. An anonymized order record remains with the shop.</Body>
          <Button
            label="Delete my account"
            variant="secondary"
            loading={deleting}
            disabled={deleting}
            onPress={confirmAccountDeletion}
          />
        </Card>
      ) : null}
      {role !== 'client' ? (
        <Card style={profileStyles.accessCard}>
          <SectionTitle>Workspace access</SectionTitle>
          <Body muted>{role === 'admin'
            ? 'Owner permissions include business settings, reports, staff, and all operations.'
            : 'Team member permissions include schedule, clients, checkout, and reviews.'}</Body>
          {onExit ? <Button label="Return to client app" variant="secondary" onPress={onExit} /> : null}
          {onSignOut ? <Button label="Sign out" variant="soft" onPress={onSignOut} /> : null}
        </Card>
      ) : null}
    </CollapsingScreen>
  );
}

export function Preferences({ onBack }: { onBack: () => void }) {
  const styles = useInformationStyles();
  const { portal, isDemo, refresh } = useAuth();
  const demo = useDemo();
  const initial: GuestPreferences = portal.preferences
    ?? { completed: false, notes: '', strength: 'medium', updatedAt: null };
  const [preferences, setPreferences] = useState(initial);
  const [saving, setSaving] = useState(false);

  async function persist() {
    setSaving(true);
    try {
      const next = { ...preferences, completed: true, updatedAt: new Date().toISOString() };
      if (isDemo) {
        demo.updatePreferences(next);
      } else {
        const idempotencyKey = requestKey('preferences');
        // Only the fields the server accepts. The previous shape posted the
        // local-only `completed` and `updatedAt` too and was rejected 400 every
        // time; a Pick<> does not prevent that, because it is erased at runtime
        // and TypeScript skips excess-property checks on a variable.
        await mobileApi.updatePreferences({ notes: next.notes, strength: next.strength }, idempotencyKey);
        await refresh();
      }
      setPreferences(next);
      Alert.alert('Saved', 'The bar can see how you take your coffee.');
    } catch (error) {
      Alert.alert('Not saved', error instanceof Error ? error.message : 'Try again later.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <CollapsingScreen title="My usual" eyebrow="Saved for next time" onBack={onBack} keyboardShouldPersistTaps="handled">
      <Field
        label="What should the bar know?"
        value={preferences.notes}
        multiline
        onChangeText={(notes) => setPreferences({ ...preferences, notes })}
      />
      <SectionTitle>Coffee strength</SectionTitle>
      <View style={styles.options}>{STRENGTH_OPTIONS.map((strength) => (
        <Button
          key={strength}
          label={strengthLabel(strength)}
          variant={preferences.strength === strength ? 'primary' : 'secondary'}
          style={styles.option}
          onPress={() => setPreferences({ ...preferences, strength })}
        />
      ))}</View>
      <Button label="Save" loading={saving} disabled={saving} onPress={() => void persist()} />
    </CollapsingScreen>
  );
}
export function Field({ label, ...props }: React.ComponentProps<typeof TextInput> & { label: string }) {
  const styles = useInformationStyles();
  const tokens = useBrandTokens();
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput accessibilityLabel={`${label} input`} {...props} placeholderTextColor={tokens.textMuted} style={[styles.input, props.multiline && styles.multiline]} />
    </View>
  );
}

const createProfileStyles = (tokens: BrandTokens) => StyleSheet.create({
  avatarHeader: { flexDirection: 'row', alignItems: 'center', gap: tokens.spacing.xl, paddingVertical: tokens.spacing.md },
  avatarCopy: { flex: 1, gap: tokens.spacing.sm },
  profileName: { color: tokens.textPrimary, fontFamily: tokens.fontDisplay, fontSize: 25, lineHeight: 30 },
  accessCard: { gap: tokens.spacing.lg },
});
