import Link from 'next/link';
import { CloudOff, RefreshCw } from 'lucide-react';

export default function OfflinePage() {
  return (
    <div className="grid min-h-screen place-items-center bg-[#f6f8f7] px-5">
      <div className="card max-w-md p-8 text-center">
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-accent-50 text-accent-700">
          <CloudOff className="h-6 w-6" />
        </span>
        <h1 className="mt-4 text-xl font-semibold text-ink-950">You are offline</h1>
        <p className="mt-2 text-sm text-ink-600">
          This page is not cached on the device yet. The till catalogue and any queued sales are stored
          locally and remain available from the point of sale.
        </p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <Link href="/pos" className="btn-primary">
            Open point of sale
          </Link>
          <Link href="/dashboard" className="btn-secondary">
            <RefreshCw className="h-4 w-4" /> Try dashboard
          </Link>
        </div>
        <p className="mt-4 text-xs text-ink-400">
          Reconnect to refresh reports, purchasing and settings.
        </p>
      </div>
    </div>
  );
}
