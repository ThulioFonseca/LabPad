/* =============================================================================
 * icons.js  —  icones SVG inline (constantes) usados pelos widgets.
 *
 * Carregado antes de widgets.js. JavaScript ES5 puro (Safari 9 / iPad 2).
 * ===========================================================================*/

/* Icones dos cards — currentColor herda a cor do elemento pai. */
var ICONS = {
  cpu: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="8" height="8" rx="1"/><line x1="6" y1="1" x2="6" y2="4"/><line x1="10" y1="1" x2="10" y2="4"/><line x1="6" y1="12" x2="6" y2="15"/><line x1="10" y1="12" x2="10" y2="15"/><line x1="1" y1="6" x2="4" y2="6"/><line x1="1" y1="10" x2="4" y2="10"/><line x1="12" y1="6" x2="15" y2="6"/><line x1="12" y1="10" x2="15" y2="10"/></svg>',
  mem: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><rect x="1" y="5" width="14" height="7" rx="1"/><line x1="4" y1="5" x2="4" y2="12"/><line x1="8" y1="5" x2="8" y2="12"/><line x1="12" y1="5" x2="12" y2="12"/><line x1="4" y1="3" x2="4" y2="5"/><line x1="8" y1="3" x2="8" y2="5"/><line x1="12" y1="3" x2="12" y2="5"/></svg>',
  temp: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><line x1="8" y1="1" x2="8" y2="8"/><path d="M5.5 8.5A2.5 2.5 0 1 0 10.5 8.5"/><circle cx="8" cy="11" r="2" fill="currentColor" stroke="none"/></svg>',
  net: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="4,5 8,1 12,5"/><line x1="8" y1="1" x2="8" y2="10"/><polyline points="4,11 8,15 12,11"/></svg>',
  disk: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><ellipse cx="8" cy="4.5" rx="6" ry="2.5"/><path d="M2 4.5v7c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5v-7"/></svg>',
  docker: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="6" width="3" height="3" rx="0.5"/><rect x="5" y="6" width="3" height="3" rx="0.5"/><rect x="9" y="6" width="3" height="3" rx="0.5"/><rect x="5" y="2" width="3" height="3" rx="0.5"/><path d="M14.5 7.5c-0.5-1.5-2-1.5-2-1.5H2c0 4 3 5 6 5s5-1 6.5-3.5z"/></svg>',
  info: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="6.5"/><line x1="8" y1="7" x2="8" y2="11.5"/><circle cx="8" cy="4.7" r="0.5" fill="currentColor" stroke="none"/></svg>',
  refresh: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3v4h-4"/><path d="M2 13v-4h4"/><path d="M3.5 7a5 5 0 0 1 8.5-2L14 7"/><path d="M12.5 9a5 5 0 0 1-8.5 2L2 9"/></svg>',
  external: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10 2h4v4"/><path d="M14 2L7 9"/><path d="M12 9v4a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h4"/></svg>',
  bell: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>',
  trash: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>'
};

/* Weather icons by WMO group — fixed colours, independent of theme. */
var WEATHER_ICONS = {
  clear:   '<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="5" fill="#f5c542"/><line x1="12" y1="2" x2="12" y2="5" stroke="#f5c542" stroke-width="2" stroke-linecap="round"/><line x1="12" y1="19" x2="12" y2="22" stroke="#f5c542" stroke-width="2" stroke-linecap="round"/><line x1="2" y1="12" x2="5" y2="12" stroke="#f5c542" stroke-width="2" stroke-linecap="round"/><line x1="19" y1="12" x2="22" y2="12" stroke="#f5c542" stroke-width="2" stroke-linecap="round"/><line x1="4.22" y1="4.22" x2="6.34" y2="6.34" stroke="#f5c542" stroke-width="2" stroke-linecap="round"/><line x1="17.66" y1="17.66" x2="19.78" y2="19.78" stroke="#f5c542" stroke-width="2" stroke-linecap="round"/><line x1="19.78" y1="4.22" x2="17.66" y2="6.34" stroke="#f5c542" stroke-width="2" stroke-linecap="round"/><line x1="6.34" y1="17.66" x2="4.22" y2="19.78" stroke="#f5c542" stroke-width="2" stroke-linecap="round"/></svg>',
  partly:  '<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><circle cx="10" cy="10" r="4" fill="#f5c542"/><rect x="6" y="13" width="13" height="7" rx="3.5" fill="#b0bec5"/><rect x="4" y="15" width="10" height="5" rx="2.5" fill="#cfd8dc"/></svg>',
  cloudy:  '<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><rect x="3" y="10" width="18" height="9" rx="4.5" fill="#90a4ae"/><rect x="6" y="7" width="11" height="7" rx="3.5" fill="#b0bec5"/></svg>',
  fog:     '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#90a4ae" stroke-width="2" stroke-linecap="round"><line x1="3" y1="8" x2="21" y2="8"/><line x1="5" y1="12" x2="19" y2="12"/><line x1="3" y1="16" x2="21" y2="16"/></svg>',
  drizzle: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><rect x="3" y="5" width="18" height="9" rx="4.5" fill="#90a4ae"/><line x1="8" y1="17" x2="7" y2="21" stroke="#64b5f6" stroke-width="2" stroke-linecap="round"/><line x1="13" y1="17" x2="12" y2="21" stroke="#64b5f6" stroke-width="2" stroke-linecap="round"/><line x1="18" y1="17" x2="17" y2="21" stroke="#64b5f6" stroke-width="2" stroke-linecap="round"/></svg>',
  rain:    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><rect x="3" y="4" width="18" height="9" rx="4.5" fill="#78909c"/><line x1="7" y1="16" x2="5" y2="22" stroke="#42a5f5" stroke-width="2" stroke-linecap="round"/><line x1="12" y1="16" x2="10" y2="22" stroke="#42a5f5" stroke-width="2" stroke-linecap="round"/><line x1="17" y1="16" x2="15" y2="22" stroke="#42a5f5" stroke-width="2" stroke-linecap="round"/></svg>',
  snow:    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><rect x="3" y="4" width="18" height="9" rx="4.5" fill="#90a4ae"/><text x="5" y="23" font-size="11" fill="#b3e5fc">* * *</text></svg>',
  shower:  '<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><circle cx="8" cy="6" r="3" fill="#f5c542"/><rect x="5" y="8" width="14" height="7" rx="3.5" fill="#78909c"/><line x1="9" y1="18" x2="8" y2="22" stroke="#42a5f5" stroke-width="2" stroke-linecap="round"/><line x1="14" y1="18" x2="13" y2="22" stroke="#42a5f5" stroke-width="2" stroke-linecap="round"/></svg>',
  storm:   '<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><rect x="2" y="3" width="20" height="10" rx="5" fill="#546e7a"/><polyline points="13,13 10,19 14,19 11,24" stroke="#fdd835" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>'
};

