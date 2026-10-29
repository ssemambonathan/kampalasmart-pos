import type { PaymentMethod, PricedCart } from '@kampalasmart/shared';
import { PAYMENT_METHOD_LABELS } from '@kampalasmart/shared';
import { formatDate, formatMoney, formatQuantity } from '@/lib/format';

export interface ReceiptItem {
  name: string;
  sku?: string;
  quantity: string;
  unitPrice: string;
  lineTotal: string;
}

export interface ReceiptPayment {
  method: string;
  amount: string;
  reference?: string | null;
}

export interface ReceiptData {
  businessName: string;
  address?: string | null;
  phone?: string | null;
  footer?: string | null;
  currency: string;
  reference: string;
  branchName: string;
  cashierName?: string | null;
  customerName?: string | null;
  createdAt: string;
  items: ReceiptItem[];
  subtotal: string;
  discountTotal: string;
  taxTotal: string;
  total: string;
  payments: ReceiptPayment[];
  pendingNote?: string | null;
  taxLabel?: string;
}

export function receiptFromPricedCart(input: {
  businessName: string;
  address?: string | null;
  phone?: string | null;
  footer?: string | null;
  currency: string;
  reference: string;
  branchName: string;
  cashierName?: string | null;
  customerName?: string | null;
  createdAt: string;
  cart: PricedCart;
  payments: ReceiptPayment[];
  pendingNote?: string | null;
}): ReceiptData {
  const taxRates = [...new Set(input.cart.lines.map((line) => line.taxRate).filter((rate) => Number(rate) > 0))];
  return {
    businessName: input.businessName,
    address: input.address,
    phone: input.phone,
    footer: input.footer,
    currency: input.currency,
    reference: input.reference,
    branchName: input.branchName,
    cashierName: input.cashierName,
    customerName: input.customerName,
    createdAt: input.createdAt,
    items: input.cart.lines.map((line) => ({
      name: line.name,
      sku: line.sku,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      lineTotal: line.lineTotal,
    })),
    subtotal: input.cart.subtotal,
    discountTotal: input.cart.discountTotal,
    taxTotal: input.cart.taxTotal,
    total: input.cart.total,
    payments: input.payments,
    pendingNote: input.pendingNote ?? null,
    taxLabel: taxRates.length ? `VAT ${taxRates.join('/')}%` : 'Tax',
  };
}

export function ReceiptView({ data }: { data: ReceiptData }) {
  return (
    <div className="mx-auto w-full max-w-[320px] rounded-lg border border-ink-200 bg-white p-4 font-mono text-[11px] leading-snug text-ink-900">
      <div className="text-center">
        <p className="text-sm font-bold uppercase tracking-wide">{data.businessName}</p>
        {data.address ? <p className="mt-0.5 text-[10px] text-ink-600">{data.address}</p> : null}
        {data.phone ? <p className="text-[10px] text-ink-600">{data.phone}</p> : null}
        <p className="mt-1 text-[10px] text-ink-500">{data.branchName}</p>
      </div>
      <div className="my-2 border-t border-dashed border-ink-300" />
      <div className="flex justify-between text-[10px] text-ink-600">
        <span>{data.reference}</span>
        <span>{formatDate(data.createdAt, true)}</span>
      </div>
      {data.cashierName ? <p className="text-[10px] text-ink-600">Served by {data.cashierName}</p> : null}
      {data.customerName ? <p className="text-[10px] text-ink-600">Customer: {data.customerName}</p> : null}
      <div className="my-2 border-t border-dashed border-ink-300" />
      <table className="w-full text-[10px]">
        <tbody>
          {data.items.map((item, index) => (
            <tr key={`${item.name}-${index}`} className="align-top">
              <td className="py-0.5 pr-1">{item.name}</td>
              <td className="whitespace-nowrap py-0.5 text-right">{formatQuantity(item.quantity)}</td>
              <td className="whitespace-nowrap py-0.5 pl-2 text-right">{formatMoney(item.lineTotal, data.currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="my-2 border-t border-dashed border-ink-300" />
      <div className="space-y-0.5">
        <Row label="Subtotal" value={formatMoney(data.subtotal, data.currency)} />
        {Number(data.discountTotal) > 0 ? (
          <Row label="Discount" value={`-${formatMoney(data.discountTotal, data.currency)}`} />
        ) : null}
        {Number(data.taxTotal) > 0 ? (
          <Row label={data.taxLabel ?? 'Tax'} value={formatMoney(data.taxTotal, data.currency)} />
        ) : null}
        <div className="flex justify-between border-t border-ink-300 pt-1 text-[12px] font-bold">
          <span>TOTAL</span>
          <span>{formatMoney(data.total, data.currency)}</span>
        </div>
      </div>
      <div className="mt-2 space-y-0.5 text-[10px] text-ink-600">
        {data.payments.map((payment, index) => (
          <Row
            key={`${payment.method}-${index}`}
            label={PAYMENT_METHOD_LABELS[payment.method as PaymentMethod] ?? payment.method}
            value={formatMoney(payment.amount, data.currency)}
          />
        ))}
      </div>
      {data.pendingNote ? (
        <div className="mt-2 border border-dashed border-accent-400 bg-accent-50 p-1.5 text-center text-[9px] font-semibold uppercase tracking-wide text-accent-800">
          {data.pendingNote}
        </div>
      ) : null}
      <div className="mt-3 text-center text-[9px] text-ink-500">
        <p>{data.footer ?? 'Thank you for shopping with us.'}</p>
        <p className="mt-1">Powered by KampalaSmart</p>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}
