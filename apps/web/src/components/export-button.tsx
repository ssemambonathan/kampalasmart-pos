'use client';

import { useState } from 'react';
import { Download, Lock } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { downloadExport, errorMessage } from '@/lib/api';
import { useToast } from './toast';
import { EmptyState, Spinner } from './ui';

export function ExportButton({
  path,
  filename,
  label = 'Export CSV',
}: {
  path: string;
  filename?: string;
  label?: string;
}) {
  const { can } = useAuth();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  if (!can('exports:data')) return null;

  const run = async () => {
    setBusy(true);
    try {
      await downloadExport(path, filename);
      toast('Export downloaded.', 'success');
    } catch (error) {
      toast(errorMessage(error), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <button type="button" className="btn-secondary btn-sm" onClick={run} disabled={busy}>
      {busy ? <Spinner /> : <Download className="h-3.5 w-3.5" />}
      {label}
    </button>
  );
}

export function PermissionNotice({ area }: { area: string }) {
  return (
    <div className="card">
      <EmptyState
        icon={<Lock className="h-5 w-5" />}
        title="This area is not available for your role"
        description={`Your account does not have permission to view ${area}. Ask the business owner or a manager if you need access.`}
      />
    </div>
  );
}
