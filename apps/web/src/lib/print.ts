export function printReceipt(): void {
  if (typeof document === 'undefined') return;
  document.body.classList.add('printing-receipt');
  const cleanup = () => {
    document.body.classList.remove('printing-receipt');
    window.removeEventListener('afterprint', cleanup);
  };
  window.addEventListener('afterprint', cleanup);
  window.setTimeout(() => {
    window.print();
    window.setTimeout(cleanup, 1500);
  }, 60);
}
