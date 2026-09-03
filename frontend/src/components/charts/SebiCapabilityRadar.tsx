"use client";
import React from 'react';
import { Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer, Tooltip } from 'recharts';

interface SebiCapabilityRadarProps {
    resilience?: {
        cci_score?: number;
        anticipate?: number;
        withstand?: number;
        contain?: number;
        recover?: number;
        evolve?: number;
    };
    height?: number;
}

export default function SebiCapabilityRadar({ resilience, height = 210 }: SebiCapabilityRadarProps) {
    const data = [
        { pillar: 'Anticipate', score: resilience?.anticipate ?? 3.4, max: 5 },
        { pillar: 'Withstand', score: resilience?.withstand ?? 3.8, max: 5 },
        { pillar: 'Contain', score: resilience?.contain ?? 3.1, max: 5 },
        { pillar: 'Recover', score: resilience?.recover ?? 3.9, max: 5 },
        { pillar: 'Evolve', score: resilience?.evolve ?? 3.5, max: 5 },
    ];

    const overallScore = (resilience?.cci_score ?? 3.54).toFixed(2);

    return (
        <div className="w-full flex flex-col items-center">
            <div style={{ height }} className="w-full">
                <ResponsiveContainer width="100%" height="100%">
                    <RadarChart cx="50%" cy="50%" outerRadius="70%" data={data}>
                        <PolarGrid stroke="var(--outline-variant)" opacity={0.3} />
                        <PolarAngleAxis
                            dataKey="pillar"
                            tick={{ fill: 'var(--on-surface)', fontSize: 11, fontWeight: 600 }}
                        />
                        <PolarRadiusAxis
                            angle={30}
                            domain={[0, 5]}
                            tick={{ fill: 'var(--on-surface-variant)', fontSize: 9 }}
                        />
                        <Tooltip
                            formatter={(value: any) => [`${Number(value).toFixed(2)} / 5.0`, 'Capability Index']}
                            contentStyle={{
                                backgroundColor: 'var(--surface-container-lowest)',
                                borderColor: 'var(--outline-variant)',
                                borderRadius: '8px',
                                fontSize: '12px'
                            }}
                        />
                        <Radar
                            name="SEBI CSCRF Capability"
                            dataKey="score"
                            stroke="#8b5cf6"
                            fill="#8b5cf6"
                            fillOpacity={0.4}
                        />
                    </RadarChart>
                </ResponsiveContainer>
            </div>
            <div className="flex items-center gap-2 mt-1 text-xs">
                <span className="font-label-caps text-on-surface-variant">SEBI Cyber Capability Index (CCI):</span>
                <span className="font-data-mono font-bold text-[#8b5cf6] text-sm">{overallScore} / 5.00</span>
            </div>
        </div>
    );
}
