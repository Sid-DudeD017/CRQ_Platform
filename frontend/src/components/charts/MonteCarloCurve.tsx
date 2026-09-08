"use client";
import React from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { formatRupeesCr } from '@/lib/format';

interface MonteCarloCurveProps {
    distributionCurve: Array<{ loss: number; probability: number }>;
    meanLoss?: number;
    var95?: number;
    var99?: number;
    height?: number;
}

export default function MonteCarloCurve({
    distributionCurve,
    meanLoss,
    var95,
    var99,
    height = 220,
}: MonteCarloCurveProps) {
    if (!distributionCurve || distributionCurve.length === 0) {
        return (
            <div className="w-full flex flex-col items-center justify-center p-6 bg-surface-container-low rounded-xl border border-outline-variant border-dashed text-on-surface-variant text-body-sm" style={{ height }}>
                <span aria-hidden="true" className="material-symbols-outlined text-[32px] text-outline mb-2">query_stats</span>
                <span>Run simulation to generate Monte Carlo loss distribution curve</span>
            </div>
        );
    }

    const formatCr = formatRupeesCr;

    return (
        <div className="w-full flex flex-col gap-2">
            <div style={{ height }} className="w-full">
                <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={distributionCurve} margin={{ top: 15, right: 15, left: 10, bottom: 5 }}>
                        <defs>
                            <linearGradient id="mcGradient" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.45} />
                                <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.0} />
                            </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                        <XAxis
                            dataKey="loss"
                            tickFormatter={(val) => formatRupeesCr(val)}
                            fontSize={11}
                            stroke="#8d8f96"
                        />
                        <YAxis hide={true} />
                        <Tooltip
                            formatter={(value: any, name: any, props: any) => [
                                formatCr(props.payload.loss),
                                'Loss Magnitude'
                            ]}
                            labelFormatter={() => `Loss Probability Point`}
                            contentStyle={{
                                backgroundColor: 'var(--surface-container-lowest)',
                                borderColor: 'var(--outline-variant)',
                                borderRadius: '8px',
                                fontSize: '12px'
                            }}
                        />
                        {meanLoss && (
                            <ReferenceLine
                                x={meanLoss}
                                stroke="#10b981"
                                strokeDasharray="3 3"
                                label={{ value: 'Mean Loss', position: 'top', fill: '#10b981', fontSize: 10 }}
                            />
                        )}
                        {var95 && (
                            <ReferenceLine
                                x={var95}
                                stroke="#f59e0b"
                                strokeDasharray="4 4"
                                label={{ value: '95% VaR', position: 'top', fill: '#f59e0b', fontSize: 10 }}
                            />
                        )}
                        {var99 && (
                            <ReferenceLine
                                x={var99}
                                stroke="#ef4444"
                                strokeDasharray="2 2"
                                label={{ value: '99% VaR', position: 'top', fill: '#ef4444', fontSize: 10 }}
                            />
                        )}
                        <Area
                            type="monotone"
                            dataKey="probability"
                            stroke="#3b82f6"
                            strokeWidth={2.5}
                            fillOpacity={1}
                            fill="url(#mcGradient)"
                        />
                    </AreaChart>
                </ResponsiveContainer>
            </div>

            {/* Percentile Summary Legend */}
            <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-outline-variant text-xs text-on-surface-variant font-data-mono">
                {meanLoss && (
                    <div className="flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full bg-[#10b981]"></span>
                        <span>Mean Expected Loss: <strong>{formatCr(meanLoss)}</strong></span>
                    </div>
                )}
                {var95 && (
                    <div className="flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full bg-[#f59e0b]"></span>
                        <span>95% VaR (Tail Risk): <strong>{formatCr(var95)}</strong></span>
                    </div>
                )}
                {var99 && (
                    <div className="flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full bg-[#ef4444]"></span>
                        <span>99% Extreme VaR: <strong>{formatCr(var99)}</strong></span>
                    </div>
                )}
            </div>
        </div>
    );
}
