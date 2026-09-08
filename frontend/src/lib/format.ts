/**
 * [Design-system audit] Shared Indian-Rupee formatting for the whole app.
 *
 * Before this file existed, every page that showed a rupee figure rolled
 * its own version of "divide by 1e5/1e7 and slap a unit on it" - three
 * different implementations existed with three different decimal
 * precisions and thresholds (RiskSandbox's local formatRupees showed
 * Lakh with 0 decimals, optimize/page.tsx's formatINR showed 1 decimal,
 * and RiskSandbox's own "Optimized Cost" line didn't even call its
 * neighboring helper - it inlined a third, Cr-unaware version that would
 * have mis-rendered any optimizer total over Rs 1 Cr as an oversized
 * "150.0L" instead of "1.50 Cr"). A user comparing two screens had no way
 * to know whether Rs 42,013,829.75 and Rs 4.2 Cr were the same number.
 *
 * Three forms, three jobs - see the "Financial formatting" table this
 * mirrors:
 *   - formatRupeesCompact: KPI chips, budget sliders, per-control costs -
 *     anywhere the number needs to switch between Lakh/Crore depending on
 *     size. 1 decimal in Lakh, 2 decimals in Crore.
 *   - formatRupeesCr: headline figures (ALE, VaR) and chart axes/tooltips
 *     that should NEVER silently change units point-to-point - always
 *     Crore, always 2 decimals, so an axis or a card never flips units
 *     under the reader.
 *   - formatRupeesExact: tooltips/audit & provenance views where the
 *     precise canonical value matters - real en-IN digit grouping
 *     (Rs 4,21,37,500), not a plain 1,000,000-style Western grouping.
 */

export function formatRupeesCompact(amount: number, opts?: { decimals?: number }): string {
    if (!Number.isFinite(amount)) return '₹0';
    const sign = amount < 0 ? '-' : '';
    const abs = Math.abs(amount);
    if (abs >= 10000000) {
        const decimals = opts?.decimals ?? 2;
        return `${sign}₹${(abs / 10000000).toFixed(decimals)} Cr`;
    }
    if (abs >= 100000) {
        const decimals = opts?.decimals ?? 1;
        return `${sign}₹${(abs / 100000).toFixed(decimals)}L`;
    }
    return `${sign}₹${Math.round(abs).toLocaleString('en-IN')}`;
}

export function formatRupeesCr(amount: number, decimals = 2): string {
    if (!Number.isFinite(amount)) return `₹0.00 Cr`;
    const sign = amount < 0 ? '-' : '';
    return `${sign}₹${(Math.abs(amount) / 10000000).toFixed(decimals)} Cr`;
}

const exactInrFormatter = new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
});

export function formatRupeesExact(amount: number): string {
    if (!Number.isFinite(amount)) return exactInrFormatter.format(0);
    return exactInrFormatter.format(amount);
}
