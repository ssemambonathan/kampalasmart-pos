'use client';

import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Package, X } from 'lucide-react';
import type { Paginated, Product } from '@kampalasmart/shared';
import { api } from '@/lib/api';
import { formatMoney, formatQuantity } from '@/lib/format';
import { Spinner, useDebounced } from './ui';

interface ProductListResponse extends Paginated<Product> {
  locationId: string;
}

export function ProductCombobox({
  value,
  onChange,
  locationId,
  placeholder = 'Search product by name, SKU or barcode…',
  disabled,
  autoFocus,
  showStock,
  showCost,
}: {
  value: Product | null;
  onChange: (product: Product | null) => void;
  locationId?: string;
  placeholder?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  showStock?: boolean;
  showCost?: boolean;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounced = useDebounced(query, 250);

  const results = useQuery({
    queryKey: ['product-combobox', debounced, locationId],
    queryFn: () =>
      api.get<ProductListResponse>('/products', {
        search: debounced || undefined,
        locationId,
        page: 1,
        pageSize: 15,
      }),
    enabled: open,
    staleTime: 30_000,
  });

  const options = results.data?.data ?? [];

  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, []);

  useEffect(() => {
    setActiveIndex(0);
  }, [debounced, open]);

  const choose = (product: Product) => {
    onChange(product);
    setQuery('');
    setOpen(false);
  };

  return (
    <div className="relative" ref={containerRef}>
      <div className="relative">
        <Package className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
        <input
          className="input pl-9 pr-9"
          value={open ? query : value ? `${value.name} · ${value.sku}` : query}
          placeholder={placeholder}
          disabled={disabled}
          autoFocus={autoFocus}
          autoComplete="off"
          role="combobox"
          aria-expanded={open}
          aria-controls="product-combobox-list"
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
            if (value) onChange(null);
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setActiveIndex((index) => Math.min(index + 1, Math.max(0, options.length - 1)));
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              setActiveIndex((index) => Math.max(0, index - 1));
            } else if (event.key === 'Enter' && open && options[activeIndex]) {
              event.preventDefault();
              choose(options[activeIndex]);
            } else if (event.key === 'Escape') {
              setOpen(false);
            }
          }}
        />
        {value ? (
          <button
            type="button"
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-ink-400 hover:bg-ink-100"
            onClick={() => onChange(null)}
            aria-label="Clear product"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>

      {open ? (
        <div
          id="product-combobox-list"
          role="listbox"
          className="absolute z-30 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-ink-200 bg-white py-1 shadow-pop"
        >
          {results.isLoading ? (
            <p className="flex items-center gap-2 px-3 py-3 text-xs text-ink-500">
              <Spinner /> Searching catalogue…
            </p>
          ) : results.isError ? (
            <p className="px-3 py-3 text-xs text-red-600">The catalogue could not be loaded.</p>
          ) : options.length === 0 ? (
            <p className="px-3 py-3 text-xs text-ink-500">No matching products.</p>
          ) : (
            options.map((product, index) => (
              <button
                key={product.id}
                type="button"
                role="option"
                aria-selected={index === activeIndex}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => choose(product)}
                className={`flex w-full items-start justify-between gap-3 px-3 py-2 text-left text-sm ${
                  index === activeIndex ? 'bg-brand-50' : 'hover:bg-ink-50'
                }`}
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium text-ink-900">{product.name}</span>
                  <span className="block text-[11px] text-ink-500">
                    {product.sku}
                    {product.barcode ? ` · ${product.barcode}` : ''}
                    {showStock && product.stock !== undefined ? ` · ${formatQuantity(product.stock)} on hand` : ''}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block font-mono text-xs font-semibold text-ink-800">
                    {formatMoney(showCost ? product.costPrice : product.sellingPrice)}
                  </span>
                  {showCost ? <span className="block text-[10px] text-ink-400">cost</span> : null}
                </span>
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
