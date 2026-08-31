import type { ReactNode } from 'react';

import { Icon } from '@/components/icon';
import { Alert, AlertDescription, AlertTitle } from '@/components/reui/alert';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';

type ConsoleStateProps = {
  readonly title: string;
  readonly description: string;
  readonly kind?: 'empty' | 'error' | 'offline' | 'permission' | 'partial';
  readonly action?: ReactNode;
};

const stateIcon = {
  empty: 'dashboard',
  error: 'close',
  offline: 'activity',
  permission: 'lock',
  partial: 'activity',
} as const;

/** Shared, tenant-token-aware feedback for data-backed console surfaces. */
export function ConsoleState({ title, description, kind = 'empty', action }: ConsoleStateProps) {
  if (kind === 'error' || kind === 'offline' || kind === 'permission') {
    const variant = kind === 'error' ? 'destructive' : kind === 'permission' ? 'warning' : 'info';
    return (
      <Alert variant={variant} className="console-state-alert">
        <Icon name={stateIcon[kind]} size={16} aria-hidden="true" />
        <AlertTitle>{title}</AlertTitle>
        <AlertDescription>
          <p>{description}</p>
          {action}
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <Empty className="console-state-empty border-border">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Icon name={stateIcon[kind]} size={16} aria-hidden="true" />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
      {action}
    </Empty>
  );
}
