import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Body, Button, Card, Eyebrow } from '@/components/ui';
import type { AdminSettingsState } from '@/features/admin/admin-settings';
import { INTAKE_FORM_CATALOG, type IntakeFormCatalogEntry } from '@/features/admin/preferences-forms';
import { mobileApi } from '@/lib/mobile-api';
import { openWebPath } from '@/lib/web-navigation';
import { AppIcon, useTokens as useBrandTokens } from '@platform/ui';
import { createStyles } from './admin-settings-styles';
import { Field, PanelHeading, ToggleRow } from './admin-settings-fields';

type SettingsPanelProps = { value: AdminSettingsState; onChange: (settings: AdminSettingsState) => void; };

export function FormsPanel({ value, onChange, isDemo }: SettingsPanelProps & { isDemo: boolean }) {
  const tokens = useBrandTokens();
  const styles = createStyles(tokens);
  // Seeded from the bundled catalog so the list is right offline and in the
  // Expo Go demo, then replaced by whatever the site is actually publishing.
  const [drafts, setDrafts] = useState<IntakeFormCatalogEntry[]>(() => INTAKE_FORM_CATALOG.map((form) => ({ ...form })));
  const [saved, setSaved] = useState<IntakeFormCatalogEntry[]>(() => INTAKE_FORM_CATALOG.map((form) => ({ ...form })));
  // One open at a time: four expanded forms was an unreadable column.
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (isDemo) return;
    let alive = true;
    mobileApi.intakeForms()
      .then((body) => {
        if (!alive || !body?.forms?.length) return;
        setDrafts(body.forms.map((form) => ({ ...form })));
        setSaved(body.forms.map((form) => ({ ...form })));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [isDemo]);

  const dirty = JSON.stringify(drafts) !== JSON.stringify(saved);
  const update = (id: string, patch: Partial<IntakeFormCatalogEntry>) =>
    setDrafts((current) => current.map((draft) => (draft.id === id ? { ...draft, ...patch } : draft)));

  async function save() {
    setBusy(true);
    setNotice(null);
    try {
      const body = await mobileApi.updateIntakeForms(drafts);
      const next = body?.forms?.length ? body.forms.map((form) => ({ ...form })) : drafts;
      setDrafts(next);
      setSaved(next);
      setNotice('Saved. The site and both portals now show this.');
    } catch {
      // The endpoint is owner-only, so this is the expected answer for a demo
      // session or a team member rather than a fault worth alarming about.
      setNotice('Sign in as the owner to change these. Nothing was changed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.panel}>
      <PanelHeading title="Forms & documents" detail="Keep consent requirements visible before care begins." />
      <ToggleRow label="No usual saved" detail="Require a current preferences before the first session." value={value.intakeRequired} disabled={!isDemo} onChange={(intakeRequired) => onChange({ ...value, intakeRequired })} />
      <ToggleRow label="Care consent required" detail="Require an accepted consent record." value={value.consentRequired} disabled={!isDemo} onChange={(consentRequired) => onChange({ ...value, consentRequired })} />

      <Card style={styles.formSummary}>
        <Text style={styles.rowTitle}>
          {drafts.length} active document{drafts.length === 1 ? '' : 's'}
        </Text>
        <Body muted>These are the documents clients sign, and the same list the website publishes.</Body>
        {drafts.map((draft) => {
          const open = openId === draft.id;
          return (
            <View key={draft.id} style={styles.formRow}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={draft.title}
                accessibilityHint={open ? 'Collapses this form' : 'Opens this form for editing'}
                accessibilityState={{ expanded: open }}
                onPress={() => setOpenId(open ? null : draft.id)}
                style={({ pressed }) => [styles.formHeader, pressed && styles.formHeaderPressed]}
              >
                <View style={styles.formHeaderCopy}>
                  <Eyebrow>{draft.eyebrow}</Eyebrow>
                  <Text style={styles.rowTitle}>{draft.title}</Text>
                  {/* Collapsed, the summary is the one line that tells the two
                      consent documents apart; expanded, the fields say it. */}
                  {open ? null : <Body muted>{draft.summary}</Body>}
                </View>
                <AppIcon name={open ? 'chevron.down' : 'chevron.right'} size={15} tintColor={tokens.primary} />
              </Pressable>

              {open ? (
                <View style={styles.formFields}>
                  <Body muted>{draft.summary}</Body>
                  <Field label="Title" value={draft.title} editable onChangeText={(title) => update(draft.id, { title })} />
                  <Field label="Asked for at" value={draft.stage} editable onChangeText={(stage) => update(draft.id, { stage })} />
                  <Field label="Time to complete" value={draft.duration} editable onChangeText={(duration) => update(draft.id, { duration })} />
                  <Field label="Version" value={draft.version} editable onChangeText={(version) => update(draft.id, { version })} />
                  {/* The published document, opened where a client would read
                      it. The questions themselves live on the site, so this is
                      the only way to check what these fields are describing. */}
                  <Pressable
                    accessibilityRole="link"
                    accessibilityLabel={`View ${draft.title} on the website`}
                    onPress={() => void openWebPath(`/preferences-forms#${draft.id}`).catch(() => setNotice('That page could not be opened on this device.'))}
                    style={({ pressed }) => [styles.viewOnSite, pressed && styles.formHeaderPressed]}
                  >
                    <Text style={styles.viewOnSiteLabel}>View on the website</Text>
                    <AppIcon name="chevron.right" size={13} tintColor={tokens.primary} />
                  </Pressable>
                </View>
              ) : null}
            </View>
          );
        })}
      </Card>

      {notice ? <Body muted>{notice}</Body> : null}
      <Button label={busy ? 'Saving…' : 'Save forms'} onPress={() => void save()} disabled={!dirty || busy} />
      <Body muted>
        A new form needs its questions built in the app first, so this edits the four that exist rather than adding to them.
      </Body>
    </View>
  );
}
