import { Component, type ErrorInfo, type PropsWithChildren } from 'react';
import { StyleSheet, View } from 'react-native';

import { Body, Button, StaticScreen, Title } from '@/components/ui';
import { resetStoredDemoPortal } from '@/state/demo-storage';

import {
  captureAppError,
  clearAppError,
  initialAppErrorBoundaryState,
  type AppErrorBoundaryState,
} from './app-error-boundary-state';
import { useTokens as useBrandTokens, type BrandTokens } from '@platform/ui';

function errorDetails(error: unknown): { errorName: string; errorMessage: string } {
  if (!(error instanceof Error)) {
    return { errorName: 'UnknownError', errorMessage: 'A non-Error value was thrown.' };
  }
  return {
    errorName: error.name,
    errorMessage: error.message.replaceAll(/\s+/g, ' ').slice(0, 240),
  };
}

export class AppErrorBoundary extends Component<PropsWithChildren, AppErrorBoundaryState> {
  state = initialAppErrorBoundaryState;
  private resetInFlight = false;

  static getDerivedStateFromError(): AppErrorBoundaryState {
    return captureAppError();
  }

  componentDidCatch(error: unknown, errorInfo: ErrorInfo) {
    console.error('Unhandled mobile render failure', {
      ...errorDetails(error),
      componentStack: errorInfo.componentStack,
    });
  }

  private resetPreview = async () => {
    if (this.resetInFlight) return;
    this.resetInFlight = true;
    try {
      await resetStoredDemoPortal();
      this.setState(clearAppError());
    } catch (error) {
      console.error('Preview reset failed', errorDetails(error));
      this.setState(captureAppError());
    } finally {
      this.resetInFlight = false;
    }
  };

  render() {
    if (this.state.status === 'ready') return this.props.children;
    return <ErrorFallback message={this.state.message} onReset={() => void this.resetPreview()} />;
  }
}

function ErrorFallback({ message, onReset }: { message: string; onReset: () => void }) {
  const tokens = useBrandTokens();
  const styles = createStyles(tokens);
  return (
    <StaticScreen>
      <View style={styles.fallback}>
        <Title>Something needs a reset</Title>
        <Body muted>{message}</Body>
        <Button label="Reset preview" onPress={onReset} />
      </View>
    </StaticScreen>
  );
}

const createStyles = (tokens: BrandTokens) => StyleSheet.create({
  fallback: {
    flex: 1,
    justifyContent: 'center',
    gap: tokens.spacing.lg,
    padding: tokens.spacing.xxl,
    backgroundColor: tokens.surface,
  },
});
