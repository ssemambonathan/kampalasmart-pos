import Link from 'next/link';
import { Boxes, CloudOff, ShieldCheck } from 'lucide-react';

export function AuthLayout({
  title,
  subtitle,
  children,
  footer,
  wide,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div className="grid min-h-screen bg-[#f6f8f7] lg:grid-cols-[1fr_0.9fr]">
      <div className="flex flex-col px-5 py-6 sm:px-10 lg:px-16">
        <div className="flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5" aria-label="KampalaSmart home">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand-700 text-base font-black text-white">
              K<span className="text-accent-300">.</span>
            </span>
            <span className="leading-tight">
              <span className="block text-[15px] font-bold tracking-tight text-ink-950">KampalaSmart</span>
              <span className="block text-[9px] font-semibold uppercase tracking-[0.15em] text-brand-600">Retail OS</span>
            </span>
          </Link>
          <Link href="/register" className="text-xs font-semibold text-brand-700 hover:text-brand-800">
            New here? Start a trial
          </Link>
        </div>

        <div className={`my-auto w-full py-10 ${wide ? 'max-w-xl' : 'max-w-md'} mx-auto`}>
          <h1 className="text-[28px] font-semibold tracking-tight text-ink-950">{title}</h1>
          {subtitle ? <p className="mt-2 text-sm text-ink-500">{subtitle}</p> : null}
          <div className="mt-7">{children}</div>
          {footer ? <div className="mt-6 text-center text-xs text-ink-500">{footer}</div> : null}
        </div>

        <p className="text-center text-[11px] text-ink-400">
          © {new Date().getFullYear()} KampalaSmart · Built for African retail
        </p>
      </div>

      <aside className="relative hidden overflow-hidden bg-brand-900 p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div
          className="pointer-events-none absolute inset-0 opacity-40"
          style={{
            backgroundImage:
              'radial-gradient(circle at 20% 20%, rgba(255,189,74,0.32), transparent 34%), radial-gradient(circle at 80% 70%, rgba(69,174,133,0.45), transparent 40%)',
          }}
        />
        <div className="relative">
          <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-accent-300">The retail operating system</p>
          <p className="mt-5 max-w-md text-[26px] font-medium leading-snug text-white">
            Every sale, return and transfer explains itself — and the till keeps working when the data
            connection goes.
          </p>
          <p className="mt-4 text-sm text-brand-200">Offline-first POS · Inventory ledger · Branch reporting</p>
        </div>

        <div className="relative space-y-4">
          {[
            {
              icon: <CloudOff className="h-4 w-4" />,
              title: 'Offline-first by design',
              body: 'Sell through network drops. Sales queue on the device and replay exactly once.',
            },
            {
              icon: <Boxes className="h-4 w-4" />,
              title: 'Stock that reconciles',
              body: 'An immutable movement ledger behind every quantity on the shelf.',
            },
            {
              icon: <ShieldCheck className="h-4 w-4" />,
              title: 'Protected by permissions',
              body: 'Approvals, branch scoping and audit records enforced by the server.',
            },
          ].map((feature) => (
            <div key={feature.title} className="flex gap-3 rounded-xl border border-white/10 bg-white/[0.06] p-3.5 backdrop-blur-sm">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white/10 text-accent-300">{feature.icon}</span>
              <div>
                <p className="text-sm font-semibold text-white">{feature.title}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-brand-200">{feature.body}</p>
              </div>
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}
