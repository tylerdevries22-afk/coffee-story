import Constants from 'expo-constants';
import { useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';

import { CollapsingScreen } from '@/components/collapsing-screen';
import { Body, Button, Card, Segmented } from '@/components/ui';
import { appointmentToBookingService } from '@/features/booking/appointment-to-booking-service';
import { requestKey } from '@/features/booking/request-key';
import { mobileApi } from '@/lib/mobile-api';
import { addAppointmentToCalendar } from '@/lib/native-adapters';
import { useAuth } from '@/state/auth-context';
import { useDemo } from '@/state/demo-context';
import type { PortalAppointment } from '@/types/domain';
import { choiceState } from '@/lib/a11y-state';

import { styles } from './information-page';
import { Field } from './profile-and-intake';

export function Visits({ onBack, onBook }: { onBack: () => void; onBook: () => void }) {
  const { portal, isDemo, refresh } = useAuth();
  const demo = useDemo();
  const [tab, setTab] = useState<'Upcoming' | 'Past'>('Upcoming');
  const [referenceTime] = useState(() => Date.now());
  const visits = portal.appointments.filter((appointment) => (
    tab === 'Upcoming'
      ? new Date(appointment.startsAt).getTime() >= referenceTime && appointment.status !== 'cancelled'
      : new Date(appointment.startsAt).getTime() < referenceTime || ['completed', 'cancelled', 'no_show'].includes(appointment.status)
  ));

  return (
    <CollapsingScreen title="Orders" eyebrow="My account" onBack={onBack}>
      <Segmented options={['Upcoming', 'Past'] as const} value={tab} onChange={setTab} />
      {visits.map((appointment) => (
        <AppointmentCard
          key={appointment.id}
          appointment={appointment}
          isDemo={isDemo}
          upcoming={new Date(appointment.startsAt).getTime() >= referenceTime
            && appointment.status !== 'cancelled'}
          onCancel={async () => {
            if (isDemo) demo.cancelAppointment(appointment.id);
            else {
              await mobileApi.cancelAppointment(appointment.id, requestKey('appointment-cancel'));
              await refresh();
            }
          }}
          onReschedule={async () => {
            const next = new Date(appointment.startsAt);
            next.setDate(next.getDate() + 7);
            if (isDemo) {
              demo.rescheduleAppointment(appointment.id, next.toISOString());
            } else {
              await mobileApi.rescheduleAppointment(appointment.id, next.toISOString(), requestKey('appointment-reschedule'));
              await refresh();
            }
          }}
          onReviewed={refresh}
        />
      ))}
      {!visits.length ? <Card><Body muted>No {tab.toLowerCase()} visits.</Body></Card> : null}
      <Button label="Book a visit" onPress={onBook} />
    </CollapsingScreen>
  );
}

function AppointmentCard({
  appointment,
  isDemo,
  upcoming,
  onCancel,
  onReschedule,
  onReviewed,
}: {
  appointment: PortalAppointment;
  isDemo: boolean;
  upcoming: boolean;
  onCancel: () => Promise<void>;
  onReschedule: () => Promise<void>;
  onReviewed: () => Promise<void>;
}) {
  const demo = useDemo();
  const [reviewing, setReviewing] = useState(false);
  const [rating, setRating] = useState(5);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  return (
    <Card style={styles.detailCard}>
      <Text style={styles.detailTitle}>{appointment.serviceName}</Text>
      <Body muted>{formatVisitDate(appointment.startsAt)}</Body>
      {appointment.locationLabel ? <Body>{appointment.locationLabel} · {appointment.locationDetail}</Body> : null}
      <Body>{appointment.status.replace('_', ' ')} · ${(appointment.balanceCents / 100).toFixed(2)} remaining</Body>
      <Button label="Add to calendar" variant="secondary" onPress={() => void addVisitToCalendar(appointment, isDemo)} />
      {upcoming ? (
        <View style={styles.visitActions}>
          <Button label="Reschedule one week" variant="secondary" loading={busy === 'reschedule'} style={styles.visitAction} onPress={() => void runVisitAction('reschedule', setBusy, onReschedule)} />
          <Button label="Cancel" variant="secondary" loading={busy === 'cancel'} style={styles.visitAction} onPress={() => confirmCancellation(setBusy, onCancel)} />
        </View>
      ) : appointment.status === 'completed' ? (
        <>
          <Button label={reviewing ? 'Close review' : 'Rate this visit'} variant="secondary" onPress={() => setReviewing((current) => !current)} />
          {reviewing ? (
            <View style={styles.reviewForm}>
              <View accessibilityRole="radiogroup" style={styles.ratingRow}>
                {[1, 2, 3, 4, 5].map((value) => (
                  <Pressable key={value} accessibilityRole="radio" {...choiceState(rating === value)} onPress={() => setRating(value)} style={[styles.ratingButton, rating === value && styles.ratingButtonActive]}>
                    <Text style={[styles.ratingText, rating === value && styles.ratingTextActive]}>{value}</Text>
                  </Pressable>
                ))}
              </View>
              <Field label="Review note" value={note} multiline onChangeText={setNote} />
              <Button label="Save review" loading={busy === 'review'} onPress={() => void saveVisitReview(appointment.id, rating, note, isDemo, setBusy, onReviewed, demo.reviewAppointment)} />
            </View>
          ) : null}
        </>
      ) : null}
    </Card>
  );
}

function formatVisitDate(value: string) {
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

async function runVisitAction(
  action: string,
  setBusy: (value: string | null) => void,
  run: () => Promise<void>,
) {
  setBusy(action);
  try {
    await run();
    Alert.alert('Visit updated', action === 'cancel' ? 'Your visit was cancelled.' : 'Your new time is confirmed.');
  } catch (error) {
    Alert.alert('Visit not updated', error instanceof Error ? error.message : 'Try again later.');
  } finally {
    setBusy(null);
  }
}

function confirmCancellation(setBusy: (value: string | null) => void, onCancel: () => Promise<void>) {
  Alert.alert('Cancel this visit?', 'Your cancellation policy may still apply.', [
    { text: 'Keep visit', style: 'cancel' },
    { text: 'Cancel visit', style: 'destructive', onPress: () => void runVisitAction('cancel', setBusy, onCancel) },
  ]);
}

async function addVisitToCalendar(appointment: PortalAppointment, isDemo: boolean) {
  const service = appointmentToBookingService(appointment);
  try {
    const result = await addAppointmentToCalendar(service, appointment.startsAt, isDemo, Constants.appOwnership);
    Alert.alert(result.simulated ? 'Calendar preview' : 'Added to calendar', result.message);
  } catch (error) {
    Alert.alert('Calendar unavailable', error instanceof Error ? error.message : 'Try again later.');
  }
}

async function saveVisitReview(
  appointmentId: string,
  rating: number,
  note: string,
  isDemo: boolean,
  setBusy: (value: string | null) => void,
  onReviewed: () => Promise<void>,
  saveDemoReview: (appointmentId: string, rating: number, note: string) => void,
) {
  setBusy('review');
  try {
    if (isDemo) {
      // Previously the demo branch persisted nothing and fell straight through to
      // the success alert, so a preview user rated a visit, was told "Review
      // saved", and found the form blank again on return.
      saveDemoReview(appointmentId, rating, note);
    } else {
      await mobileApi.reviewAppointment(appointmentId, rating, note, requestKey('appointment-review'));
      await onReviewed();
    }
    Alert.alert('Review saved', 'Thank you for sharing your experience.');
  } catch (error) {
    Alert.alert('Review not saved', error instanceof Error ? error.message : 'Try again later.');
  } finally {
    setBusy(null);
  }
}
