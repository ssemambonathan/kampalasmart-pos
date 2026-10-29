import Link from 'next/link';
import {
  ArrowRight,
  BarChart3,
  Boxes,
  Check,
  CloudOff,
  LockKeyhole,
  ReceiptText,
  ShieldCheck,
  Smartphone,
  Store,
  Users,
  WifiOff,
} from 'lucide-react';

const FEATURES = [
  {
    icon: <CloudOff className="h-5 w-5" />,
    title: 'Keep selling when the internet drops',
    body: 'The till runs from a local catalogue and queues every sale safely on the device. When the connection returns, sales sync server-side with stock conflicts flagged for a manager — never silently overwritten.',
  },
  {
    icon: <Boxes className="h-5 w-5" />,
    title: 'Stock you can explain',
    body: 'Every unit movement is an immutable ledger entry with a running balance. Purchases, sales, returns, transfers, damage and counts all reconcile to the same number.',
  },
  {
    icon: <ReceiptText className="h-5 w-5" />,
    title: 'Purchasing and supplier returns',
    body: 'Order stock, receive in parts, return damaged goods and track what each supplier really costs you — with clean audit records at every step.',
  },
  {
    icon: <BarChart3 className="h-5 w-5" />,
    title: 'Numbers a shopkeeper can act on',
    body: 'Sales, gross profit, discounts, refunds and stock value by branch, cashier and product. Reorder suggestions use real velocity and supplier lead times.',
  },
  {
    icon: <Users className="h-5 w-5" />,
    title: 'Roles that match your shop',
    body: 'Owners, managers, cashiers and stock clerks each see only what their job needs, enforced on the server with branch-level scoping.',
  },
  {
    icon: <ShieldCheck className="h-5 w-5" />,
    title: 'Controls built for trust',
    body: 'Refunds need approval above your threshold. Discounts have role limits. Every sensitive action lands in an immutable audit trail.',
  },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-[#f6f8f7]">
      <header className="sticky top-0 z-30 border-b border-ink-200/70 bg-[#f6f8f7]/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
          <Link href="/" className="flex items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand-700 text-base font-black text-white">
              K<span className="text-accent-300">.</span>
            </span>
            <span className="leading-tight">
              <span className="block text-[15px] font-bold tracking-tight text-ink-950">KampalaSmart</span>
              <span className="block text-[9px] font-semibold uppercase tracking-[0.15em] text-brand-600">Retail OS</span>
            </span>
          </Link>
          <nav className="hidden items-center gap-6 text-sm font-medium text-ink-600 sm:flex" aria-label="Landing navigation">
            <a href="#product" className="hover:text-ink-950">Product</a>
            <a href="#offline" className="hover:text-ink-950">Offline mode</a>
            <a href="#pricing" className="hover:text-ink-950">Plans</a>
          </nav>
          <div className="flex items-center gap-2">
            <Link href="/login" className="btn-ghost btn-sm sm:btn">Sign in</Link>
            <Link href="/register" className="btn-primary btn-sm sm:btn">
              Start free trial <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      </header>

      <main>
        <section className="mx-auto max-w-6xl px-5 pb-16 pt-14 sm:pt-20">
          <div className="grid items-center gap-12 lg:grid-cols-[1.05fr_0.95fr]">
            <div>
              <span className="inline-flex items-center gap-2 rounded-full border border-brand-200 bg-white px-3 py-1 text-[11px] font-semibold text-brand-700">
                <span className="h-1.5 w-1.5 rounded-full bg-brand-500" />
                Built for Kampala shops, kiosks and multi-branch retailers
              </span>
              <h1 className="mt-5 max-w-xl text-[38px] font-bold leading-[1.08] tracking-tight text-ink-950 sm:text-[54px]">
                Run the whole shop.
                <span className="block text-brand-700">Even when the network fails.</span>
              </h1>
              <p className="mt-5 max-w-xl text-[15px] leading-relaxed text-ink-600 sm:text-base">
                A point of sale, stock ledger, purchasing system and honest business reports in one
                workspace. Designed for real trading days — power cuts, patchy data and busy counters
                included.
              </p>
              <div className="mt-7 flex flex-wrap items-center gap-3">
                <Link href="/register" className="btn-primary btn-lg">
                  Create your business <ArrowRight className="h-4 w-4" />
                </Link>
                <Link href="/login" className="btn-secondary btn-lg">
                  Sign in to a workspace
                </Link>
              </div>
              <p className="mt-3 text-xs text-ink-500">30-day trial · No card details · Data stays in your workspace</p>
              <ul className="mt-8 grid max-w-lg grid-cols-1 gap-2 text-sm text-ink-600 sm:grid-cols-2">
                {[
                  'Offline-first till with IndexedDB',
                  'Atomic, idempotent sale posting',
                  'Per-branch stock and reporting',
                  'Manager-approved refunds',
                ].map((item) => (
                  <li key={item} className="flex items-center gap-2">
                    <Check className="h-4 w-4 shrink-0 text-brand-600" /> {item}
                  </li>
                ))}
              </ul>
            </div>

            <div className="relative">
              <div className="absolute -inset-6 -z-10 rounded-[36px] bg-gradient-to-br from-brand-200/60 via-transparent to-accent-200/50 blur-2xl" />
              <div className="card overflow-hidden shadow-pop">
                <div className="flex items-center justify-between border-b border-ink-100 bg-white px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full bg-red-400" />
                    <span className="h-2.5 w-2.5 rounded-full bg-accent-400" />
                    <span className="h-2.5 w-2.5 rounded-full bg-brand-400" />
                  </div>
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-400">Preview · Main Branch · Till 1</span>
                </div>
                <div className="grid grid-cols-[1.15fr_1fr] gap-0">
                  <div className="border-r border-ink-100 p-4">
                    <div className="mb-3 flex items-center justify-between">
                      <p className="text-xs font-semibold text-ink-800">Today&apos;s counter</p>
                      <span className="badge-green">Open</span>
                    </div>
                    <div className="rounded-lg bg-brand-700 p-4 text-white">
                      <p className="text-[10px] uppercase tracking-wider text-brand-100">Net sales today</p>
                      <p className="mt-1 font-mono text-2xl font-semibold">UGX 2,482,600</p>
                      <div className="mt-3 flex items-center gap-3 text-[10px] text-brand-100">
                        <span>146 receipts</span>
                        <span>·</span>
                        <span>avg UGX 17,004</span>
                      </div>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      {[
                        { label: 'Gross profit', value: 'UGX 612,400' },
                        { label: 'Refunds', value: 'UGX 32,000' },
                        { label: 'Cash', value: 'UGX 1.41m' },
                        { label: 'Mobile money', value: 'UGX 1.07m' },
                      ].map((stat) => (
                        <div key={stat.label} className="rounded-lg border border-ink-100 bg-ink-50/60 p-2.5">
                          <p className="text-[9px] uppercase tracking-wide text-ink-500">{stat.label}</p>
                          <p className="mt-0.5 font-mono text-[11px] font-semibold text-ink-900">{stat.value}</p>
                        </div>
                      ))}
                    </div>
                    <div className="mt-3 flex items-end gap-1.5" aria-hidden>
                      {[40, 62, 48, 76, 58, 88, 72, 95, 64, 78, 90, 68].map((height, index) => (
                        <div
                          key={index}
                          className="flex-1 rounded-sm bg-brand-200"
                          style={{ height: `${height * 0.6}px` }}
                        />
                      ))}
                    </div>
                  </div>
                  <div className="p-4">
                    <div className="mb-2 flex items-center justify-between">
                      <p className="text-xs font-semibold text-ink-800">Current sale</p>
                      <span className="text-[10px] font-medium text-brand-600">● Synced</span>
                    </div>
                    <div className="space-y-2">
                      {[
                        { name: 'Sugar 1kg', qty: '2', price: '9,600' },
                        { name: 'Cooking oil 1L', qty: '1', price: '12,500' },
                        { name: 'Bar soap', qty: '3', price: '10,500' },
                        { name: 'Maize flour 2kg', qty: '1', price: '7,800' },
                      ].map((line) => (
                        <div key={line.name} className="flex items-center justify-between rounded-lg border border-ink-100 px-2.5 py-2">
                          <div>
                            <p className="text-[11px] font-medium text-ink-900">{line.name}</p>
                            <p className="text-[9px] text-ink-400">Qty {line.qty}</p>
                          </div>
                          <p className="font-mono text-[10px] font-semibold text-ink-700">{line.price}</p>
                        </div>
                      ))}
                    </div>
                    <div className="mt-3 rounded-lg bg-ink-50 p-3">
                      <div className="flex justify-between text-[10px] text-ink-500">
                        <span>Subtotal</span>
                        <span className="font-mono">40,400</span>
                      </div>
                      <div className="mt-1 flex justify-between text-[10px] text-ink-500">
                        <span>VAT 18%</span>
                        <span className="font-mono">7,272</span>
                      </div>
                      <div className="mt-2 flex justify-between border-t border-ink-200 pt-2 text-xs font-semibold text-ink-950">
                        <span>Total</span>
                        <span className="font-mono">UGX 47,672</span>
                      </div>
                    </div>
                    <div className="btn-primary mt-3 w-full py-2.5 text-center text-xs" aria-hidden>
                      Charge UGX 47,672
                    </div>
                    <p className="mt-2 text-center text-[9px] text-ink-400">Cash · Mobile money · Card · Bank</p>
                  </div>
                </div>
              </div>
              <div className="absolute -bottom-5 -left-4 hidden items-center gap-2 rounded-xl border border-ink-200 bg-white px-3 py-2 shadow-pop sm:flex">
                <span className="grid h-8 w-8 place-items-center rounded-lg bg-accent-50 text-accent-700">
                  <WifiOff className="h-4 w-4" />
                </span>
                <div>
                  <p className="text-[10px] font-semibold text-ink-900">3 sales queued offline</p>
                  <p className="text-[9px] text-ink-500">Will sync automatically</p>
                </div>
              </div>
              <p className="mt-7 text-center text-[10px] text-ink-400">
                Illustrative product preview — not live business data.
              </p>
            </div>
          </div>
        </section>

        <section id="product" className="border-y border-ink-200/70 bg-white py-16">
          <div className="mx-auto max-w-6xl px-5">
            <div className="max-w-2xl">
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-brand-600">One operating system</p>
              <h2 className="mt-2 text-3xl font-bold tracking-tight text-ink-950 sm:text-[36px]">
                Everything the counter needs. Nothing it doesn&apos;t.
              </h2>
              <p className="mt-3 text-ink-600">
                Six connected modules share the same products, prices, stock and permissions — so a sale
                immediately shows up in inventory, reporting and the audit trail.
              </p>
            </div>
            <div className="mt-9 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map((feature) => (
                <article key={feature.title} className="rounded-xl border border-ink-200/80 bg-[#fbfcfb] p-5">
                  <span className="grid h-10 w-10 place-items-center rounded-lg bg-brand-50 text-brand-700">{feature.icon}</span>
                  <h3 className="mt-4 text-[15px] font-semibold text-ink-950">{feature.title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-ink-600">{feature.body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="offline" className="py-16">
          <div className="mx-auto grid max-w-6xl gap-10 px-5 lg:grid-cols-2 lg:items-center">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-accent-700">Offline is a feature, not an error</p>
              <h2 className="mt-2 text-3xl font-bold tracking-tight text-ink-950">
                The queue is honest. The ledger is authoritative.
              </h2>
              <p className="mt-3 text-ink-600">
                A completed offline sale is stored with a device-generated identifier and replayed exactly
                once. The server re-prices and re-checks stock against live data. If another till sold the
                last unit first, the sale is held as a conflict for a manager — with the requested and
                available quantities on screen.
              </p>
              <ol className="mt-6 space-y-4">
                {[
                  ['Saved on the device', 'The receipt is printed and the local stock count updated immediately.'],
                  ['Synced with an idempotency key', 'Retries and refreshes can never create a duplicate sale.'],
                  ['Conflicts go to a human', 'Stock is never silently overwritten and queued sales are never discarded.'],
                ].map(([title, body], index) => (
                  <li key={title} className="flex gap-3">
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand-700 font-mono text-[11px] font-bold text-white">
                      {index + 1}
                    </span>
                    <div>
                      <p className="text-sm font-semibold text-ink-900">{title}</p>
                      <p className="text-sm text-ink-600">{body}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
            <div className="rounded-2xl border border-ink-200 bg-white p-6 shadow-card">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-ink-900">Sync centre</p>
                <span className="badge-amber">1 conflict</span>
              </div>
              <div className="mt-4 space-y-3">
                {[
                  { id: 'LOCAL-7F3A', text: '2 × Avocado', state: 'Synced', tone: 'badge-green' },
                  { id: 'LOCAL-91C2', text: '1 × Cooking oil 1L', state: 'Synced', tone: 'badge-green' },
                  { id: 'LOCAL-A40D', text: '7 × Coca-Cola 500ml', state: 'Conflict', tone: 'badge-red' },
                ].map((row) => (
                  <div key={row.id} className="flex items-center justify-between rounded-lg border border-ink-100 px-3 py-2.5">
                    <div>
                      <p className="font-mono text-[10px] text-ink-400">{row.id}</p>
                      <p className="text-xs font-medium text-ink-800">{row.text}</p>
                    </div>
                    <span className={row.tone}>{row.state}</span>
                  </div>
                ))}
              </div>
              <div className="mt-4 rounded-lg bg-red-50 p-3 text-xs text-red-800">
                <p className="font-semibold">Only 4 units were available on the server.</p>
                <p className="mt-1 text-red-700">Reconcile stock and retry, or void the local receipt after recording the decision.</p>
              </div>
            </div>
          </div>
        </section>

        <section id="pricing" className="border-t border-ink-200/70 bg-white py-16">
          <div className="mx-auto max-w-5xl px-5">
            <div className="text-center">
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-brand-600">Straightforward plans</p>
              <h2 className="mt-2 text-3xl font-bold tracking-tight text-ink-950">Start small. Grow by branch, not by spreadsheet.</h2>
            </div>
            <div className="mt-9 grid gap-4 md:grid-cols-3">
              {[
                {
                  name: 'Starter',
                  price: 'UGX 0',
                  period: '30-day trial',
                  items: ['1 branch', '3 users', 'POS & inventory', 'Core sales reports'],
                  cta: 'Start trial',
                  featured: false,
                },
                {
                  name: 'Growth',
                  price: 'Talk to us',
                  period: 'multi-branch retail',
                  items: ['3 branches', '15 users', 'Offline sync centre', 'Advanced reports & assistant'],
                  cta: 'Start trial',
                  featured: true,
                },
                {
                  name: 'Enterprise',
                  price: 'Custom',
                  period: 'chain operations',
                  items: ['Unlimited branches', 'Unlimited users', 'Priority support', 'Audit export'],
                  cta: 'Start trial',
                  featured: false,
                },
              ].map((plan) => (
                <article
                  key={plan.name}
                  className={
                    plan.featured
                      ? 'relative rounded-2xl border-2 border-brand-600 bg-brand-700 p-6 text-white shadow-pop'
                      : 'rounded-2xl border border-ink-200 bg-white p-6'
                  }
                >
                  {plan.featured ? (
                    <span className="absolute -top-3 left-5 rounded-full bg-accent-400 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-accent-950">
                      Most popular
                    </span>
                  ) : null}
                  <p className={plan.featured ? 'text-sm font-semibold text-brand-100' : 'text-sm font-semibold text-ink-600'}>{plan.name}</p>
                  <p className="mt-2 font-mono text-2xl font-semibold">{plan.price}</p>
                  <p className={plan.featured ? 'text-xs text-brand-200' : 'text-xs text-ink-500'}>{plan.period}</p>
                  <ul className="mt-4 space-y-2 text-sm">
                    {plan.items.map((item) => (
                      <li key={item} className="flex items-center gap-2">
                        <Check className={plan.featured ? 'h-3.5 w-3.5 text-accent-300' : 'h-3.5 w-3.5 text-brand-600'} />
                        {item}
                      </li>
                    ))}
                  </ul>
                  <Link
                    href="/register"
                    className={plan.featured ? 'btn mt-6 w-full bg-white text-brand-800 hover:bg-brand-50' : 'btn-secondary mt-6 w-full'}
                  >
                    {plan.cta}
                  </Link>
                </article>
              ))}
            </div>
            <p className="mt-5 text-center text-xs text-ink-500">
              Plans are configured in the product; billing is not connected in this deployment. No payment is collected.
            </p>
          </div>
        </section>

        <section className="py-14">
          <div className="mx-auto max-w-6xl px-5">
            <div className="rounded-2xl bg-ink-950 px-6 py-9 text-white sm:px-10">
              <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-2xl font-bold text-white sm:text-3xl">Open your shop in the next five minutes.</h2>
                  <p className="mt-2 max-w-xl text-sm text-ink-300">
                    Create the workspace, add your products and start trading. Offline sync is included
                    from the first sale.
                  </p>
                </div>
                <Link href="/register" className="btn-primary btn-lg shrink-0">
                  Create a workspace <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-ink-200 bg-white py-8">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-5 text-xs text-ink-500 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <span className="grid h-6 w-6 place-items-center rounded-md bg-brand-700 text-[10px] font-black text-white">K</span>
            <span>© {new Date().getFullYear()} KampalaSmart. Built for African retail.</span>
          </div>
          <div className="flex items-center gap-4">
            <span className="inline-flex items-center gap-1.5"><LockKeyhole className="h-3.5 w-3.5" /> Tenant-isolated data</span>
            <span className="inline-flex items-center gap-1.5"><Smartphone className="h-3.5 w-3.5" /> PWA-ready</span>
            <span className="inline-flex items-center gap-1.5"><Store className="h-3.5 w-3.5" /> Multi-branch</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
