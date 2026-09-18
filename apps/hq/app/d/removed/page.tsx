import type { Metadata } from 'next';

import { DemoNotice } from '@/components/demo/demo-banner';

import '../../styles/demo.css';

export const metadata: Metadata = {
  title: 'Demo removed',
  robots: { index: false, follow: false, nocache: true },
};

/** The end of "remove my business": static, because there is nothing left to read. */
export default function DemoRemoved() {
  return (
    <DemoNotice
      title="Removed"
      body="The demo is deleted, and your business is on the list we check before making any demo, so we won't make another."
    />
  );
}
