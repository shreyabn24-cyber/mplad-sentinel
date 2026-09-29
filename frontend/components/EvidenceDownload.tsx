'use client';

import React, { useState } from 'react';
import { downloadEvidenceFile } from '@/lib/api';

/** Authenticated evidence download control for request queues. */
export default function EvidenceDownload({
  attachmentId,
  filename,
}: {
  attachmentId: string;
  filename: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function handleDownload() {
    setBusy(true);
    setError('');
    try {
      const blob = await downloadEvidenceFile(attachmentId);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename || 'citizen-evidence';
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Download failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex flex-col items-start gap-0.5">
      <button type="button" onClick={handleDownload} disabled={busy}
        className="text-[11px] font-semibold text-primary underline underline-offset-2 disabled:opacity-60">
        {busy ? 'Downloading…' : filename}
      </button>
      {error && <span role="alert" className="text-[10px] text-red-700">{error}</span>}
    </span>
  );
}
