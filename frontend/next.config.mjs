/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // The client-side Router Cache was serving a stale Ledger page after
    // Accept Risk on Overview: navigating to /ledger within the cache
    // window reused the previously-rendered page (and never re-ran its
    // fetch-on-mount effect), so newly logged decisions didn't show up
    // until an explicit "Refresh" click. Setting dynamic staleTime to 0
    // makes every client navigation to a dynamic route re-fetch instead of
    // reusing the cached snapshot.
    staleTimes: {
      dynamic: 0,
    },
  },
};
export default nextConfig;
