import { useState } from 'react';
import { Alert, Text, View } from 'react-native';

import { BUSINESS } from '@/data/business';
import { CollapsingScreen } from '@/components/collapsing-screen';
import { Body, Button } from '@/components/ui';
import { mobileApi } from '@/lib/mobile-api';
import { useAuth } from '@/state/auth-context';
import { useDemo } from '@/state/demo-context';

import { styles } from './information-page';
import { Field } from './profile-and-intake';

export function Messages({ onBack }: { onBack: () => void }) {
  const { portal, isDemo, refresh } = useAuth();
  const demo = useDemo();
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  async function send() {
    const normalized = body.trim();
    if (!normalized) return;
    setSending(true);
    try {
      if (isDemo) demo.sendMessage(normalized);
      else {
        await mobileApi.sendMessage(
          normalized,
          `message-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        );
        await refresh();
      }
      setBody('');
    } catch (error) {
      Alert.alert('Message not sent', error instanceof Error ? error.message : 'Try again later.');
    } finally {
      setSending(false);
    }
  }
  return (
    <CollapsingScreen title="Messages" eyebrow="Private conversation" onBack={onBack} keyboardShouldPersistTaps="handled">
      {(portal.messages ?? []).map((message) => (
        <View key={message.id} style={[styles.message, message.sender === 'client' && styles.myMessage]}>
          <Text style={styles.messageSender}>{message.sender === 'client' ? 'You' : BUSINESS.name}</Text>
          <Body>{message.body}</Body>
        </View>
      ))}
      <Field label="New message" value={body} multiline placeholder="How can we help?" onChangeText={setBody} />
      <Button label="Send message" loading={sending} disabled={!body.trim()} onPress={() => void send()} />
    </CollapsingScreen>
  );
}
