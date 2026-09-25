'use dom';
/**
 * Satellite map for outlining garden areas (an Expo DOM component: it runs as
 * a small web page inside the app, so it can use Leaflet).
 * Imagery: Esri World Imagery (free, no account; attribution shown on the map).
 * The map never sends the address anywhere — it only requests image tiles for
 * the part of the map on screen, like any map.
 */
import type { DOMProps } from 'expo/dom';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import React, { useEffect, useRef } from 'react';

type Pt = { lat: number; lon: number };

export interface MapOutline {
  id: string;
  name: string;
  points: Pt[];
}

const TILES = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const ATTRIBUTION = 'Imagery © Esri, Maxar, Earthstar Geographics, and the GIS User Community';

export default function GardenMap({
  centre,
  zoom,
  recentreKey,
  outlines,
  draft,
  drawing,
  onTap,
  onZoom,
}: {
  centre: Pt;
  zoom: number;
  /** Change this to move the map to `centre` (e.g. after an address search). */
  recentreKey: string;
  outlines: MapOutline[];
  draft: Pt[];
  drawing: boolean;
  onTap: (p: Pt) => Promise<void>;
  onZoom?: (zoom: number) => Promise<void>;
  dom?: DOMProps;
}) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const drawingRef = useRef(drawing);
  drawingRef.current = drawing;
  const tapRef = useRef(onTap);
  tapRef.current = onTap;
  const zoomRef = useRef(onZoom);
  zoomRef.current = onZoom;

  useEffect(() => {
    if (!el.current || map.current) return;
    const m = L.map(el.current, { zoomControl: true, attributionControl: true }).setView([centre.lat, centre.lon], zoom);
    L.tileLayer(TILES, { maxNativeZoom: 19, maxZoom: 21, attribution: ATTRIBUTION }).addTo(m);
    layer.current = L.layerGroup().addTo(m);
    m.on('click', (e: L.LeafletMouseEvent) => {
      if (drawingRef.current) void tapRef.current({ lat: e.latlng.lat, lon: e.latlng.lng });
    });
    m.on('zoomend', () => void zoomRef.current?.(m.getZoom()));
    map.current = m;
    return () => {
      m.remove();
      map.current = null;
    };
    // Created once; later centre changes go through recentreKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    map.current?.setView([centre.lat, centre.lon], zoom);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recentreKey]);

  useEffect(() => {
    const g = layer.current;
    if (!g) return;
    g.clearLayers();
    for (const o of outlines) {
      if (o.points.length < 3) continue;
      L.polygon(o.points.map((p) => [p.lat, p.lon] as [number, number]), { color: '#8fd19e', weight: 2, fillOpacity: 0.2 })
        .bindTooltip(o.name, { permanent: true, direction: 'center', className: 'sbs-label' })
        .addTo(g);
    }
    if (draft.length) {
      const ll = draft.map((p) => [p.lat, p.lon] as [number, number]);
      if (ll.length >= 3) L.polygon(ll, { color: '#ffd166', weight: 3, fillOpacity: 0.25, dashArray: '6 4' }).addTo(g);
      else if (ll.length === 2) L.polyline(ll, { color: '#ffd166', weight: 3 }).addTo(g);
      for (const p of ll) L.circleMarker(p, { radius: 6, color: '#1b1b1b', weight: 2, fillColor: '#ffd166', fillOpacity: 1 }).addTo(g);
    }
  }, [outlines, draft]);

  useEffect(() => {
    if (el.current) el.current.style.cursor = drawing ? 'crosshair' : '';
  }, [drawing]);

  return (
    <div style={{ width: '100%', height: '100%', minHeight: 200 }}>
      <style>{'.sbs-label{background:rgba(0,0,0,.55);color:#fff;border:0;box-shadow:none;font:600 12px system-ui,sans-serif}.sbs-label:before{display:none}html,body,#root{margin:0;height:100%}'}</style>
      <div ref={el} style={{ width: '100%', height: '100%', minHeight: 200 }} />
    </div>
  );
}
