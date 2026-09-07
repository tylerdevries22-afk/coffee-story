// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';

import { McpStore, setupKindLabel, type McpStoreEntry, type McpStoreSetup } from './index';

const ONE_CLICK: McpStoreSetup = {
  kind: 'one-click-oauth', estimatedMinutes: 1,
  steps: [{ text: 'Press Connect and approve the requested scopes.' }],
  consoleHref: 'https://developers.tiktok.com/apps',
  documentationHref: 'https://developers.tiktok.com/doc/login-kit-web',
};
const API_KEY: McpStoreSetup = {
  kind: 'api-key', estimatedMinutes: 2,
  steps: [
    { text: 'Open your Transistor account page.', href: 'https://dashboard.transistor.fm/account' },
    { text: 'Copy the API key shown under API keys.' },
  ],
  consoleHref: 'https://dashboard.transistor.fm/account',
  consoleLabel: 'Open the key screen',
  documentationHref: 'https://developers.transistor.fm/',
};
const MANUAL: McpStoreSetup = {
  kind: 'operator-portal', estimatedMinutes: 4,
  steps: [{ text: 'Amazon publishes no KDP API, so royalties arrive by export.' }],
  consoleHref: 'https://kdpreports.amazon.com/',
  documentationHref: 'https://kdp.amazon.com/en_US/help/topic/GVTTXHKHVPAPBEDQ',
};

const TIKTOK: McpStoreEntry = {
  id: 'tiktok', name: 'TikTok', description: 'Creator profile and video list',
  type: 'Marketing', status: 'not_connected', connectHref: '/api/connectors/tiktok/authorize',
  setup: ONE_CLICK,
};
const TRANSISTOR: McpStoreEntry = {
  id: 'transistor', name: 'Transistor', description: 'Podcast shows and analytics',
  type: 'Marketing', status: 'not_connected', connectHref: '/integrations/transistor',
  connectLabel: 'Add API key', setup: API_KEY,
};
const KDP: McpStoreEntry = {
  id: 'kindle-direct-publishing', name: 'Kindle Direct Publishing',
  description: 'Ebook royalties', type: 'Commerce', status: 'manual',
  connectHref: '/integrations/kindle-direct-publishing', connectLabel: 'Set up import',
  setup: MANUAL,
};

describe('setup guidance', () => {
  afterEach(cleanup);

  it('names each setup kind in reader-facing language', () => {
    expect(setupKindLabel('one-click-oauth')).toBe('One-click sign-in');
    expect(setupKindLabel('api-key')).toBe('Paste an API key');
    expect(setupKindLabel('operator-portal')).toBe('Guided import');
  });

  it('advertises the effort before the reader commits', () => {
    render(<McpStore entries={[TIKTOK, TRANSISTOR, KDP]} />);
    expect(screen.getByText('One-click sign-in')).toBeInTheDocument();
    expect(screen.getByText('~1 min')).toBeInTheDocument();
    expect(screen.getByText('~2 min')).toBeInTheDocument();
    expect(screen.getByText('~4 min')).toBeInTheDocument();
  });

  it('deep-links a key step to the provider screen and opens it safely', () => {
    render(<McpStore entries={[TRANSISTOR]} />);
    const step = screen.getByRole('link', { name: 'Open your Transistor account page.' });
    expect(step).toHaveAttribute('href', 'https://dashboard.transistor.fm/account');
    expect(step).toHaveAttribute('target', '_blank');
    expect(step).toHaveAttribute('rel', 'noreferrer noopener');
  });

  it('keeps every step collapsed until asked, so the directory stays scannable', () => {
    render(<McpStore entries={[TIKTOK, TRANSISTOR, KDP]} />);
    for (const summary of screen.getAllByText('How to connect')) {
      expect(summary.closest('details')).not.toHaveAttribute('open');
    }
  });

  it('offers a manual-only provider its import action rather than Unavailable', () => {
    const html = renderToStaticMarkup(<McpStore entries={[KDP]} />);
    expect(html).toContain('Set up import');
    expect(html).not.toContain('Unavailable');
  });

  it('labels a manual provider honestly when the host offers no action', () => {
    const html = renderToStaticMarkup(
      <McpStore entries={[{ ...KDP, connectHref: null, connectLabel: undefined }]} />,
    );
    expect(html).toContain('Manual import');
  });

  it('finds a connector by how it is set up, not only by name', () => {
    render(<McpStore entries={[TIKTOK, TRANSISTOR, KDP]} />);
    fireEvent.change(
      screen.getByRole('searchbox', { name: 'Search connectors' }),
      { target: { value: 'api-key' } },
    );
    expect(screen.getByText('Transistor')).toBeInTheDocument();
    expect(screen.queryByText('TikTok')).not.toBeInTheDocument();
    expect(screen.queryByText('Kindle Direct Publishing')).not.toBeInTheDocument();
  });

  it('renders no disclosure when a host supplies no steps', () => {
    const html = renderToStaticMarkup(
      <McpStore entries={[{ ...TIKTOK, setup: { ...ONE_CLICK, steps: [] } }]} />,
    );
    expect(html).not.toContain('How to connect');
  });

  it('omits the time estimate when a provider has nothing to configure yet', () => {
    const html = renderToStaticMarkup(<McpStore entries={[{
      ...TIKTOK, status: 'unavailable',
      setup: { ...ONE_CLICK, estimatedMinutes: 0, steps: [{ text: 'Awaiting certification.' }] },
    }]} />);
    expect(html).toContain('One-click sign-in');
    expect(html).not.toContain('min<');
    expect(html).not.toContain('~0');
  });

  it('omits setup guidance from onboarding selection, which is intent only', () => {
    const html = renderToStaticMarkup(<McpStore entries={[TRANSISTOR]} mode="select" />);
    expect(html).not.toContain('How to connect');
  });
});
