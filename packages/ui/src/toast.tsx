/** In-app toasts: a queue in context, one visible at a time, auto-dismissed. */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react';
import { Animated, Easing, Text, View } from 'react-native';

import { useTokens } from './theme';

export type ToastTone = 'neutral' | 'success' | 'danger';
type ToastItem = { id: number; message: string; tone: ToastTone };

const ToastContext = createContext<{ show: (message: string, tone?: ToastTone) => void }>({
  show: () => {},
});

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: PropsWithChildren) {
  const [queue, setQueue] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const show = useCallback((message: string, tone: ToastTone = 'neutral') => {
    setQueue((current) => [...current, { id: nextId.current++, message, tone }]);
  }, []);

  const dismiss = useCallback((id: number) => {
    setQueue((current) => current.filter((item) => item.id !== id));
  }, []);

  const value = useMemo(() => ({ show }), [show]);
  const active = queue[0];

  return (
    <ToastContext.Provider value={value}>
      {children}
      {active ? <ToastCard key={active.id} item={active} onDone={() => dismiss(active.id)} /> : null}
    </ToastContext.Provider>
  );
}

function ToastCard({ item, onDone }: { item: ToastItem; onDone: () => void }) {
  const tokens = useTokens();
  const fade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fade, { toValue: 1, duration: tokens.motion.fast, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
    const timer = setTimeout(() => {
      Animated.timing(fade, { toValue: 0, duration: tokens.motion.base, useNativeDriver: true }).start(() => onDone());
    }, 2600);
    return () => clearTimeout(timer);
  }, [fade, onDone, tokens.motion.base, tokens.motion.fast]);

  const edge = item.tone === 'success' ? tokens.success : item.tone === 'danger' ? tokens.danger : tokens.accent;

  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: tokens.spacing.lg,
        right: tokens.spacing.lg,
        bottom: tokens.spacing.xxl * 2,
        opacity: fade,
      }}
    >
      {/* The animation rides this wrapper View, never the Text (AGENTS.md). */}
      <View
        accessibilityLiveRegion="polite"
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: tokens.spacing.sm,
          backgroundColor: tokens.textPrimary,
          borderRadius: tokens.radius.md,
          paddingHorizontal: tokens.spacing.lg,
          paddingVertical: tokens.spacing.md,
          shadowColor: tokens.textPrimary,
          shadowOpacity: tokens.elevation.raised,
          shadowRadius: 16,
          shadowOffset: { width: 0, height: 6 },
          elevation: 6,
        }}
      >
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: edge }} />
        <Text style={{ flex: 1, color: tokens.surfaceElevated, fontFamily: tokens.fontBody, fontSize: tokens.type.sm }}>
          {item.message}
        </Text>
      </View>
    </Animated.View>
  );
}
