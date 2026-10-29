/**
 * Formats an ISO date or YYYY-MM-DD string as DD/MM/YYYY (French / Moroccan standard).
 */
export function formatDateFR(dateStr: string | null | undefined): string {
  if (!dateStr) return '—'
  const d = new Date(dateStr)
  if (Number.isNaN(d.getTime())) return dateStr
  const day = String(d.getDate()).padStart(2, '0')
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const year = d.getFullYear()
  return `${day}/${month}/${year}`
}

/**
 * Formats an ISO timestamp as DD/MM/YYYY HH:mm.
 */
export function formatDateTimeFR(dateStr: string | null | undefined): string {
  if (!dateStr) return '—'
  const d = new Date(dateStr)
  if (Number.isNaN(d.getTime())) return dateStr
  const day = String(d.getDate()).padStart(2, '0')
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const year = d.getFullYear()
  const hours = String(d.getHours()).padStart(2, '0')
  const mins = String(d.getMinutes()).padStart(2, '0')
  return `${day}/${month}/${year} ${hours}:${mins}`
}

/**
 * Formats a numeric amount in MAD (DH) with 2 decimals and French number formatting.
 */
export function formatMAD(amount: number | null | undefined): string {
  if (amount === null || amount === undefined || Number.isNaN(amount)) {
    return '—'
  }
  const formatted = new Intl.NumberFormat('fr-MA', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount)
  return `${formatted} DH`
}

/**
 * Formats a stock quantity cleanly (up to 3 decimals, trimming trailing zeros).
 */
export function formatQty(qty: number | null | undefined): string {
  if (qty === null || qty === undefined || Number.isNaN(qty)) {
    return '0'
  }
  return new Intl.NumberFormat('fr-MA', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  }).format(qty)
}

