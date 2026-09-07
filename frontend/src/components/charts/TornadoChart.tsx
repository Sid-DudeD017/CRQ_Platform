"use client";
import React from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';

export interface TornadoItem {
    parameter: string;
    lowImpact: number;  // Impact on ALE when param is at low bound (in Crores)
    highImpact: number; // Impact on ALE when param is at high bound (in Crores)
    swing: number;      // Total variance swing
}

interface TornadoChartProps {
    data?: TornadoItem[];
    height?: number;
}

const DEFAULT_TORNADO: TornadoItem[] = [
    { parameter: "Threat Event Frequency (TEF)", lowImpact: -1.8, highImpact: 3.4, swing: 5.2 },
    { parameter: "Control Strength (CS)", lowImpact: -2.1, highImpact: 1.9, swing: 4.0 },
    { parameter: "DPDP Statutory Penalties", lowImpact: -0.8, highImpact: 2.8, swing: 3.6 },
    { parameter: "Threat Capability (TC)", lowImpact: -1.2, highImpact: 1.6, swing: 2.8 },
    { parameter: "Primary Loss Magnitude", lowImpact: -0.6, highImpact: 1.1, swing: 1.7 },
];

export default function TornadoChart({ data = DEFAULT_TORNADO, height = 220 }: TornadoChartProps) {
    const chartData = data.map((item) => ({
        parameter: item.parameter,
        low: item.lowImpact,
        high: item.highImpact,
        swing: item.swing,
    }));

    return (
        <div className="w-full flex flex-col gap-2">
            <div className="flex justify-between items-center text-[10px] text-on-surface-variant font-label-caps">
                <span className="flex items-center gap-1 text-[#10b981]">
                    <span aria-hidden="true" className="material-symbols-outlined text-[12px]">arrow_downward</span> Downside Reduction
                </span>
                <span className="flex items-center gap-1 text-[#ef4444]">
                    Upside Exposure Increase <span aria-hidden="true" className="material-symbols-outlined text-[12px]">arrow_upward</span>
                </span>
            </div>

            <div style={{ height }} className="w-full">
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                        layout="vertical"
                        data={chartData}
                        margin={{ top: 5, right: 25, left: 60, bottom: 5 }}
                        stackOffset="sign"
                    >
                        <CartesianGrid strokeDasharray="3 3" opacity={0.15} horizontal={false} />
                        <XAxis
                            type="number"
                            tickFormatter={(val) => `${val > 0 ? '+' : ''}${val} Cr`}
                            fontSize={10}
                            stroke="#8d8f96"
                        />
                        <YAxis
                            type="category"
                            dataKey="parameter"
                            width={130}
                            fontSize={10}
                            stroke="#8d8f96"
                            tick={{ fill: 'var(--on-surface)' }}
                        />
                        <Tooltip
                            formatter={(value: any, name: any) => [
                                `₹${Math.abs(Number(value)).toFixed(2)} Cr`,
                                name === 'low' ? 'Favorable Impact' : 'Unfavorable Exposure'
                            ]}
                            contentStyle={{
                                backgroundColor: 'var(--surface-container-lowest)',
                                borderColor: 'var(--outline-variant)',
                                borderRadius: '8px',
                                fontSize: '11px'
                            }}
                        />
                        <ReferenceLine x={0} stroke="var(--outline)" strokeWidth={1.5} />
                        <Bar dataKey="low" fill="#10b981" radius={[3, 0, 0, 3]} />
                        <Bar dataKey="high" fill="#ef4444" radius={[0, 3, 3, 0]} />
                    </BarChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
}
