"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useBookmarks } from "@/components/bookmarks/bookmarks-provider";
import type { WorkspaceProvider, ProviderCost, ProviderPositioning } from "@/lib/coherence/providerRecords";
import { sortWorkspaceProviders } from "@/lib/coherence/providerRecords";
import type { UkNation, UserLocation } from "@/lib/coherence/serviceCoverage";
import { LocationField } from "./LocationField";
import {
  PROVIDER_NOTE_STATUSES,
  PROVIDER_NOTE_STATUS_LABEL,
  type ProviderNoteRecord,
  type ProviderNoteStatus,
} from "@/lib/provider-notes/types";
import "./ResultsWorkspace.css";

type CostFilter = "all" | ProviderCost;
type PositionFilter = "all" | ProviderPositioning;
type LocationFilter = "all" | "covers" | "elsewhere";

const COST_FILTERS: { id: CostFilter; label: string }[] = [
  { id: "all", label: "Any cost" },
  { id: "free", label: "Free" },
  { id: "publicly_funded", label: "Publicly funded" },
  { id: "paid", label: "Paid" },
  { id: "unknown", label: "Cost not stated" },
];

const POSITION_FILTERS: { id: PositionFilter; label: string }[] = [
  { id: "all", label: "Any type" },
  { id: "charity", label: "Charity" },
  { id: "helpline", label: "Helpline" },
  { id: "law_centre", label: "Law centre" },
  { id: "legal_aid", label: "Legal aid" },
  { id: "sra_firm", label: "SRA firm" },
  { id: "directory", label: "Directory" },
  { id: "official", label: "Official guidance" },
  { id: "other", label: "Other" },
];

type Draft = {
  status: ProviderNoteStatus;
  contactedOn: string;
  contactName: string;
  whatTheySaid: string;
  feesOrEligibility: string;
  followUp: string;
  impression: string;
  shortlisted: boolean;
};

function draftFrom(note: ProviderNoteRecord | undefined): Draft {
  return {
    status: note?.status ?? "not_contacted",
    contactedOn: note?.contactedOn ?? "",
    contactName: note?.contactName ?? "",
    whatTheySaid: note?.whatTheySaid ?? "",
    feesOrEligibility: note?.feesOrEligibility ?? "",
    followUp: note?.followUp ?? "",
    impression: note?.impression ?? "",
    shortlisted: note?.shortlisted ?? false,
  };
}

export type WorkspaceSection = {
  id: string;
  title: string;
  providers: WorkspaceProvider[];
};

