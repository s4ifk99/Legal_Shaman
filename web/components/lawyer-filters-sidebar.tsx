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
import { useLocale } from "@/components/i18n/locale-provider";

type Props = {
  value: AppliedFilters;
  onChange: (next: AppliedFilters) => void;
  disabled?: boolean;
};

export function LawyerFiltersSidebar({ value, onChange, disabled }: Props) {
  const { t } = useLocale();
  const practiceLabels: Record<PracticeAreaSlug, string> = {
    employment: t.employment,
    immigration: t.immigration,
    family: t.family,
    criminal_defence: t.criminalDefence,
    personal_injury: t.personalInjury,
    commercial: t.commercial,
  };
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
        <CardTitle className="text-base">{t.filters}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-2">
          <Label htmlFor="filter-practice">{t.practiceArea}</Label>
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
              <SelectItem value="any">{t.anyPractice}</SelectItem>
              {PRACTICE_AREA_SLUGS.map((slug) => (
                <SelectItem key={slug} value={slug}>
                  {practiceLabels[slug]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="filter-language">{t.filterLanguage}</Label>
          <Input
            id="filter-language"
            disabled={disabled}
            placeholder={t.languageExample}
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
            {t.freeConsultation}
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={Boolean(value.verifiedOnly)}
              onCheckedChange={(c) => set("verifiedOnly", c === true ? true : undefined)}
              disabled={disabled}
            />
            {t.verifiedOnly}
          </label>
        </div>
      </CardContent>
    </Card>
  );
}
