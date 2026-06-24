"use client";

import { useCallback, useState } from "react";
import { Loader2, MapPin, Navigation } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type SearchOrigin = { lat: number; lng: number };

type SearchLocationBarProps = {
  city: string;
  onCityChange: (city: string) => void;
  origin: SearchOrigin | null;
  onOriginChange: (origin: SearchOrigin | null) => void;
  disabled?: boolean;
};

export function SearchLocationBar({
  city,
  onCityChange,
  origin,
  onOriginChange,
  disabled,
}: SearchLocationBarProps) {
  const [geoStatus, setGeoStatus] = useState<"idle" | "loading" | "error">("idle");
  const [geoMessage, setGeoMessage] = useState<string | null>(null);

  const useMyLocation = useCallback(() => {
    if (disabled || typeof navigator === "undefined" || !navigator.geolocation) {
      setGeoStatus("error");
      setGeoMessage("Location is not available in this browser.");
      return;
    }

    setGeoStatus("loading");
    setGeoMessage(null);

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        try {
          const { latitude, longitude } = position.coords;
          const res = await fetch(
            `/api/search/location/reverse?lat=${encodeURIComponent(String(latitude))}&lng=${encodeURIComponent(String(longitude))}`,
          );
          const data = (await res.json()) as {
            city?: string;
            label?: string;
            lat?: number;
            lng?: number;
            error?: string;
          };
          if (!res.ok) throw new Error(data.error || "Could not resolve your area");

          onOriginChange({ lat: latitude, longitude });
          if (data.city) onCityChange(data.city);
          setGeoStatus("idle");
          setGeoMessage(data.label ? `Using ${data.label}` : "Using your current area");
        } catch (err) {
          setGeoStatus("error");
          setGeoMessage(err instanceof Error ? err.message : "Could not detect location");
        }
      },
      () => {
        setGeoStatus("error");
        setGeoMessage("Location permission denied. Enter a city manually.");
      },
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 120_000 },
    );
  }, [disabled, onCityChange, onOriginChange]);

  return (
    <div className="space-y-2 rounded-lg border border-border/70 bg-muted/20 p-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[12rem] flex-1 space-y-1.5">
          <Label htmlFor="search-location-city" className="text-sm">
            Where do you need help?
          </Label>
          <div className="relative">
            <MapPin className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="search-location-city"
              disabled={disabled}
              placeholder="e.g. London"
              value={city}
              onChange={(e) => {
                onOriginChange(null);
                onCityChange(e.target.value);
              }}
              className="pl-9"
            />
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled || geoStatus === "loading"}
          onClick={useMyLocation}
          className="shrink-0"
        >
          {geoStatus === "loading" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Navigation className="h-4 w-4" />
          )}
          <span className="ml-1.5">Use my location</span>
        </Button>
      </div>
      {origin ? (
        <p className="text-xs text-muted-foreground">
          Results will be ranked nearer to your current area.
        </p>
      ) : null}
      {geoMessage ? (
        <p className={geoStatus === "error" ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>
          {geoMessage}
        </p>
      ) : null}
    </div>
  );
}
