import { NextRequest, NextResponse } from 'next/server';

/*
  [Server-side route protection]
  Previously the ONLY thing standing between an unauthenticated visitor and
  every dashboard route was the client-side `if (!token) return <LandingPage
  .../>` check in SharedLayout.tsx - which only runs after the page's JS has
  downloaded, parsed, and hydrated in the browser. A direct hit or hard
  refresh on a deep link like /optimize briefly (or, on a slow connection,
  quite visibly) sent real app HTML down the wire before that client-side
  check could react, and any crawler/curl/proxy request got a 200 either
  way - there was no enforcement point that ran before the protected page's
  code executed at all.

  Next.js Middleware runs at the edge, before any route in `matcher` below
  renders, so an unauthenticated request is redirected before the protected
  page is ever reached - this is genuine server-side (edge-side) enforcement,
  not just an additional client-side conditional.

  What this does NOT do: this is not a full HttpOnly-cookie session system.
  `crq_session` is a lightweight, non-sensitive cookie ('1' or absent) that
  AuthContext.tsx sets/clears from client JS in lockstep with the real
  bearer token (kept in localStorage, per fetchWithRetry's
  `Authorization: Bearer` usage everywhere) - it carries no auth power of
  its own and the backend never reads it. Middleware can't see localStorage
  (it runs at the edge, not in the browser), so this cookie is the only
  signal available to it. The actual authorization boundary stays where it
  already was: every API call is still checked server-side by
  backend/security.py's get_current_user, and an expired/invalid JWT still
  gets a real 401 there regardless of what this cookie says. A true
  server-issued HttpOnly session cookie would need the FastAPI backend
  itself to set it, which - since the deployed frontend (Vercel) and
  backend (Render) are on different origins - means first solving
  cross-origin cookie auth (SameSite=None; Secure, credentials: 'include'
  on every fetch, CORS allow_credentials=True with an explicit origin,
  which backend/main.py currently sets to False). That's a real follow-up,
  not something to fake here.
*/

// Kept in sync by hand with SharedLayout.tsx's top-level `if (!token)`
// gate, which is the client-side source of truth for "this route requires
// a session" - there's no shared route-group/config to derive this list
// from automatically.
const PROTECTED_PATHS = [
    '/overview',
    '/ingestion',
    '/optimize',
    '/ledger',
    '/calibration',
    '/reports',
    '/training',
    '/docs',
    '/support',
];

export function middleware(request: NextRequest) {
    const { pathname } = request.nextUrl;
    const isProtected = PROTECTED_PATHS.some(
        (p) => pathname === p || pathname.startsWith(`${p}/`)
    );
    if (!isProtected) {
        return NextResponse.next();
    }

    const hasSession = request.cookies.get('crq_session')?.value === '1';
    if (hasSession) {
        return NextResponse.next();
    }

    // Bounce to the start screen, remembering exactly where the visitor
    // was trying to go (path + query string) so SharedLayout's post-login
    // redirect effect can send them straight back once they've
    // authenticated - see the `next` handling there.
    const url = request.nextUrl.clone();
    const intendedPath = pathname + request.nextUrl.search;
    url.pathname = '/';
    url.search = '';
    url.searchParams.set('next', intendedPath);
    return NextResponse.redirect(url);
}

export const config = {
    matcher: [
        '/overview/:path*',
        '/ingestion/:path*',
        '/optimize/:path*',
        '/ledger/:path*',
        '/calibration/:path*',
        '/reports/:path*',
        '/training/:path*',
        '/docs/:path*',
        '/support/:path*',
    ],
};
