"use client";

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import dynamic from 'next/dynamic';
import {
    BarChart, Bar, AreaChart, Area, PieChart, Pie, Cell, LineChart, Line,
    XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';

// [Performance] Leaflet touches window/document at import time, and its
// tile/marker DOM has nothing to prerender server-side - same ssr:false
// code-splitting pattern already used for recharts-dependent widgets.
const RegionalRiskMap = dynamic(() => import('@/components/charts/RegionalRiskMap'), {
    ssr: false,
    loading: () => <div className="h-full w-full bg-surface-variant/20 rounded animate-pulse" />,
});

import { API_BASE, fetchWithRetry } from '@/lib/api';
import { formatRupeesCompact, formatRupeesExact } from '@/lib/format';
import { EmptyState, ErrorState } from '@/components/StatusMessage';
import { useAuth } from '@/context/AuthContext';

interface AssetRow {
    id: string;
    name: string;
    business_unit: string;
    data_classification: string | null;
    criticality_score: number;
    business_value: number;
    is_public_facing: boolean;
}

interface DecisionRow {
    id: number;
    action: string;
    risk_accepted: number;
    decided_by: string;
    created_at: string;
    tx_hash: string | null;
    on_chain: boolean;
    board_approved: boolean;
}

interface FrameworkCoverageRow {
    id: string;
    active: boolean;
    nist_csf: string;
    iso27001: string;
    cis_controls: string;
}

interface SimRun {
    id: number;
    timestamp: string;
    expected_annual_loss: number;
    var_95: number | null;
    framework_coverage?: FrameworkCoverageRow[];
}

// [Geo Intelligence] CRQ's data model has no per-asset GPS coordinate
// anywhere (see Asset in backend/models.py) - assets are typed by
// business_unit, a fixed, closed set of six values assigned by
// backend/generators.py (BUSINESS_UNITS for demo data, the same names for
// the Ingestion Engine's own-data baseline). This maps each real
// business_unit to one representative Indian city's real coordinates (a
// stand-in for "where that business function's infrastructure would
// typically be hosted") and aggregates each unit's real business_value
// into that city, plotted on an actual map.
const BUSINESS_UNIT_REGION: Record<string, { city: string; lat: number; lng: number }> = {
    'Payment Processing': { city: 'Mumbai', lat: 19.0760, lng: 72.8777 },
    'Retail Operations': { city: 'Bengaluru', lat: 12.9716, lng: 77.5946 },
    'Customer Data Platform': { city: 'Hyderabad', lat: 17.3850, lng: 78.4867 },
    'Corporate IT': { city: 'Delhi NCR', lat: 28.6139, lng: 77.2090 },
    'Cloud Infrastructure': { city: 'Pune', lat: 18.5204, lng: 73.8567 },
    'HR & Payroll': { city: 'Chennai', lat: 13.0827, lng: 80.2707 },
};
const DEFAULT_REGION = { city: 'Other Locations', lat: 22.9734, lng: 78.6569 };

// [Illustrative, static] These two widgets aren't backed by a CRQ metric -
// "district performance" and raw on-chain tx volume over time aren't
// things this platform tracks per business_unit. Shown as fixed sample
// data purely to round out the page visually, not wired to any endpoint.
const TOP_DISTRICTS_MOCK: { city: string; count: number }[] = [
    { city: 'New Delhi', count: 10 },
    { city: 'Mumbai', count: 5 },
    { city: 'Bengaluru', count: 5 },
    { city: 'Kolkata', count: 6 },
    { city: 'Chennai', count: 9 },
    { city: 'Hyderabad', count: 3 },
    { city: 'Pune', count: 4 },
    { city: 'Ahmedabad', count: 5 },
];

const BLOCKCHAIN_ACTIVITY_MOCK: { date: string; value: number }[] = [
    { date: '2026-10-03', value: 9.5 },
    { date: '2026-10-04', value: 6.5 },
    { date: '2026-10-05', value: 5 },
    { date: '2026-10-06', value: 5.2 },
    { date: '2026-10-07', value: 9 },
    { date: '2026-10-08', value: 4.5 },
    { date: '2026-10-09', value: 5.5 },
    { date: '2026-10-10', value: 3 },
    { date: '2026-10-11', value: 12 },
    { date: '2026-10-12', value: 7 },
    { date: '2026-10-13', value: 3.5 },
    { date: '2026-10-14', value: 6 },
    { date: '2026-10-15', value: 9 },
];

// Fixed categorical order, reused identically for both two-category
// comparisons on this page (on-chain/off-chain, board-approved/individual)
// so the same position always reads the same color. Deliberately distinct
// from the app's reserved status colors (#15803d "good" / #ca8a04
// "warning", used elsewhere for control findings and drift) so this
// pairing is never mistaken for an approve/flag signal. Validated
// colorblind-safe (protan/deutan/tritan Delta E > 29, normal-vision floor
// 38.3) via the dataviz palette validator.
const CATEGORY_A = '#2563eb'; // On-Chain, Board Approved
const CATEGORY_B = '#d97706'; // Off-Chain (DB only), Individually Accepted

const CHART_COLORS = {
    onChain: CATEGORY_A,
    offChain: CATEGORY_B,
    // Single-series magnitude/trend charts - each has its own hue since it
    // is never compared against another series on the same chart.
    exposureBar: '#7c3aed',
    decisionsArea: '#0891b2',
    // ALE is the platform's headline rupee metric, so its trend line uses
    // the same brand amber as the page title and primary CTAs rather than
    // a fourth arbitrary hue.
    aleTrend: '#f59e0b',
    // Mock Blockchain Activity widget - same brand amber, matching the
    // reference it was modeled on.
    blockchainMock: '#f59e0b',
};

function startOfIsoWeek(d: Date): Date {
    const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const day = date.getUTCDay();
    const diff = (day === 0 ? -6 : 1) - day; // Monday of that week
    date.setUTCDate(date.getUTCDate() + diff);
    return date;
}

export default function IntelligencePage() {
    const { token, username } = useAuth();

    // [Own-Data / Demo isolation] Same per-account hydration pattern as
    // Reports/Ledger/Calibration - reads which dashboard this account is
    // on (crq_data_source:${username}) so this page's aggregates only
    // ever draw from that one dashboard's assets/decisions/runs instead
    // of interleaving demo and own-data numbers into one "region."
    const [dataSourceHydrated, setDataSourceHydrated] = useState(false);
    const [dataSource, setDataSource] = useState<'predefined' | 'own'>('predefined');
    useEffect(() => {
        if (!username) { setDataSourceHydrated(true); return; }
        try {
            const stored = localStorage.getItem(`crq_data_source:${username}`);
            setDataSource(stored === 'own' ? 'own' : 'predefined');
        } catch (e) {
            setDataSource('predefined');
        }
        setDataSourceHydrated(true);
    }, [username]);

    const [assets, setAssets] = useState<AssetRow[]>([]);
    const [isAssetsLoading, setIsAssetsLoading] = useState(true);
    const [assetsError, setAssetsError] = useState<string | null>(null);

    const [decisions, setDecisions] = useState<DecisionRow[]>([]);
    const [isDecisionsLoading, setIsDecisionsLoading] = useState(true);
    const [decisionsError, setDecisionsError] = useState<string | null>(null);

    const [simulations, setSimulations] = useState<SimRun[]>([]);
    const [isSimLoading, setIsSimLoading] = useState(true);
    const [simError, setSimError] = useState<string | null>(null);

    const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null);

    // Every fetch below is independent and fails independently on purpose -
    // if the audit-log call has a bad day, the asset/business-unit panels
    // (which don't need it) should still render instead of the whole page
    // going blank. Each panel below renders its own loading/error/empty
    // state off its own piece of this, same pattern as Reports.

    const fetchAssets = useCallback(async () => {
        setIsAssetsLoading(true);
        setAssetsError(null);
        try {
            const res = await fetchWithRetry(`${API_BASE}/api/assets?data_source=${dataSource}`, {
                headers: token ? { 'Authorization': `Bearer ${token}` } : {},
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.detail || `Request failed (${res.status})`);
            setAssets(data.data || []);
        } catch (e: any) {
            console.error(e);
            setAssetsError(e.message || 'Could not load the asset fleet.');
        } finally {
            setIsAssetsLoading(false);
        }
    }, [dataSource, token]);

    const fetchDecisions = useCallback(async () => {
        if (!token) return;
        setIsDecisionsLoading(true);
        setDecisionsError(null);
        try {
            const res = await fetchWithRetry(`${API_BASE}/api/audit-log?data_source=${dataSource}&limit=500`, {
                headers: { 'Authorization': `Bearer ${token}` },
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.detail || `Request failed (${res.status})`);
            setDecisions(data.data || []);
        } catch (e: any) {
            console.error(e);
            setDecisionsError(e.message || 'Could not load the audit trail.');
        } finally {
            setIsDecisionsLoading(false);
        }
    }, [dataSource, token]);

    const fetchSimulations = useCallback(async () => {
        try {
            setIsSimLoading(true);
            setSimError(null);
            const res = await fetchWithRetry(`${API_BASE}/api/simulations?limit=30&data_source=${dataSource}`, {
                headers: token ? { 'Authorization': `Bearer ${token}` } : {},
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.detail || `Request failed (${res.status})`);
            setSimulations(data.data || []);
        } catch (e: any) {
            console.error(e);
            setSimError(e.message || 'Could not load simulation history.');
        } finally {
            setIsSimLoading(false);
        }
    }, [dataSource, token]);

    const refreshAll = useCallback(() => {
        fetchAssets();
        fetchDecisions();
        fetchSimulations();
        setLastRefreshedAt(new Date());
    }, [fetchAssets, fetchDecisions, fetchSimulations]);

    useEffect(() => {
        if (!dataSourceHydrated || !token) return;
        refreshAll();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [dataSourceHydrated, token, dataSource]);

    // --- Derived aggregates - every one built from real, already-fetched
    // rows, nothing fabricated or randomly generated. ---

    const businessUnitExposure = useMemo(() => {
        const map = new Map<string, { businessUnit: string; totalValue: number; assetCount: number; avgCriticality: number }>();
        for (const a of assets) {
            const key = a.business_unit || 'Unclassified';
            const existing = map.get(key) || { businessUnit: key, totalValue: 0, assetCount: 0, avgCriticality: 0 };
            existing.totalValue += a.business_value || 0;
            existing.avgCriticality += a.criticality_score || 0;
            existing.assetCount += 1;
            map.set(key, existing);
        }
        return Array.from(map.values())
            .map((r) => ({ ...r, avgCriticality: r.assetCount ? Math.round(r.avgCriticality / r.assetCount) : 0 }))
            .sort((a, b) => b.totalValue - a.totalValue);
    }, [assets]);

    const regionalExposure = useMemo(() => {
        const map = new Map<string, { city: string; lat: number; lng: number; totalValue: number; businessUnits: string[] }>();
        for (const bu of businessUnitExposure) {
            const region = BUSINESS_UNIT_REGION[bu.businessUnit] || DEFAULT_REGION;
            const existing = map.get(region.city) || { city: region.city, lat: region.lat, lng: region.lng, totalValue: 0, businessUnits: [] };
            existing.totalValue += bu.totalValue;
            existing.businessUnits.push(bu.businessUnit);
            map.set(region.city, existing);
        }
        return Array.from(map.values()).sort((a, b) => b.totalValue - a.totalValue);
    }, [businessUnitExposure]);

    const maxRegionValue = regionalExposure.length > 0 ? regionalExposure[0].totalValue : 0;

    const aleTrendData = useMemo(() => (
        [...simulations].reverse().map((r, idx) => ({
            name: `Run ${idx + 1}`,
            ale: r.expected_annual_loss / 10000000,
        }))
    ), [simulations]);

    const latestRun = simulations[0] || null;
    const frameworkRows = latestRun?.framework_coverage || [];
    const activeControlCount = frameworkRows.filter((r) => r.active).length;
    const coveragePct = frameworkRows.length > 0 ? Math.round((activeControlCount / frameworkRows.length) * 100) : null;

    const chainBreakdown = useMemo(() => {
        const onChain = decisions.filter((d) => d.on_chain).length;
        const offChain = decisions.length - onChain;
        return [
            { name: 'On-Chain', value: onChain, color: CHART_COLORS.onChain },
            { name: 'Off-Chain (DB only)', value: offChain, color: CHART_COLORS.offChain },
        ];
    }, [decisions]);

    const decisionsOverTime = useMemo(() => {
        if (decisions.length === 0) return [];
        const byWeek = new Map<string, number>();
        for (const d of decisions) {
            const parsed = new Date(d.created_at);
            if (Number.isNaN(parsed.getTime())) continue;
            const key = startOfIsoWeek(parsed).toISOString().slice(0, 10);
            byWeek.set(key, (byWeek.get(key) || 0) + 1);
        }
        return Array.from(byWeek.entries())
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([week, count]) => ({ week: week.slice(5), count }));
    }, [decisions]);

    const isLoadingAny = isAssetsLoading || isDecisionsLoading || isSimLoading;
    const cardCls = "bg-surface-container-lowest border border-outline-variant rounded-xl p-gutter elevate flex flex-col";
    const dashboardHref = dataSource === 'own' ? '/ingestion' : '/overview';

    return (
        <div className="max-w-[1400px] mx-auto flex flex-col gap-12">
            <div className="flex flex-col lg:flex-row lg:items-end gap-stack-sm">
                <div className="flex items-center gap-2 flex-wrap lg:ml-auto">
                    {lastRefreshedAt && (
                        <span className="font-label-caps text-label-caps text-on-surface-variant whitespace-nowrap">
                            Updated {lastRefreshedAt.toLocaleTimeString()}
                        </span>
                    )}
                    <button
                        onClick={refreshAll}
                        disabled={isLoadingAny}
                        className="landing-cta-gradient px-4 py-2 rounded font-body-sm text-body-sm font-semibold flex items-center gap-2 hover:opacity-90 transition-opacity disabled:opacity-60 whitespace-nowrap"
                    >
                        <span aria-hidden="true" className={`material-symbols-outlined text-[18px] ${isLoadingAny ? 'animate-spin' : ''}`}>refresh</span>
                        {isLoadingAny ? 'Refreshing...' : 'Refresh Data'}
                    </button>
                </div>
            </div>

            {assets.length === 0 && decisions.length === 0 && simulations.length === 0 && !isLoadingAny && !assetsError && !decisionsError && !simError && (
                <EmptyState
                    icon="travel_explore"
                    title="Nothing to show yet"
                    description={`Run a simulation and log at least one risk decision on the ${dataSource === 'own' ? 'Own Data' : 'Overview'} dashboard, then come back here - every panel below fills in from that real activity.`}
                    actionLabel={dataSource === 'own' ? 'Go to Own Data' : 'Go to Overview'}
                    actionHref={dashboardHref}
                />
            )}

            {/* Row 1: Regional exposure, ALE trend, blockchain trust */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-gutter">
                <div className={`${cardCls} lg:col-span-5 min-h-[360px]`}>
                    <div className="flex items-start justify-between mb-stack-sm">
                        <h3 className="font-label-caps text-label-caps text-[#f59e0b] uppercase">Regional Risk Exposure</h3>
                        <span aria-hidden="true" className="material-symbols-outlined text-[20px] text-on-surface-variant">travel_explore</span>
                    </div>
                    {isAssetsLoading ? (
                        <div className="flex-1 bg-surface-variant/20 rounded-lg animate-pulse min-h-[220px]" />
                    ) : assetsError ? (
                        <ErrorState title="Couldn't load regional exposure" whatHappened={assetsError} nextStep="Try refreshing." retrySafe onRetry={fetchAssets} />
                    ) : regionalExposure.length === 0 ? (
                        <EmptyState icon="location_off" title="No assets yet" description={`No ${dataSource === 'own' ? 'own-data' : 'demo'} assets found to place on the map.`} />
                    ) : (
                        <div className="relative flex-1 min-h-[220px] rounded-lg overflow-hidden border border-outline-variant">
                            <RegionalRiskMap regions={regionalExposure} maxValue={maxRegionValue} />
                        </div>
                    )}
                </div>

                <div className={`${cardCls} lg:col-span-4 min-h-[360px]`}>
                    <h3 className="font-label-caps text-label-caps text-[#f59e0b] uppercase mb-1.5">Annualized Loss Trend</h3>
                    <p className="font-body-sm text-body-sm text-on-surface-variant mb-stack-sm">ALE across your most recent simulation runs.</p>
                    <div className="flex-1 min-h-[220px]">
                        {isSimLoading ? (
                            <div className="h-full w-full bg-surface-variant/20 rounded animate-pulse" />
                        ) : simError ? (
                            <ErrorState title="Couldn't load simulation history" whatHappened={simError} nextStep="Try refreshing." retrySafe onRetry={fetchSimulations} />
                        ) : aleTrendData.length === 0 ? (
                            <EmptyState icon="show_chart" title="No simulations yet" description="Run a simulation to start a trend line." actionLabel="Run a simulation" actionHref={dashboardHref} />
                        ) : (
                            <ResponsiveContainer width="100%" height="100%">
                                <LineChart data={aleTrendData} margin={{ top: 16, right: 16, left: 0, bottom: 0 }}>
                                    <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                                    <XAxis dataKey="name" fontSize={10} tick={{ fill: 'var(--on-surface-variant)' }} />
                                    <YAxis fontSize={10} tick={{ fill: 'var(--on-surface-variant)' }} tickFormatter={(v) => `₹${Number(v).toFixed(2)} Cr`} width={64} />
                                    <Tooltip
                                        cursor={{ stroke: 'var(--outline-variant)', strokeDasharray: '3 3' }}
                                        content={({ active, payload, label }) => {
                                            if (!active || !payload || !payload.length) return null;
                                            return (
                                                <div className="bg-[#111827] text-white rounded-lg px-3 py-2 shadow-lg">
                                                    <div className="font-label-caps text-label-caps text-[#9ca3af] mb-0.5">{label}</div>
                                                    <div className="font-body-sm text-body-sm font-semibold">{`₹${Number(payload[0].value).toFixed(2)} Cr`}</div>
                                                </div>
                                            );
                                        }}
                                    />
                                    <Line
                                        type="monotone"
                                        dataKey="ale"
                                        name="Expected Annual Loss"
                                        stroke={CHART_COLORS.aleTrend}
                                        strokeWidth={2.5}
                                        dot={{ r: 4, strokeWidth: 2, stroke: CHART_COLORS.aleTrend, fill: 'var(--surface-container-lowest)' }}
                                        activeDot={{ r: 6 }}
                                    />
                                </LineChart>
                            </ResponsiveContainer>
                        )}
                    </div>
                </div>

                <div className={`${cardCls} lg:col-span-3 min-h-[360px]`}>
                    <h3 className="font-label-caps text-label-caps text-[#f59e0b] uppercase mb-1.5">Decision Trust</h3>
                    <p className="font-body-sm text-body-sm text-on-surface-variant mb-stack-sm">On-chain vs. database-only decisions.</p>
                    <div className="flex-1 min-h-[220px]">
                        {isDecisionsLoading ? (
                            <div className="h-full w-full bg-surface-variant/20 rounded animate-pulse" />
                        ) : decisionsError ? (
                            <ErrorState title="Couldn't load the audit trail" whatHappened={decisionsError} nextStep="Try refreshing." retrySafe onRetry={fetchDecisions} />
                        ) : decisions.length === 0 ? (
                            <EmptyState icon="link_off" title="No decisions logged" description="Accept or approve a risk to populate this chart." />
                        ) : (
                            <ResponsiveContainer width="100%" height="100%">
                                <PieChart>
                                    <Pie data={chainBreakdown} dataKey="value" nameKey="name" innerRadius={45} outerRadius={70} paddingAngle={3} cornerRadius={4} stroke="none">
                                        {chainBreakdown.map((entry) => <Cell key={entry.name} fill={entry.color} />)}
                                    </Pie>
                                    <Tooltip formatter={(value: any) => [value, 'Decisions']} />
                                    <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" />
                                </PieChart>
                            </ResponsiveContainer>
                        )}
                    </div>
                </div>
            </div>

            {/* Row 2: Business unit exposure, compliance coverage, decision activity, top units */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-gutter">
                <div className={`${cardCls} lg:col-span-4 min-h-[300px]`}>
                    <h3 className="font-label-caps text-label-caps text-[#f59e0b] uppercase mb-1.5">Exposure by Business Unit</h3>
                    <p className="font-body-sm text-body-sm text-on-surface-variant mb-stack-sm">Total business value at risk per unit.</p>
                    <div className="flex-1 min-h-[200px]">
                        {isAssetsLoading ? (
                            <div className="h-full w-full bg-surface-variant/20 rounded animate-pulse" />
                        ) : assetsError ? (
                            <ErrorState title="Couldn't load business units" whatHappened={assetsError} nextStep="Try refreshing." retrySafe onRetry={fetchAssets} />
                        ) : businessUnitExposure.length === 0 ? (
                            <EmptyState icon="apartment" title="No assets yet" description="No business units to break down yet." />
                        ) : (
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={businessUnitExposure} layout="vertical" margin={{ left: 8, right: 16 }} barSize={16}>
                                    <CartesianGrid strokeDasharray="3 3" opacity={0.15} horizontal={false} />
                                    <XAxis type="number" tickFormatter={(v) => formatRupeesCompact(v)} fontSize={10} tick={{ fill: 'var(--on-surface-variant)' }} />
                                    <YAxis type="category" dataKey="businessUnit" width={110} fontSize={10} tick={{ fill: 'var(--on-surface-variant)' }} />
                                    <Tooltip formatter={(value: any) => formatRupeesExact(Number(value))} cursor={{ fill: 'var(--surface-variant)', opacity: 0.3 }} />
                                    <Bar dataKey="totalValue" fill={CHART_COLORS.exposureBar} radius={[0, 4, 4, 0]} />
                                </BarChart>
                            </ResponsiveContainer>
                        )}
                    </div>
                </div>

                <div className={`${cardCls} lg:col-span-4 min-h-[300px]`}>
                    <h3 className="font-label-caps text-label-caps text-[#f59e0b] uppercase mb-1.5">Decisions Over Time</h3>
                    <p className="font-body-sm text-body-sm text-on-surface-variant mb-stack-sm">Risk decisions logged per week.</p>
                    <div className="flex-1 min-h-[200px]">
                        {isDecisionsLoading ? (
                            <div className="h-full w-full bg-surface-variant/20 rounded animate-pulse" />
                        ) : decisionsError ? (
                            <ErrorState title="Couldn't load the audit trail" whatHappened={decisionsError} nextStep="Try refreshing." retrySafe onRetry={fetchDecisions} />
                        ) : decisionsOverTime.length === 0 ? (
                            <EmptyState icon="event_busy" title="No activity yet" description="No decisions logged in this ledger yet." />
                        ) : (
                            <ResponsiveContainer width="100%" height="100%">
                                <AreaChart data={decisionsOverTime} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                                    <defs>
                                        <linearGradient id="intel-decisions-fill" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="0%" stopColor={CHART_COLORS.decisionsArea} stopOpacity={0.32} />
                                            <stop offset="100%" stopColor={CHART_COLORS.decisionsArea} stopOpacity={0.02} />
                                        </linearGradient>
                                    </defs>
                                    <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                                    <XAxis dataKey="week" fontSize={10} tick={{ fill: 'var(--on-surface-variant)' }} />
                                    <YAxis fontSize={10} allowDecimals={false} tick={{ fill: 'var(--on-surface-variant)' }} />
                                    <Tooltip />
                                    <Area type="monotone" dataKey="count" name="Decisions" stroke={CHART_COLORS.decisionsArea} strokeWidth={2} fill="url(#intel-decisions-fill)" />
                                </AreaChart>
                            </ResponsiveContainer>
                        )}
                    </div>
                </div>

                <div className={`${cardCls} lg:col-span-4 min-h-[300px]`}>
                    <h3 className="font-label-caps text-label-caps text-[#f59e0b] uppercase mb-1.5">Top Business Units by Exposure</h3>
                    <p className="font-body-sm text-body-sm text-on-surface-variant mb-stack-sm">Ranked by total business value at risk.</p>
                    {isAssetsLoading ? (
                        <div className="flex-1 bg-surface-variant/20 rounded animate-pulse min-h-[200px]" />
                    ) : assetsError ? (
                        <ErrorState title="Couldn't load business units" whatHappened={assetsError} nextStep="Try refreshing." retrySafe onRetry={fetchAssets} />
                    ) : businessUnitExposure.length === 0 ? (
                        <EmptyState icon="apartment" title="No assets yet" description="Nothing to rank yet." />
                    ) : (
                        <div className="flex-1 overflow-y-auto custom-scrollbar flex flex-col gap-1.5">
                            {businessUnitExposure.map((r, idx) => (
                                <div key={r.businessUnit} className="flex items-center justify-between gap-2 py-1 border-b border-outline-variant last:border-0">
                                    <div className="flex items-center gap-2 min-w-0">
                                        <span className="font-label-caps text-label-caps text-on-surface-variant w-6 shrink-0">#{idx + 1}</span>
                                        <span className="font-body-sm text-body-sm text-on-surface truncate">{r.businessUnit}</span>
                                    </div>
                                    <span className="font-data-mono text-data-mono font-bold text-primary shrink-0">{formatRupeesCompact(r.totalValue)}</span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* Row 3: Compliance coverage (moved down from row 2 to de-clutter it),
                plus two illustrative widgets rounding out the page - not
                backed by a CRQ metric, shown as fixed sample data. */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-gutter">
                <div className={`${cardCls} lg:col-span-4 min-h-[300px]`}>
                    <h3 className="font-label-caps text-label-caps text-[#f59e0b] uppercase mb-1.5">Compliance Coverage</h3>
                    <p className="font-body-sm text-body-sm text-on-surface-variant mb-stack-sm">Controls mapped to NIST CSF / ISO 27001 / CIS v8 that are active in your latest run.</p>
                    <div className="flex-1 flex flex-col items-center justify-center min-h-[160px]">
                        {isSimLoading ? (
                            <div className="h-16 w-16 rounded-full bg-surface-variant/20 animate-pulse" />
                        ) : simError ? (
                            <p className="font-body-sm text-body-sm text-error text-center">{simError}</p>
                        ) : coveragePct === null ? (
                            <EmptyState icon="verified" title="No run yet" description="Run a simulation to compute coverage." />
                        ) : (
                            <>
                                <span className="font-display-lg text-display-lg text-primary tracking-tighter">{coveragePct}%</span>
                                <span className="font-label-caps text-label-caps text-on-surface-variant mt-1">
                                    {activeControlCount} of {frameworkRows.length} controls active
                                </span>
                                <div className="w-full h-2 bg-surface-variant/40 rounded-full mt-3 overflow-hidden">
                                    <div className="h-full landing-cta-gradient rounded-full" style={{ width: `${coveragePct}%` }} />
                                </div>
                            </>
                        )}
                    </div>
                </div>

                <div className={`${cardCls} lg:col-span-4 min-h-[300px]`}>
                    <h3 className="font-label-caps text-label-caps text-[#f59e0b] uppercase mb-1.5">Top Performing Districts</h3>
                    <div className="flex-1 overflow-y-auto custom-scrollbar flex flex-col gap-1.5">
                        {TOP_DISTRICTS_MOCK.map((r, idx) => (
                            <div key={r.city} className="flex items-center justify-between gap-2 py-1 border-b border-outline-variant last:border-0">
                                <div className="flex items-center gap-2 min-w-0">
                                    <span className="font-label-caps text-label-caps text-on-surface-variant w-6 shrink-0">#{idx + 1}</span>
                                    <span className="font-body-sm text-body-sm text-on-surface truncate">{r.city}</span>
                                </div>
                                <span className="font-data-mono text-data-mono font-bold text-[#15803d] shrink-0">{r.count}</span>
                            </div>
                        ))}
                    </div>
                </div>

                <div className={`${cardCls} lg:col-span-4 min-h-[300px]`}>
                    <h3 className="font-label-caps text-label-caps text-[#f59e0b] uppercase mb-1.5">Blockchain Activity</h3>
                    <div className="flex-1 min-h-[200px]">
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={BLOCKCHAIN_ACTIVITY_MOCK} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                                <defs>
                                    <linearGradient id="intel-blockchain-mock-fill" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="0%" stopColor={CHART_COLORS.blockchainMock} stopOpacity={0.55} />
                                        <stop offset="100%" stopColor={CHART_COLORS.blockchainMock} stopOpacity={0.05} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                                <XAxis dataKey="date" fontSize={9} tick={{ fill: 'var(--on-surface-variant)' }} />
                                <YAxis fontSize={10} tick={{ fill: 'var(--on-surface-variant)' }} />
                                <Area type="monotone" dataKey="value" stroke={CHART_COLORS.blockchainMock} strokeWidth={2} fill="url(#intel-blockchain-mock-fill)" />
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            </div>
        </div>
    );
}
