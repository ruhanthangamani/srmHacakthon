export function formatCurrencyINR(value: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatPercent(value: number, decimals = 1): string {
  return `${value.toFixed(decimals)}%`;
}

export function formatKm(value: number): string {
  return `${value.toFixed(1)} km`;
}

export function formatTons(value: number): string {
  return `${value.toFixed(1)} tons`;
}
