/* =============================================================================
 * config.js  —  CONFIGURE YOUR DASHBOARD HERE.
 *
 * This is the only file you need to edit day-to-day. No build: just save and
 * reload the page on your iPad.
 * ===========================================================================*/

var CONFIG = {

  /* API origin. Empty = same server serving this page. */
  apiBase: '',

  /* Metrics update interval, in milliseconds. */
  refreshMs: 5000,

  /* Calendar and News interval. External feeds change infrequently: 10 minutes.
     (URLs are in the server's .env, not here.) */
  feedsRefreshMs: 600000,

  /* Samples saved per sparkline (mini-chart). 60 x 5s = ~5 minutes. */
  sparkSamples: 60,

  /* ---------------------------------------------------------------------------
   * WIDGETS — each item is a card. To ADD a new metric:
   *   1) ensure backend returns it in /api/metrics
   *   2) copy a line below and adjust the fields
   *
   * Fields:
   *   id       unique identifier
   *   title    display title
   *   kind     'gauge'  card with number + bar (0..max)
   *            'info'   single text line (no bar)
   *   section  'host' or 'system' (which panel it goes in)
   *   path     path to value in JSON  (e.g. 'host.cpu_percent')
   *   spark    true to draw the sparkline
   *
   * Specific to 'gauge':
   *   unit     number suffix  (e.g. '%', '°')
   *   max      full bar value (default 100)
   *   warn     from this value the card turns yellow
   *   crit     from this value the card turns red
   *   sub      {used:'...', total:'...'} extra line "used / total"
   *
   * Specific to 'info':
   *   fmt      'text' | 'duration' (seconds -> "6d 4h") | 'load' (array)
   * -------------------------------------------------------------------------*/
  widgets: [

    { id: 'cpu', title: 'CPU', kind: 'gauge', section: 'host',
      path: 'host.cpu_percent', unit: '%', warn: 75, crit: 90, spark: true },

    { id: 'mem', title: 'Memory', kind: 'gauge', section: 'host',
      path: 'host.mem_percent', unit: '%', warn: 80, crit: 92, spark: true,
      sub: { used: 'host.mem_used', total: 'host.mem_total' } },

    { id: 'disk', title: 'Disk', kind: 'gauge', section: 'host',
      path: 'host.disk_agg_percent', unit: '%', warn: 75, crit: 90, spark: false,
      sub: { used: 'host.disk_agg_used', total: 'host.disk_agg_total' } },

    { id: 'temp', title: 'CPU Temp', kind: 'gauge', section: 'host',
      path: 'sensors.cpu_temp', unit: '°', max: 90, warn: 70, crit: 85,
      spark: true }

  ]
};
