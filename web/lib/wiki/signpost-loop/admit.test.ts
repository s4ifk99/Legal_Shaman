import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ExaSearchHit } from "@/lib/penumbra/exaSearch";
import {
  filterOpenExaByAuthority,
  isSharedWordCollisionOnly,
} from "./admit-gates";

describe("signpost-loop admit gates", () => {
  it("rejects a protest-march wiki hit for the place facet even when it shares public", () => {
    const facet = {
      id: "place",
      need: "Whether fixing a public poster on a wall or shopfront needs owner or highway permission",
      query: "fly posting walls shopfronts permission public posters England",
    };
    const hit = {
      title: "Organising a protest march in a public place",
      excerpt:
        "Guidance on holding a protest march or demonstration in a public place, including notice to the police.",
    };
    assert.equal(isSharedWordCollisionOnly(facet, hit), true);
  });

  it("drops an open Exa hit on a non-gov.uk host for the local facet", () => {
    const hits: ExaSearchHit[] = [
      {
        id: "forum-1",
        url: "https://www.reddit.com/r/legaladviceuk/comments/poster",
        title: "Is fly posting allowed in Kent?",
        excerpt: "People say Dover fines you £80 for posters.",
      },
      {
        id: "blog-1",
        url: "https://example-news.co.uk/kent-posters",
        title: "Kent poster rules",
        excerpt: "Local commentary on posters.",
      },
      {
        id: "dover-1",
        url: "https://www.dover.gov.uk/Environment/Flyposting.aspx",
        title: "Flyposting — Dover District Council",
        excerpt: "Fixed penalty for fly-posting without consent.",
      },
    ];
    const kept = filterOpenExaByAuthority(hits);
    assert.equal(kept.length, 1);
    assert.equal(kept[0]?.url, "https://www.dover.gov.uk/Environment/Flyposting.aspx");
  });
});
