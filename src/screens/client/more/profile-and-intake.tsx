import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import { Alert, Platform, StyleSheet, Text, TextInput, View } from 'react-native';

import { ProfileAvatar } from '@/components/profile-avatar';
import { CollapsingScreen } from '@/components/collapsing-screen';
import { Body, Button, Card, SectionTitle } from '@/components/ui';
import { mobileApi } from '@/lib/mobile-api';
import { useAuth } from '@/state/auth-context';
import { useDemo } from '@/state/demo-context';
import { colors, fonts, spacing } from '@/theme/tokens';
import type { IntakeProfile, PortalProfile } from '@/types/domain';

import { styles } from './information-page';

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
  const { portal, isDemo, refresh, role } = useAuth();
  const demo = useDemo();
  const [profile, setProfile] = useState<PortalProfile>(portal.profile);
  const [saving, setSaving] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

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

export function Intake({ onBack }: { onBack: () => void }) {
  const { portal, isDemo, refresh } = useAuth();
  const demo = useDemo();
  const initial: IntakeProfile = portal.intake ?? { completed: false, concerns: '', pressurePreference: 'medium', consentAccepted: false, updatedAt: null };
  const [intake, setIntake] = useState(initial);
  const [saving, setSaving] = useState<'draft' | 'submit' | null>(null);
  async function persistIntake(submit: boolean) {
    if (submit && !intake.consentAccepted) {
      Alert.alert('Consent required', 'Review and accept the care consent before submitting.');
      return;
    }
    setSaving(submit ? 'submit' : 'draft');
    try {
      const next = {
        ...intake,
        completed: submit ? true : intake.completed,
        updatedAt: new Date().toISOString(),
      };
      if (isDemo) {
        demo.updateIntake(next);
      } else {
        const idempotencyKey = `intake-${submit ? 'submit' : 'draft'}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
        // Send ONLY the three fields the server contract accepts. /api/mobile/intake
        // parses with a `.strict()` zod schema, so posting `next` verbatim -- which
        // also carries the local-only `completed` and `updatedAt` -- was rejected
        // with 400 every time, making live intake impossible to save or submit.
        // The `Pick<>` on mobileApi.submitIntake does not protect against this:
        // it is erased at runtime and TypeScript skips excess-property checking
        // for a variable, so the extra keys reached JSON.stringify unnoticed.
        const contractPayload = {
          concerns: next.concerns,
          pressurePreference: next.pressurePreference,
          consentAccepted: next.consentAccepted,
        };
        if (submit) await mobileApi.submitIntake(contractPayload, idempotencyKey);
        else await mobileApi.updateIntake(contractPayload, idempotencyKey);
        await refresh();
      }
      Alert.alert(submit ? 'Intake submitted' : 'Draft saved', submit
        ? 'The bar can now see how you take your coffee.'
        : 'Your private answers were saved.');
    } catch (error) {
      Alert.alert('Intake not saved', error instanceof Error ? error.message : 'Try again later.');
    } finally {
      setSaving(null);
    }
  }
  return (
    <CollapsingScreen title="Intake & consent" eyebrow="Private care profile" onBack={onBack} keyboardShouldPersistTaps="handled">
      <Field label="What should the bar know?" value={intake.concerns} multiline onChangeText={(concerns) => setIntake({ ...intake, concerns })} />
      <SectionTitle>Pressure preference</SectionTitle>
      <View style={styles.options}>{(['light', 'medium', 'firm'] as const).map((pressure) => (
        <Button key={pressure} label={pressure} variant={intake.pressurePreference === pressure ? 'primary' : 'secondary'} style={styles.option} onPress={() => setIntake({ ...intake, pressurePreference: pressure })} />
      ))}</View>
      <Button label={intake.consentAccepted ? 'Consent accepted' : 'Review and accept consent'} variant="secondary" onPress={() => setIntake({ ...intake, consentAccepted: true })} />
      <Button label="Save draft" variant="secondary" loading={saving === 'draft'} disabled={saving !== null} onPress={() => void persistIntake(false)} />
      <Button label="Submit intake" loading={saving === 'submit'} disabled={saving !== null} onPress={() => void persistIntake(true)} />
    </CollapsingScreen>
  );
}

export function Field({ label, ...props }: React.ComponentProps<typeof TextInput> & { label: string }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput accessibilityLabel={`${label} input`} {...props} placeholderTextColor={colors.ink400} style={[styles.input, props.multiline && styles.multiline]} />
    </View>
  );
}

const profileStyles = StyleSheet.create({
  avatarHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg, paddingVertical: spacing.sm },
  avatarCopy: { flex: 1, gap: spacing.xs },
  profileName: { color: colors.ink900, fontFamily: fonts.display, fontSize: 25, lineHeight: 30 },
  accessCard: { gap: spacing.md },
});
