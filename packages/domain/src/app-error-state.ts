export type AppErrorBoundaryState =
  | { status: 'ready' }
  | { status: 'failed'; message: string };

export const initialAppErrorBoundaryState: AppErrorBoundaryState = { status: 'ready' };

export function captureAppError(error?: unknown): AppErrorBoundaryState {
  void error;
  return {
    status: 'failed',
    message: 'The app needs a fresh preview before it can continue.',
  };
}

export function clearAppError(): AppErrorBoundaryState {
  return initialAppErrorBoundaryState;
}
