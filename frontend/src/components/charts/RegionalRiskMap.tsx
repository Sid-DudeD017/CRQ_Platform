"use client";

import React from 'react';
import { MapContainer, TileLayer, CircleMarker, Tooltip as LeafletTooltip } from 'react-leaflet';

export interface RegionPoint {
    city: string;
    lat: number;
    lng: number;
    totalValue: number;
    businessUnits: string[];
}

// Small standalone formatter (not the shared lib/format.ts helper) so this
// leaflet-only chunk doesn't need to pull anything else in - it's ssr:false
// dynamic-imported specifically to keep leaflet's window/document access
// out of the server render.
function formatCompact(amount: number): string {
    if (!Number.isFinite(amount)) return '₹0';
    if (amount >= 10000000) return `₹${(amount / 10000000).toFixed(2)} Cr`;
    if (amount >= 100000) return `₹${(amount / 100000).toFixed(1)}L`;
    return `₹${Math.round(amount).toLocaleString('en-IN')}`;
}

// Free OpenStreetMap raster tiles - no API key, no account, no credit card.
// A CSS filter (see .regional-map-dark in globals.css) inverts + hue-
// rotates the tile pane to approximate a dark basemap without needing a
// paid dark-tile provider.
export default function RegionalRiskMap({ regions, maxValue }: { regions: RegionPoint[]; maxValue: number }) {
    return (
        <div className="regional-map-dark h-full w-full">
            <MapContainer
                center={[22.6, 80]}
                zoom={4.4}
                scrollWheelZoom={false}
                style={{ height: '100%', width: '100%', background: '#0a0a0a' }}
            >
                <TileLayer
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                    maxZoom={12}
                />
                {regions.map((r) => {
                    const share = maxValue > 0 ? r.totalValue / maxValue : 0;
                    const radius = 8 + Math.round(share * 16);
                    return (
                        <CircleMarker
                            key={r.city}
                            center={[r.lat, r.lng]}
                            radius={radius}
                            pathOptions={{ color: '#f59e0b', weight: 2, fillColor: '#f59e0b', fillOpacity: 0.55 }}
                        >
                            <LeafletTooltip direction="top" offset={[0, -radius]} opacity={1}>
                                <div className="font-semibold text-[12px]">{r.city}</div>
                                <div className="text-[11px]">{formatCompact(r.totalValue)} · {r.businessUnits.join(', ')}</div>
                            </LeafletTooltip>
                        </CircleMarker>
                    );
                })}
            </MapContainer>
        </div>
    );
}
