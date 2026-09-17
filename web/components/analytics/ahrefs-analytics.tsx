/**
 * Ahrefs Web Analytics — emit the exact vendor snippet.
 * React SSR turns `async` into `async=""`, which Ahrefs' HTML verifier often misses.
 */
export function AhrefsAnalytics() {
  return (
    <script
      dangerouslySetInnerHTML={{
        __html: `</script><script src="https://analytics.ahrefs.com/analytics.js" data-key="5ar5K5mpXwwkcFGOTKH51Q" async></script><script>`,
      }}
    />
  )
}
