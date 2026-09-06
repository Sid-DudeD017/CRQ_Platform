"use client";

// This route (the app's actual "/") is intentionally empty. SharedLayout
// (src/components/SharedLayout.tsx) treats pathname === '/' as the Home
// screen unconditionally and returns its own JSX before this component's
// output is ever used - that's what makes '/' a stable, dedicated "Home"
// URL that the CRQ Platform logo can always link to.
//
// The demo dashboard that used to live at '/' (Portfolio Risk Overview,
// ALE/VaR cards, Loss Distribution, etc.) now has its own URL: /overview
// (src/app/overview/page.tsx) - see chooseDemoData() and the "Overview"
// nav item in SharedLayout.tsx.
export default function HomePage() {
    return null;
}
