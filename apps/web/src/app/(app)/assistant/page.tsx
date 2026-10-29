'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  ArrowUp,
  BarChart3,
  CircleHelp,
  Eraser,
  Info,
  Lightbulb,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import type { AssistantAnswer } from '@kampalasmart/shared';
import { useAuth } from '@/lib/auth';
import { api, errorMessage } from '@/lib/api';
import { formatMoney, formatNumber, formatPercent, titleCase } from '@/lib/format';
import { PermissionNotice } from '@/components/export-button';
import { Spinner, cn } from '@/components/ui';

interface Capabilities {
  engine: string;
  externalProvider: boolean;
  description: string;
  examples: string[];
  limitations: string[];
}

type Message =
  | { id: string; role: 'user'; text: string }
  | { id: string; role: 'assistant'; answer: AssistantAnswer }
  | { id: string; role: 'assistant'; error: string };

const MONEY_KEYS = /(sales|revenue|profit|cost|refund|discount|average|amount|change|value|spent|tax)/i;
const PERCENT_KEYS = /percent/i;

function metricLabel(key: string): string {
  return titleCase(key.replace(/([A-Z])/g, ' $1').trim());
}

function metricValue(key: string, value: string | number, currency: string): string {
  if (PERCENT_KEYS.test(key)) return formatPercent(Number(value), 1);
  if (MONEY_KEYS.test(key) && Number.isFinite(Number(value))) return formatMoney(String(value), currency);
  if (typeof value === 'number') return formatNumber(value);
  return value;
}

