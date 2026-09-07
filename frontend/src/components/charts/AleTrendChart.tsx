"use client";
import React from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

/*
  [Product improvement #9 - performance]
  Split out of reports/page.tsx so recharts (a genuinely large dependency)
  can be next/dynamic-imported with ssr:false from that page instead of
  being pulled into every visit to Reports up front, including the very
  common case (no simulations yet) where no chart renders at all.
*/

export interface AleTrendPoint {
    name: string;
    ale: number;
}

export default function AleTrendChart({ data }: { data: AleTrendPoint[] }) {
    return (
        <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 16, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--outline-variant)" />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: 'var(--on-surface-variant)' }} />
                <YAxis tick={{ fontSize: 11, fill: 'var(--on-surface-variant)' }} tickFormatter={(v) => `₹${v.toFixed(1)}Cr`} width={64} />
                <Tooltip formatter={(value: any) => [`₹${Number(value).toFixed(2)} Cr`, 'Expected Annual Loss']} />
                <Line type="monotone" dataKey="ale" stroke="var(--primary)" strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
        </ResponsiveContainer>
    );
}
