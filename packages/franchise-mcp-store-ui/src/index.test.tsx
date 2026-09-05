// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { McpStore, type McpStoreEntry } from './index';

const ENTRIES: readonly McpStoreEntry[] = [
  { id: 'slack', name: 'Slack', description: 'Team messages', type: 'Web',
    status: 'not_connected', popular: true, connectHref: '/connect/slack' },
  { id: 'google', name: 'Google', description: 'Business tools', type: 'Web',
    status: 'not_connected', selectable: false },
];

describe('McpStore', () => {
  it('renders the shared StillPoint directory structure', () => {
    const html = renderToStaticMarkup(<McpStore entries={ENTRIES} />);
    expect(html).toContain('Popular');
    expect(html).toContain('Connector');
    expect(html).toContain('Connect');
  });

  it('renders tenant selection controls without navigation', () => {
    const html = renderToStaticMarkup(<McpStore entries={ENTRIES} mode="select" selectedIds={['slack']} />);
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('Included');
    expect(html).not.toContain('href=');
  });

  it('labels a disabled connector honestly', () => {
    const html = renderToStaticMarkup(<McpStore entries={[{ ...ENTRIES[0], selectable: false }]} mode="select" />);
    expect(html).toContain('Unavailable');
    expect(html).toContain('data-state="unavailable"');
    expect(html).toContain('disabled');
  });

  it('filters in place without remounting the tab list', () => {
    render(<McpStore entries={ENTRIES} mode="select" selectedIds={['slack']} />);
    const tabList = screen.getByRole('tablist', { name: 'Connector status' });
    fireEvent.click(within(tabList).getByRole('tab', { name: 'Included' }));
    expect(screen.getByRole('tablist', { name: 'Connector status' })).toBe(tabList);
    expect(screen.getAllByText('Slack').length).toBeGreaterThan(0);
    expect(screen.queryByText('Business tools')).not.toBeInTheDocument();
  });
});
