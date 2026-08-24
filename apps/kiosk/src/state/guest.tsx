import { createContext, useCallback, useContext, useMemo, useState, type PropsWithChildren } from 'react';

/**
 * What the kiosk knows about the person standing at it.
 *
 * Separate from the session and the cart because it must be clearable on its
 * own: Start over and the idle reset have to wipe identity whatever happens to
 * the bag. It is also the only place on this surface that holds anything about
 * a person, which makes "what does a lobby kiosk remember" a question with one
 * file for an answer.
 *
 * `posture.unattended` is true for a lobby device, so nothing here outlives a
 * session and no raw phone number is kept after a lookup returns.
 */
type GuestValue = {
  guestLabel: string | null;
  /** Masked for display; the raw number is never stored. */
  maskedPhone: string | null;
  surveyAnswers: readonly string[];
  setGuestLabel: (label: string | null) => void;
  setMaskedPhone: (masked: string | null) => void;
  toggleSurveyAnswer: (id: string) => void;
  clear: () => void;
};

const GuestContext = createContext<GuestValue | null>(null);

export function GuestProvider({ children }: PropsWithChildren) {
  const [guestLabel, setGuestLabel] = useState<string | null>(null);
  const [maskedPhone, setMaskedPhone] = useState<string | null>(null);
  const [surveyAnswers, setSurveyAnswers] = useState<readonly string[]>([]);

  const clear = useCallback(() => {
    setGuestLabel(null);
    setMaskedPhone(null);
    setSurveyAnswers([]);
  }, []);

  const value = useMemo<GuestValue>(() => ({
    guestLabel,
    maskedPhone,
    surveyAnswers,
    setGuestLabel,
    setMaskedPhone,
    toggleSurveyAnswer: (id) => setSurveyAnswers((current) =>
      current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id]),
    clear,
  }), [guestLabel, maskedPhone, surveyAnswers, clear]);

  return <GuestContext.Provider value={value}>{children}</GuestContext.Provider>;
}

export function useGuest(): GuestValue {
  const value = useContext(GuestContext);
  if (!value) throw new Error('useGuest must be used inside GuestProvider');
  return value;
}
