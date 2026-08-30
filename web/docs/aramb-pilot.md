# The Shaman research service

The pilot is disabled unless `ENABLE_ARAMB_PILOT` is enabled and both
`ARAMB_KEY` and `ARAMB_AGENT_ID` are present. The API key is read only by the
server-side adapter in `lib/aramb/client.ts`.

The Shaman is not part of the normal intake path. Penumbra is the only research
mode. A user must acknowledge Penumbra and click **Run exploratory research**
from a completed Overview. Legal Shaman then creates a separate child turn at
`/api/coherence/aramb/research`; subsequent replies resume the same opaque
conversation ID. The browser persists only the case binding, conversation ID,
status, questions and latest validated bundle — not a second transcript.

Each turn is two-phase. It first sends The Shaman a bounded set of Legal Shaman wiki
and authority excerpts and asks it to use those curated sources first. The Shaman may
then use the web/search/browser capabilities configured on the selected agent
to investigate unresolved gaps. Curated sources retain canonical IDs; external
sources must use an `https` URL and are labelled `external/unverified`, with
source-linked claims and recorded uncertainty or conflicts.

The adapter uses a SHA-256-derived `subTenant` based on the authenticated user
and a stable local case key, and creates an ephemeral five-minute conversation
with a two-minute idle timeout. Returned curated source IDs are mapped back to
the canonical Legal Shaman records before URLs, tiers or claims reach the UI.
External sources are bounded, validated for HTTPS provenance and never treated
as canonical.
When The Shaman finds free advice, helpline, clinic, ombudsman or government resources,
it returns source-linked `freeResources` candidates. Legal Shaman stores these in
`coherence_resource_candidates` with `provenance=aramb` and
`review_status=pending_review`; they are shown separately in Matching Help and
must be reviewed before entering the trusted offline service index.
The Shaman can ask focused questions and return labelled research leads, but its
`answerDraft` is never the final answer. The user must explicitly hand findings
back to Legal Shaman; only then does the normal Overview synthesis and critic
run.
For matching help, The Shaman may also return one source-linked legal-area lens and
routing rationale, never an individual solicitor recommendation. Legal Shaman
uses that lens when building its curated HelpPack and SRA search; strong
employment facts take priority over a stray label such as “Criminal”.

The installed provider SDK exposes agent/session APIs and tool disabling, but no custom
tool-handler registration surface. Legal Shaman therefore executes the three
curated tools locally before dispatch (`wiki_search`, `authority_search`, and
`source_fetch`) and gives The Shaman their source-linked output. If the configured
agent is disabled, cannot browse, or fails, the API returns those curated
sources as a clearly marked fallback rather than inventing open-web findings.
HelpMatch and SRA solicitor signposting remain local Legal Shaman functions;
The Shaman improves their routing context rather than replacing those safeguards.