function newId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`;
}

function AnswerCard({ answer, currency }: { answer: AssistantAnswer; currency: string }) {
  const metrics = Object.entries(answer.metrics ?? {});
  return (
    <div className="max-w-[92%] rounded-2xl rounded-tl-sm border border-ink-200 bg-white px-4 py-3 shadow-sm">
      <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-brand-600">
        <Sparkles className="h-3 w-3" /> Grounded answer
      </div>
      <p className="whitespace-pre-line text-sm leading-relaxed text-ink-800">{answer.answer}</p>
      {metrics.length ? (
        <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {metrics.map(([key, value]) => (
            <div key={key} className="rounded-lg border border-ink-100 bg-ink-50/60 px-2.5 py-2">
              <dt className="truncate text-[10px] font-semibold uppercase tracking-wide text-ink-400" title={metricLabel(key)}>
                {metricLabel(key)}
              </dt>
              <dd className="mt-0.5 truncate font-mono text-xs font-semibold text-ink-900">
                {metricValue(key, value, currency)}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      {answer.suggestions.length ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {answer.suggestions.map((suggestion) => (
            <span
              key={suggestion}
              className="rounded-full border border-ink-200 bg-ink-50 px-2 py-0.5 text-[11px] text-ink-600"
            >
              {suggestion}
            </span>
          ))}
        </div>
      ) : null}
      <p className="mt-2 text-[10px] text-ink-400">
        Computed by the {answer.generatedBy === 'RULES_ENGINE' ? 'rules engine' : 'configured provider'} from
        recorded transactions.
      </p>
    </div>
  );
}

export default function AssistantPage() {
  const { business, activeLocation, activeLocationId, can } = useAuth();
  const currency = business?.currency ?? 'UGX';
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const endRef = useRef<HTMLDivElement>(null);
  const allowed = can('assistant:use') && can('analytics:read');

  const capabilities = useQuery({
    queryKey: ['assistant-capabilities'],
    queryFn: () => api.get<Capabilities>('/assistant/capabilities'),
    enabled: allowed,
    staleTime: 10 * 60_000,
  });

  const ask = useMutation({
    mutationFn: (question: string) =>
      api.post<AssistantAnswer>('/assistant/ask', {
        question,
        locationId: activeLocationId || undefined,
      }),
    onSuccess: (answer) => {
      setMessages((current) => [...current, { id: newId(), role: 'assistant', answer }]);
    },
    onError: (error) => {
      setMessages((current) => [
        ...current,
        { id: newId(), role: 'assistant', error: errorMessage(error) },
      ]);
    },
  });

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, ask.isPending]);

  const submit = (question: string) => {
    const trimmed = question.trim();
    if (trimmed.length < 3 || ask.isPending) return;
    setMessages((current) => [...current, { id: newId(), role: 'user', text: trimmed }]);
    setInput('');
    ask.mutate(trimmed);
  };

  if (!allowed) {
    return (
      <div>
        <h1 className="mb-5 text-2xl font-semibold tracking-tight text-ink-950">Business assistant</h1>
        <PermissionNotice area="the business assistant" />
      </div>
    );
  }

  const examples = capabilities.data?.examples ?? [];

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="mb-1 text-[11px] font-bold uppercase tracking-[0.16em] text-brand-600">Insight</p>
          <h1 className="text-2xl font-semibold tracking-tight text-ink-950 sm:text-[28px]">Business assistant</h1>
          <p className="mt-1 max-w-2xl text-sm text-ink-500">
            Ask plain-language questions about {activeLocation?.name ?? 'your business'}. Answers are computed from
            recorded sales, stock and purchasing data — no invented figures.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-brand-200 bg-brand-50 px-2.5 py-1 text-[11px] font-semibold text-brand-700">
            <ShieldCheck className="h-3.5 w-3.5" />
            {capabilities.data?.externalProvider ? 'External provider connected' : 'Rules engine · no external AI'}
          </span>
          <button
            type="button"
            className="btn-secondary btn-sm"
            onClick={() => setMessages([])}
            disabled={!messages.length}
          >
            <Eraser className="h-3.5 w-3.5" /> Clear
          </button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
        <div className="card flex min-h-[560px] flex-col overflow-hidden">
          <div className="flex items-center justify-between border-b border-ink-100 px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="grid h-8 w-8 place-items-center rounded-full bg-brand-700 text-white">
                <Sparkles className="h-4 w-4" />
              </span>
              <div>
                <p className="text-sm font-semibold text-ink-900">KampalaSmart assistant</p>
                <p className="text-[11px] text-ink-500">
                  Scope: {activeLocation?.name ?? 'all branches'} · {business?.currency}
                </p>
              </div>
            </div>
            <Link href="/reports" className="btn-ghost btn-sm">
              <BarChart3 className="h-3.5 w-3.5" /> Reports
            </Link>
          </div>

          <div className="scroll-thin flex-1 overflow-y-auto bg-ink-50/40 px-4 py-4">
            {!messages.length ? (
              <div className="mx-auto max-w-lg py-8 text-center">
                <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-brand-100 text-brand-700">
                  <Sparkles className="h-5 w-5" />
                </span>
                <h2 className="mt-3 text-base font-semibold text-ink-900">What would you like to know?</h2>
                <p className="mt-1 text-sm text-ink-500">
                  Try one of these. The assistant will name the period and the figures it used.
                </p>
                <div className="mt-4 flex flex-wrap justify-center gap-1.5">
                  {(examples.length ? examples.slice(0, 6) : ['How much did we sell today?']).map((example) => (
                    <button
                      key={example}
                      type="button"
                      onClick={() => submit(example)}
                      className="rounded-full border border-ink-200 bg-white px-3 py-1.5 text-xs font-medium text-ink-700 hover:border-brand-300 hover:text-brand-700"
                    >
                      {example}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                {messages.map((message) =>
                  message.role === 'user' ? (
                    <div key={message.id} className="flex justify-end">
                      <div className="max-w-[85%] rounded-2xl rounded-tr-sm bg-brand-700 px-4 py-2.5 text-sm text-white shadow-sm">
                        {message.text}
                      </div>
                    </div>
                  ) : 'error' in message ? (
                    <div key={message.id} className="max-w-[92%] rounded-2xl rounded-tl-sm border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                      <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-red-600">No answer</p>
                      {message.error}
                    </div>
                  ) : (
                    <AnswerCard key={message.id} answer={message.answer} currency={currency} />
                  ),
                )}
                {ask.isPending ? (
                  <div className="flex items-center gap-2 text-xs text-ink-500">
                    <Spinner /> Reading your recorded data…
                  </div>
                ) : null}
                <div ref={endRef} />
              </div>
            )}
          </div>

          <form
            className="border-t border-ink-100 bg-white px-3 py-3"
            onSubmit={(event) => {
              event.preventDefault();
              submit(input);
            }}
          >
            <div className="flex items-end gap-2">
              <label htmlFor="assistant-question" className="sr-only">
                Ask a business question
              </label>
              <textarea
                id="assistant-question"
                className="textarea min-h-[44px] flex-1 resize-none !py-2.5"
                rows={1}
                value={input}
                maxLength={300}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    submit(input);
                  }
                }}
                placeholder="e.g. Which products should I reorder this week?"
              />
              <button
                type="submit"
                className="btn-primary h-11 w-11 shrink-0 !px-0"
                disabled={input.trim().length < 3 || ask.isPending}
                aria-label="Ask"
              >
                {ask.isPending ? <Spinner /> : <ArrowUp className="h-4 w-4" />}
              </button>
            </div>
            <p className="mt-1.5 text-[10px] text-ink-400">
              Enter to send · Shift+Enter for a new line. This conversation lives in this browser tab only.
            </p>
          </form>
        </div>

        <aside className="space-y-4">
          <div className="card card-pad">
            <div className="flex items-center gap-2">
              <Lightbulb className="h-4 w-4 text-accent-600" />
              <h2 className="text-sm font-semibold text-ink-900">Questions it understands</h2>
            </div>
            {capabilities.isLoading ? (
              <div className="mt-2 space-y-2">
                <div className="skeleton h-3 w-4/5" />
                <div className="skeleton h-3 w-3/5" />
              </div>
            ) : (
              <ul className="mt-2 space-y-1">
                {(capabilities.data?.examples ?? []).map((example) => (
                  <li key={example}>
                    <button
                      type="button"
                      onClick={() => submit(example)}
                      className="w-full rounded-md px-2 py-1.5 text-left text-xs text-ink-600 hover:bg-ink-50 hover:text-brand-700"
                    >
                      “{example}”
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="card card-pad">
            <div className="flex items-center gap-2">
              <CircleHelp className="h-4 w-4 text-ink-500" />
              <h2 className="text-sm font-semibold text-ink-900">Limits, stated plainly</h2>
            </div>
            <ul className="mt-2 list-disc space-y-1.5 pl-4 text-[11px] leading-relaxed text-ink-500">
              {(capabilities.data?.limitations ?? [
                'Answers only cover recorded business data.',
                'Tax figures are bookkeeping aids, not filed returns.',
              ]).map((limitation) => (
                <li key={limitation}>{limitation}</li>
              ))}
            </ul>
          </div>

          <div className="rounded-xl border border-brand-200 bg-brand-50 px-3 py-2.5 text-[11px] leading-relaxed text-brand-900">
            <div className="flex items-center gap-1.5 font-semibold">
              <Info className="h-3.5 w-3.5" /> Data boundary
            </div>
            <p className="mt-1">
              {capabilities.data?.description ??
                'Answers are computed from this business’s own records. No external AI provider is called unless the owner connects one.'}
            </p>
          </div>
        </aside>
      </div>

      {capabilities.isError ? (
        <p className={cn('mt-3 text-xs text-red-600')}>{errorMessage(capabilities.error)}</p>
      ) : null}
    </div>
  );
}
