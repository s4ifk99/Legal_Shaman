"use client";

import { useMemo } from "react";
import { MapContainer, Marker, Popup, TileLayer } from "react-leaflet";
import L from "leaflet";
import type { MapMarker } from "@/lib/search/map-results";
import { MapMarkerPopup } from "@/components/search/map-marker-popup";

import "leaflet/dist/leaflet.css";

const UK_CENTER: [number, number] = [54.5, -2.5];

const defaultIcon = L.icon({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

type LegalMapProps = {
  markers: MapMarker[];
  className?: string;
};

export function LegalMap({ markers, className }: LegalMapProps) {
  const center = useMemo((): [number, number] => {
    if (!markers.length) return UK_CENTER;
    const lat = markers.reduce((s, m) => s + m.lat, 0) / markers.length;
    const lng = markers.reduce((s, m) => s + m.lng, 0) / markers.length;
    return [lat, lng];
  }, [markers]);

  const zoom = markers.length <= 1 ? 11 : 8;

  const wrapperClass =
    className ?? "h-[420px] w-full overflow-hidden rounded-lg border border-border";

  return (
    <div className={wrapperClass}>
      <MapContainer center={center} zoom={zoom} scrollWheelZoom className="h-full w-full">
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {markers.map((m) => (
          <Marker key={m.id} position={[m.lat, m.lng]} icon={defaultIcon}>
            <Popup>
              <MapMarkerPopup marker={m} />
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}
