'use client';

import { useEffect, useState } from 'react';
import { Button, Icon } from '@sovereignfs/ui';

/**
 * Copies a card's payload to the clipboard. The number under the barcode is
 * the thing people actually need when a scanner won't read the screen or a
 * form asks for the membership number, and re-typing it off a rendered
 * barcode is the one interaction Wallet couldn't previously support.
 *
 * `navigator.clipboard` needs a secure context; on a self-hosted instance
 * served over plain HTTP it is simply absent, so the button hides itself
 * rather than failing on click.
 */
export function CopyButton({ value, label = 'Copy' }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const [supported, setSupported] = useState(false);

  // Read the browser global in an effect, never during render — this is a
  // client component that also renders on the server.
  useEffect(() => {
    setSupported(typeof navigator !== 'undefined' && Boolean(navigator.clipboard));
  }, []);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  if (!supported) return null;

  return (
    <Button
      type="button"
      variant="secondary"
      onClick={() => {
        void navigator.clipboard.writeText(value).then(
          () => setCopied(true),
          () => setCopied(false),
        );
      }}
    >
      <Icon name={copied ? 'check' : 'copy'} size="sm" aria-hidden />
      {copied ? 'Copied' : label}
    </Button>
  );
}
