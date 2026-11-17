import Script from "next/script";

/**
 * Ahrefs Web Analytics via next/script (afterInteractive).
 * Avoids the old </script> breakout snippet that caused React hydration mismatches.
 */
export function AhrefsAnalytics() {
  return (
    <Script
      src="https://analytics.ahrefs.com/analytics.js"
      data-key="5ar5K5mpXwwkcFGOTKH51Q"
      strategy="afterInteractive"
    />
  );
}