/* Moon icons by phase (0=new moon .. 7=waning crescent). */
var MOON_ICONS = [
  '<svg width="20" height="20" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="#37474f" stroke="#546e7a" stroke-width="1.5"/></svg>',
  '<svg width="20" height="20" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="#37474f" stroke="#546e7a" stroke-width="1.5"/><path d="M12 3 A9 9 0 0 1 12 21 A5 9 0 0 0 12 3Z" fill="#f5c542"/></svg>',
  '<svg width="20" height="20" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="#37474f" stroke="#546e7a" stroke-width="1.5"/><path d="M12 3 A9 9 0 0 1 12 21 L12 3Z" fill="#f5c542"/></svg>',
  '<svg width="20" height="20" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="#f5c542" stroke="#e5b100" stroke-width="1.5"/><path d="M12 3 A9 9 0 0 0 12 21 A3 9 0 0 1 12 3Z" fill="#37474f"/></svg>',
  '<svg width="20" height="20" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="#f5c542" stroke="#e5b100" stroke-width="1.5"/></svg>',
  '<svg width="20" height="20" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="#f5c542" stroke="#e5b100" stroke-width="1.5"/><path d="M12 3 A9 9 0 0 1 12 21 A3 9 0 0 0 12 3Z" fill="#37474f"/></svg>',
  '<svg width="20" height="20" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="#37474f" stroke="#546e7a" stroke-width="1.5"/><path d="M12 3 A9 9 0 0 0 12 21 L12 3Z" fill="#f5c542"/></svg>',
  '<svg width="20" height="20" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="#37474f" stroke="#546e7a" stroke-width="1.5"/><path d="M12 3 A9 9 0 0 0 12 21 A5 9 0 0 1 12 3Z" fill="#f5c542"/></svg>'
];

/* Maps a WMO code (Open-Meteo) to the corresponding weather icon. */
/* Maps WMO code -> short human-readable label. */
var WMO_LABEL = {
  0: 'Clear', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast',
  45: 'Fog', 48: 'Icy fog',
  51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle',
  56: 'Freezing drizzle', 57: 'Heavy freezing drizzle',
  61: 'Light rain', 63: 'Rain', 65: 'Heavy rain',
  66: 'Freezing rain', 67: 'Heavy freezing rain',
  71: 'Light snow', 73: 'Snow', 75: 'Heavy snow', 77: 'Sleet',
  80: 'Light showers', 81: 'Showers', 82: 'Heavy showers',
  85: 'Snow showers', 86: 'Heavy snow showers',
  95: 'Thunderstorm', 96: 'Thunderstorm with hail', 99: 'Severe thunderstorm'
};
function _wmoLabel(code) { return WMO_LABEL[code] || '—'; }

function _wmoIcon(code) {
  if (code === 0)  { return WEATHER_ICONS.clear; }
  if (code <= 2)   { return WEATHER_ICONS.partly; }
  if (code === 3)  { return WEATHER_ICONS.cloudy; }
  if (code <= 48)  { return WEATHER_ICONS.fog; }
  if (code <= 57)  { return WEATHER_ICONS.drizzle; }
  if (code <= 65)  { return WEATHER_ICONS.rain; }
  if (code <= 77)  { return WEATHER_ICONS.snow; }
  if (code <= 82)  { return WEATHER_ICONS.shower; }
  if (code <= 86)  { return WEATHER_ICONS.snow; }
  return WEATHER_ICONS.storm;
}
