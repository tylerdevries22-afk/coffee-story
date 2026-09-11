import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import { Alert, Text, View } from 'react-native';

import { ProfileAvatar } from '@/components/profile-avatar';
import { CollapsingScreen } from '@/components/collapsing-screen';
import { Body, Button } from '@/components/ui';
import { mobileApi } from '@/lib/mobile-api';
import { downloadMyData as requestMyDataExport } from './download-my-data';
import { useAuth } from '@/state/auth-context';
import { useDemo } from '@/state/demo-context';
import type { PortalProfile } from '@platform/domain';
import { useTokens as useBrandTokens } from '@platform/ui';

import { Field } from './preferences-screen';
import { ClientDataCard, WorkspaceAccessCard } from './profile-account-cards';
import { createProfileStyles } from './profile-screen.styles';
import { durableDemoAvatarUri, MAX_AVATAR_BYTES } from './profile-avatar-storage';

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
  const [exporting, setExporting] = useState(false);

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

  
  async function downloadMyData() {
    setExporting(true);
    try {
      await requestMyDataExport();
    } catch (error) {
      Alert.alert('Export unavailable', error instanceof Error ? error.message : 'Try again later.');
    } finally {
      setExporting(false);
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
        <ClientDataCard
          accessCardStyle={profileStyles.accessCard}
          exporting={exporting}
          deleting={deleting}
          onDownload={() => void downloadMyData()}
          onDelete={confirmAccountDeletion}
        />
      ) : null}
      {role !== 'client' ? (
        <WorkspaceAccessCard
          accessCardStyle={profileStyles.accessCard}
          role={role}
          onExit={onExit}
          onSignOut={onSignOut}
        />
      ) : null}
    </CollapsingScreen>
  );
}


export { Field, Preferences } from './preferences-screen';
