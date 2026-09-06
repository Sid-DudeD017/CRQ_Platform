"use client";
import React, { useEffect, useRef, useState } from 'react';

/**
 * Animates a numeric value from its previously-rendered value up (or
 * down) to a new target whenever `value` changes, instead of the figure
 * just snapping in place. Purely cosmetic - the real data in `value` is
 * already there the instant this renders, this only smooths how it's
 * displayed.
 */
export default function CountUp({
    value,
    duration = 700,
    formatter,
    className,
}: {
    value: number;
    duration?: number;
    formatter?: (v: number) => string;
    className?: string;
}) {
    const [display, setDisplay] = useState(value);
    const fromRef = useRef(value);
    const rafRef = useRef<number | null>(null);

    useEffect(() => {
        const from = fromRef.current;
        const to = value;
        if (from === to) return;
        const start = performance.now();
        if (rafRef.current) cancelAnimationFrame(rafRef.current);

        const tick = (now: number) => {
            const t = Math.min(1, (now - start) / duration);
            const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic
            const current = from + (to - from) * eased;
            setDisplay(current);
            if (t < 1) {
                rafRef.current = requestAnimationFrame(tick);
            } else {
                fromRef.current = to;
            }
        };
        rafRef.current = requestAnimationFrame(tick);
        return () => {
            if (rafRef.current) cancelAnimationFrame(rafRef.current);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [value]);

    const shown = formatter ? formatter(display) : display.toFixed(2);
    return <span className={className}>{shown}</span>;
}