export function ResultsWorkspace({
  providers,
  sections,
  place,
  onPlaceChange,
}: {
  providers: WorkspaceProvider[];
  sections?: WorkspaceSection[];
  place?: UserLocation | null;
  onPlaceChange?: (input: string, nation: UkNation | null) => void;
}) {
  const { user, requireAuth, isBookmarked, toggleBookmark } = useBookmarks();
  const [cost, setCost] = useState<CostFilter>("all");
  const [position, setPosition] = useState<PositionFilter>("all");
  const [location, setLocation] = useState<LocationFilter>("all");
  const [sort, setSort] = useState<"recommended" | "name">("recommended");
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [notes, setNotes] = useState<ProviderNoteRecord[]>([]);
  const [draft, setDraft] = useState<Draft>(draftFrom(undefined));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const loadNotes = useCallback(async () => {
    if (!user) {
      setNotes([]);
      return;
    }
    const res = await fetch("/api/provider-notes");
    if (!res.ok) return;
    const data = (await res.json()) as { notes: ProviderNoteRecord[] };
    setNotes(data.notes);
  }, [user]);

  useEffect(() => {
    void loadNotes();
  }, [loadNotes]);

  const notesByKey = useMemo(() => new Map(notes.map((note) => [note.providerKey, note])), [notes]);

  const groups = sections?.length ? sections : [{ id: "results", title: "All results", providers }];

  function visibleIn(list: WorkspaceProvider[]) {
    const filtered = list.filter((provider) => {
      if (cost !== "all" && provider.cost !== cost) return false;
      if (position !== "all" && provider.positioning !== position) return false;
      if (location === "covers" && !provider.coversPlace) return false;
      if (location === "elsewhere" && provider.coversPlace) return false;
      return true;
    });
    return sortWorkspaceProviders(filtered, sort);
  }

  function openNotes(provider: WorkspaceProvider) {
    setOpenKey(provider.key);
    setDraft(draftFrom(notesByKey.get(provider.key)));
    setSaveError(null);
  }

  async function persist(provider: WorkspaceProvider, next: Draft) {
    const res = await fetch("/api/provider-notes", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        providerKey: provider.key,
        displayName: provider.name,
        url: provider.url,
        ...next,
      }),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      throw new Error(data?.error || "Could not save the note");
    }
    const data = (await res.json()) as { note: ProviderNoteRecord };
    setNotes((prev) => {
      const rest = prev.filter((note) => note.providerKey !== data.note.providerKey);
      return [data.note, ...rest];
    });
    setDraft(draftFrom(data.note));
  }

  function save(provider: WorkspaceProvider) {
    setSaveError(null);
    requireAuth(() => {
      setSaving(true);
      void persist(provider, draft)
        .catch((err: unknown) => setSaveError(err instanceof Error ? err.message : "Could not save the note"))
        .finally(() => setSaving(false));
    }, "bookmark");
  }

  function toggleShortlist(provider: WorkspaceProvider) {
    if (provider.bookmark) {
      requireAuth(() => {
        void toggleBookmark({
          entityId: provider.bookmark!.entityId,
          resultSource: provider.bookmark!.resultSource,
          businessName: provider.name,
        });
      }, "bookmark");
      return;
    }
    const existing = notesByKey.get(provider.key);
    const next = { ...draftFrom(existing), shortlisted: !existing?.shortlisted };
    requireAuth(() => {
      setSaving(true);
      void persist(provider, next)
        .catch((err: unknown) => setSaveError(err instanceof Error ? err.message : "Could not update the shortlist"))
        .finally(() => setSaving(false));
    }, "bookmark");
  }

  function isShortlisted(provider: WorkspaceProvider): boolean {
    if (provider.bookmark && isBookmarked(provider.bookmark)) return true;
    return Boolean(notesByKey.get(provider.key)?.shortlisted);
  }

  if (!groups.some((group) => group.providers.length)) return null;

  return (
    <section className="workspace" aria-labelledby="workspace-title">
      <header className="workspace__header">
        {sections?.length ? null : (
          <h2 id="workspace-title" className="workspace__title">
            All results
          </h2>
        )}
        <p className="workspace__lead" id={sections?.length ? "workspace-title" : undefined}>
          Turn a filter on and each list shortens. Fees are open-source notes, not a quote. Not legal advice.
        </p>
      </header>

      {onPlaceChange ? (
        <LocationField
          key={place?.input ?? ""}
          location={place ?? null}
          hiddenCount={place ? providers.filter((provider) => !provider.coversPlace).length : null}
          onChange={(input, nation) => {
            onPlaceChange(input, nation);
            setLocation(input.trim() ? "covers" : "all");
          }}
        />
      ) : null}

      <div className="workspace__filters">
        <label>
          Cost
          <select value={cost} onChange={(e) => setCost(e.target.value as CostFilter)}>
            {COST_FILTERS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Organisation type
          <select value={position} onChange={(e) => setPosition(e.target.value as PositionFilter)}>
            {POSITION_FILTERS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Location
          <select value={location} onChange={(e) => setLocation(e.target.value as LocationFilter)}>
            <option value="all">All results</option>
            <option value="covers" disabled={!place}>
              {place ? `Covers ${place.label}` : "Covers your town"}
            </option>
            <option value="elsewhere" disabled={!place}>
              {place ? `Does not cover ${place.label}` : "Does not cover your town"}
            </option>
          </select>
        </label>
        <label>
          Sort
          <select value={sort} onChange={(e) => setSort(e.target.value as "recommended" | "name")}>
            <option value="recommended">Free and funded first</option>
            <option value="name">Name</option>
          </select>
        </label>
      </div>

      {groups.map((group) => {
        const visible = visibleIn(group.providers);
        return (
          <section key={group.id} id={group.id} className="workspace__group">
            <h2 className="workspace__title">{group.title}</h2>
            <p className="workspace__count">
              {visible.length === group.providers.length
                ? `${group.providers.length}`
                : `${visible.length} of ${group.providers.length}`}
            </p>
            <ul className="workspace__list">
              {visible.map((provider) => {
          const note = notesByKey.get(provider.key);
          const open = openKey === provider.key;
          return (
            <li key={provider.key} className="workspace__item">
              <div className="workspace__row">
                <div className="workspace__body">
                  <h3>{provider.name}</h3>
                  <p className="workspace__meta">
                    {provider.costLabel} · {provider.positioningLabel} · {provider.locationLabel}
                  </p>
                  <p className="workspace__meta">{provider.feeLabel}</p>
                  <p className="workspace__meta">
                    <a href={provider.feeSourceUrl} target="_blank" rel="noreferrer">
                      {provider.feeSourceName}
                    </a>
                  </p>
                  <p className="workspace__meta">
                    {provider.reviewsLabel}{" "}
                    <a href={provider.googleReviewsUrl} target="_blank" rel="noreferrer">
                      Google reviews
                    </a>
                  </p>
                  {provider.unavailableReason ? <p className="workspace__meta">{provider.unavailableReason}</p> : null}
                  <p className="workspace__source">{provider.sourceLabel}</p>
                  {provider.blurb ? <p>{provider.blurb}</p> : null}
                  <p className="workspace__links">
                    {provider.url ? (
                      <a href={provider.url} target="_blank" rel="noreferrer">
                        Website
                      </a>
                    ) : null}
                    {provider.phone ? <span>{provider.phone}</span> : null}
                    {note ? <span>{PROVIDER_NOTE_STATUS_LABEL[note.status]}</span> : null}
                  </p>
                </div>
                <div className="workspace__actions">
                  <button type="button" onClick={() => toggleShortlist(provider)}>
                    {isShortlisted(provider) ? "Shortlisted" : "Shortlist"}
                  </button>
                  <button type="button" onClick={() => (open ? setOpenKey(null) : openNotes(provider))}>
                    {open ? "Close notes" : "Notes"}
                  </button>
                </div>
              </div>
              {open ? (
                <form
                  className="workspace__notes"
                  onSubmit={(e) => {
                    e.preventDefault();
                    save(provider);
                  }}
                >
                  <label>
                    Status
                    <select
                      value={draft.status}
                      onChange={(e) => setDraft((prev) => ({ ...prev, status: e.target.value as ProviderNoteStatus }))}
                    >
                      {PROVIDER_NOTE_STATUSES.map((status) => (
                        <option key={status} value={status}>
                          {PROVIDER_NOTE_STATUS_LABEL[status]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Date contacted
                    <input
                      type="date"
                      value={draft.contactedOn}
                      onChange={(e) => setDraft((prev) => ({ ...prev, contactedOn: e.target.value }))}
                    />
                  </label>
                  <label>
                    Person you spoke to
                    <input
                      value={draft.contactName}
                      onChange={(e) => setDraft((prev) => ({ ...prev, contactName: e.target.value }))}
                    />
                  </label>
                  <label>
                    What they said
                    <textarea
                      value={draft.whatTheySaid}
                      onChange={(e) => setDraft((prev) => ({ ...prev, whatTheySaid: e.target.value }))}
                    />
                  </label>
                  <label>
                    Fees or eligibility
                    <textarea
                      value={draft.feesOrEligibility}
                      onChange={(e) => setDraft((prev) => ({ ...prev, feesOrEligibility: e.target.value }))}
                    />
                  </label>
                  <label>
                    Follow-up
                    <textarea
                      value={draft.followUp}
                      onChange={(e) => setDraft((prev) => ({ ...prev, followUp: e.target.value }))}
                    />
                  </label>
                  <label>
                    Your impression
                    <textarea
                      value={draft.impression}
                      onChange={(e) => setDraft((prev) => ({ ...prev, impression: e.target.value }))}
                    />
                  </label>
                  <div className="workspace__notes-actions">
                    <button type="submit" disabled={saving}>
                      {saving ? "Saving…" : "Save note"}
                    </button>
                    {saveError ? <span>{saveError}</span> : null}
                    {!user ? <span>Sign in to keep this note on your account.</span> : null}
                  </div>
                </form>
              ) : null}
            </li>
          );
              })}
            </ul>
            {!visible.length ? <p>None in this group.</p> : null}
          </section>
        );
      })}
    </section>
  );
}
