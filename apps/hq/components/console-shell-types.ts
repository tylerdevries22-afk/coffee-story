import type { CSSProperties, ReactNode, RefObject } from 'react';

import type { ConsoleSection } from '@/lib/console-navigation';

export type ConsoleShellProps = {
  readonly children: ReactNode;
  readonly theme: CSSProperties;
  readonly sections: readonly ConsoleSection[];
  readonly brandName: string;
  readonly initials: string;
  readonly statusHref: string;
  readonly dataMode: 'hosted' | 'preview';
  readonly quickCreate?: { readonly href: string; readonly label: string };
  readonly sessionFooter: ReactNode;
  readonly orgSwitcher?: ReactNode;
  readonly locationSwitcher?: ReactNode;
};

export type ConsoleRailProps = Pick<
  ConsoleShellProps,
  | 'brandName'
  | 'dataMode'
  | 'initials'
  | 'locationSwitcher'
  | 'orgSwitcher'
  | 'sections'
  | 'sessionFooter'
  | 'statusHref'
> & {
  readonly section: ConsoleSection;
  readonly compact: boolean;
  readonly mobile: boolean;
  readonly isOpen: boolean;
  readonly isHidden: boolean;
  readonly onClose: () => void;
  readonly onOpenCommand: () => void;
  readonly closeButtonRef: RefObject<HTMLButtonElement | null>;
};
