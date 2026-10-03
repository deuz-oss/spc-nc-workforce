import React from 'react';
import { ActivityIndicator, Platform, StyleSheet, Text, View } from 'react-native';
import WebView from 'react-native-webview';
import { C, R, T } from '../theme';

export interface MapMarker {
  lat: number;
  lng: number;
  label?: string;
  color?: string;
}

/**
 * Leaflet is loaded from unpkg pinned to an exact version with Subresource
 * Integrity, so an altered CDN file is refused instead of run inside the app's
 * WebView. Changing the version means recomputing both hashes
 * (`openssl dgst -sha256 -binary leaflet.js | openssl base64 -A`).
 */
const LEAFLET_VERSION = '1.9.4';
const LEAFLET_CSS_SRI = 'sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=';
const LEAFLET_JS_SRI = 'sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=';

/**
 * Tile server. The default is OpenStreetMap's community server, whose usage
 * policy (operations.osmfoundation.org/policies/tiles) isn't meant for a
 * production app at fleet scale — set EXPO_PUBLIC_MAP_TILE_URL (and its
 * attribution) to a keyed provider before go-live. The attribution is required
 * by the map data licence and is always shown.
 */
const TILE_URL = process.env.EXPO_PUBLIC_MAP_TILE_URL || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_ATTRIBUTION = process.env.EXPO_PUBLIC_MAP_TILE_ATTRIBUTION || '&copy; OpenStreetMap contributors';

/**
 * Peta ringan berbasis Leaflet di dalam WebView. Berjalan di Android, iOS, dan
 * Web (butuh internet untuk memuat tile OSM) — ported from spc-field-force's
 * LeafletMap.tsx (Phase 4a, PRD §16), which was already domain-agnostic.
 */
export function LeafletMap({
  polyline,
  markers = [],
  height = 220,
  center,
  zoom = 14,
}: {
  polyline?: Array<{ lat: number; lng: number }>;
  markers?: MapMarker[];
  height?: number;
  center?: { lat: number; lng: number };
  zoom?: number;
}) {
  const data = {
    polyline: polyline ?? [],
    markers,
    center: center ?? polyline?.[0] ?? markers[0] ?? { lat: -6.2, lng: 106.816666 },
    zoom,
    fit: (polyline?.length ?? 0) > 1 || markers.length > 1,
  };
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  const tiles = JSON.stringify({ url: TILE_URL, attribution: TILE_ATTRIBUTION }).replace(/</g, '\\u003c');

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<link rel="stylesheet" href="https://unpkg.com/leaflet@${LEAFLET_VERSION}/dist/leaflet.css" integrity="${LEAFLET_CSS_SRI}" crossorigin=""/>
<script src="https://unpkg.com/leaflet@${LEAFLET_VERSION}/dist/leaflet.js" integrity="${LEAFLET_JS_SRI}" crossorigin=""></script>
<style>html,body,#m{height:100%;margin:0;padding:0}
.off{display:flex;height:100%;align-items:center;justify-content:center;font:13px sans-serif;color:${C.muted};text-align:center;padding:0 16px}
.leaflet-control-attribution{font-size:9px}</style></head>
<body><div id="m"></div><script>
if(!window.L){document.body.innerHTML='<div class="off">Peta tidak dapat dimuat — butuh koneksi internet.</div>';}else{
var D=${json};
var T=${tiles};
var map=L.map('m',{zoomControl:false,attributionControl:true});
map.attributionControl.setPrefix(false);
L.tileLayer(T.url,{maxZoom:19,attribution:T.attribution}).addTo(map);
D.markers.forEach(function(mk){
  L.circleMarker([mk.lat,mk.lng],{radius:7,color:'${C.card}',weight:2,fillColor:mk.color||'${C.accent}',fillOpacity:1})
   .addTo(map).bindTooltip(mk.label||'',{permanent:false,direction:'top'});
});
if(D.polyline.length>1){
  L.polyline(D.polyline.map(function(p){return [p.lat,p.lng];}),{color:'${C.primaryDark}',weight:4,opacity:.9}).addTo(map);
}
if(D.fit){
  var b=[];D.markers.forEach(function(mk){b.push([mk.lat,mk.lng]);});
  D.polyline.forEach(function(p){b.push([p.lat,p.lng]);});
  map.fitBounds(b,{padding:[24,24]});
}else{
  map.setView([D.center.lat,D.center.lng],D.zoom);
}
}
</script></body></html>`;

  // react-native-webview tidak berjalan di Web; pakai <iframe> DOM asli di jalur web.
  if (Platform.OS === 'web') {
    return (
      <View style={{ height, borderRadius: R.card, overflow: 'hidden', backgroundColor: C.border }}>
        {React.createElement('iframe', {
          srcDoc: html,
          style: { border: 0, width: '100%', height: '100%' },
          sandbox: 'allow-scripts allow-same-origin',
          title: 'map',
        })}
      </View>
    );
  }

  return (
    <View style={{ height, borderRadius: R.card, overflow: 'hidden', backgroundColor: C.border }}>
      <WebView
        source={{ html }}
        style={StyleSheet.absoluteFill}
        originWhitelist={['*']}
        scrollEnabled={false}
        startInLoadingState
        renderLoading={() => (
          <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
            <ActivityIndicator color={C.primaryDark} aria-label="Memuat peta" />
          </View>
        )}
      />
    </View>
  );
}

/** Placeholder peta ketika koordinat belum tersedia */
export function MapPlaceholder({ height = 120, text }: { height?: number; text: string }) {
  return (
    <View
      style={{
        height,
        borderRadius: R.card,
        backgroundColor: C.divider,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text style={[T.body, { color: C.muted }]}>{text}</Text>
    </View>
  );
}
