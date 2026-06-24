"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  PRACTICE_AREA_SLUGS,
  type AppliedFilters,
  type PracticeAreaSlug,
} from "@/lib/agent/types";

type Props = {
  value: AppliedFilters;
  onChange: (next: AppliedFilters) => void;
  disabled?: boolean;
};

const PRACTICE_AREA_LABELS: Record<PracticeAreaSlug, string> = {
  employment: "Employment",
  immigration: "Immigration",
  family: "Family",
  criminal_defence: "Criminal defence",
  personal_injury: "Personal injury",
  commercial: "Commercial",
};

export function LawyerFiltersSidebar({ value, onChange, disabled }: Props) {
  const set = <K extends keyof AppliedFilters>(key: K, v: AppliedFilters[K]) => {
    const next = { ...value, [key]: v };
    if (v === undefined || v === false || v === "") {
      delete next[key];
    }
    onChange(next);
  };

  return (
    <Card className="sticky top-4">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Filters</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-2">
          <Label htmlFor="filter-practice">Practice area</Label>
          <Select
            disabled={disabled}
            value={value.practiceArea ?? "any"}
            onValueChange={(v) =>
              set("practiceArea", v === "any" ? undefined : (v as PracticeAreaSlug))
            }
          >
            <SelectTrigger id="filter-practice">
              <SelectValue placeholder="Any" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="any">Any practice area</SelectItem>
              {PRACTICE_AREA_SLUGS.map((slug) => (
                <SelectItem key={slug} value={slug}>
                  {PRACTICE_AREA_LABELS[slug]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="filter-language">Language</Label>
          <Input
            id="filter-language"
            disabled={disabled}
            placeholder="e.g. Urdu"
            value={value.language ?? ""}
            onChange={(e) => set("language", e.target.value.trim() || undefined)}
          />
        </div>

        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={Boolean(value.freeConsultation)}
              onCheckedChange={(c) => set("freeConsultation", c === true ? true : undefined)}
              disabled={disabled}
            />
            Free consultation
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={Boolean(value.verifiedOnly)}
              onCheckedChange={(c) => set("verifiedOnly", c === true ? true : undefined)}
              disabled={disabled}
            />
            Verified credentials only
          </label>
        </div>
      </CardContent>
    </Card>
  );
}
