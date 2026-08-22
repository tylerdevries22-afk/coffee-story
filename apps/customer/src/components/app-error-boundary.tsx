import { Component, type ErrorInfo, type PropsWithChildren } from 'react';
import { StyleSheet, View } from 'react-native';

import { Body, Button, StaticScreen, Title } from '@/components/ui';
import { resetStoredDemoPortal } from '@/state/demo-storage';
import { colors, spacing } from '@/theme/tokens';

import {
  captureAppError,
  clearAppError,
  initialAppErrorBoundaryState,
  type AppErrorBoundaryState,
} from './app-error-boundary-state';

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
    return (
      <StaticScreen>
        <View style={styles.fallback}>
          <Title>Something needs a reset</Title>
          <Body muted>{this.state.message}</Body>
          <Button label="Reset preview" onPress={() => void this.resetPreview()} />
        </View>
      </StaticScreen>
    );
  }
}

const styles = StyleSheet.create({
  fallback: {
    flex: 1,
    justifyContent: 'center',
    gap: spacing.md,
    padding: spacing.xl,
    backgroundColor: colors.surface,
  },
});
