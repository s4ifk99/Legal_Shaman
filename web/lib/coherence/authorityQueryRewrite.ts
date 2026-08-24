/**
 * Pre-retrieval query rewrite for authority matching (GuRE / GLIER inspired).
 * Exa hunt 20260821: lay vocabulary ≠ seed/firm keywords → false empties.
 *
 * Two layers:
 * 1. Offline cue injection (no LLM) — maps lay phrases → legal retrieval cues.
 * 2. Prefer confirmed LLM reformulation when present on the session.
 *
 * Product path: never calls Exa.
 */

export type AuthorityRewriteResult = {
  /** Text used for keyword matching (original + cues / reformulation). */
  retrievalText: string
  /** Cues appended (empty if none). */
  injectedCues: string[]
  source: 'original' | 'cues' | 'confirmed_reformulation' | 'cues+confirmed'
}

/** Lay pattern → UK legal / seed-friendly cue phrases (must stay factual, not advice). */
const CUE_RULES: Array<{ re: RegExp; cues: string[] }> = [
  {
    re: /\b(pulled out of school|withdraw .* school|take .* out of school|elective home education|home.?school)\b/i,
    cues: ['school attendance', 'parental responsibility', 'elective home education', 'school absence'],
  },
  {
    re: /\b(claim form|n1\b|acknowledgement of service|county court claim|do i have to reply)\b/i,
    cues: [
      'county court claim',
      'defence',
      'acknowledgement of service',
      'letter before action',
      'small claims',
    ],
  },
  {
    re: /\bbed[\s-]?bugs?\b/i,
    cues: [
      'disrepair',
      'landlord repairs',
      'housing health',
      'infestation',
      'neighbour disputes',
      'bring a claim against my landlord',
    ],
  },
  {
    re: /\b(hit a parked car|reversing|collision|road traffic accident|rta|duty to (stop|report)|left no note)\b/i,
    cues: [
      'road traffic accident',
      'duty to report',
      'duty to stop',
      'motor insurance',
      'hit and run',
      'section 170',
      'breakdowns and incidents',
    ],
  },
  {
    re: /\b(trees?|hedge|boundary).{0,40}(neighbour|cut down|dumped)|neighbour.{0,40}(trees?|hedge)\b/i,
    cues: ['neighbour disputes', 'cut down hedge', 'tree or hedge', 'boundary', 'trespass', 'damage to property'],
  },
  {
    re: /\b(working hours|designated breaks?|night work|sleep[- ]?in|support worker|assisted living|care work).{0,40}(job|illegal|breaks?|days off)?|\bno designated breaks?\b/i,
    cues: ['working time', 'rest breaks', 'night working', 'national minimum wage', 'working hours'],
  },
  {
    re: /\b(enforcement officer|bailiff|debt collection).{0,40}(visit|enter|landlord|property)\b/i,
    cues: ['bailiffs', 'enforcement officer', 'debt collection', 'what bailiffs can take'],
  },
  {
    re: /\b(penalty fare|wrong name).{0,30}(inspector|notice|fare)\b/i,
    cues: ['penalty fare', 'rail penalty'],
  },
  {
    re: /\b(deceased|bereavement|died).{0,40}(drive|vehicle|car|insurance)|drive .{0,30}(deceased|dead).{0,20}(car|vehicle)\b/i,
    cues: ['vehicle insurance', 'probate', 'deceased', 'driving licence'],
  },
  {
    re: /\b(court documents|old case|charged with|criminal record|transcript)\b/i,
    cues: ['court transcript', 'court documents', 'criminal record'],
  },
  {
    re: /\b(wild animal|injured animal|fox|badger|wildlife).{0,40}vet/i,
    cues: ['wildlife', 'animal welfare', 'veterinary', 'wild animals'],
  },
  {
    re: /\b(northern ireland|\(ni\)).{0,80}(divorce|financial)|divorce.{0,40}(ni\)|northern ireland)|financial remedy|ancillary relief\b/i,
    cues: [
      'financial remedy',
      'northern ireland',
      'divorce',
      'ancillary relief',
      'matrimonial',
      'homeless',
    ],
  },
  {
    re: /\b(cv|curriculum vitae|lied about).{0,40}(job|employment|reference)|false .{0,20}(cv|reference)\b/i,
    cues: ['job reference', 'providing a job reference', 'misrepresentation', 'references'],
  },
  {
    re: /\b(harassment|stalk(?:ing|ed)?|assault(?:ed)?|report a crime|malicious communications|criminal damage|threat(?:en(?:ed|ing)|s)?|police|neglect of duty|restraining order|bail conditions)\b/i,
    cues: [
      'harassment',
      'stalking',
      'stalked',
      'assault',
      'assaulted',
      'police',
      'threat',
      'threatened',
      'report a crime',
      'malicious communications',
      'criminal damage',
      'victim support',
      'restraining order',
    ],
  },
  {
    re: /\b(probate|executor|intestat|contest a will|letters of administration|inheritance tax|inherit(?:ance)?)\b/i,
    cues: ['probate', 'will', 'inheritance', 'executor', 'estate', 'contest a will'],
  },
  {
    re: /\b(unfair dismissal|constructive dismissal|redundan(?:cy|t)|holiday pay|sick (?:leave|note)|workplace bullying|sacked|dismissed|employment tribunal|tribunal)\b/i,
    cues: [
      'dismissal',
      'redundancy',
      'holiday pay',
      'sick leave',
      'acas',
      'unfair dismissal',
      'workplace harassment',
      'employer',
      'wages',
      'employment tribunal',
    ],
  },
  {
    re: /\b(speeding|penalty points|totting|exceptional hardship|driving disqualification|pcn|parking (?:fine|ticket)|penalty notice)\b/i,
    cues: [
      'speeding',
      'penalty points',
      'exceptional hardship',
      'parking fine',
      'pcn',
      'parking',
      'driving',
      'penalty notice',
    ],
  },
  {
    re: /\b(debt collector|ccj|county court judgment|bailiff|enforcement officer)\b/i,
    cues: ['debt', 'bailiff', 'ccj', 'debt collector', 'enforcement officer', 'iva'],
  },
  {
    re: /\b(companies house|limited company|director duties|shareholder|insolvency)\b/i,
    cues: ['company', 'director', 'limited company', 'shareholder', 'companies house'],
  },
  {
    re: /\b(take .{0,20}child abroad|child abroad|child overseas|deed poll|lasting power of attorney|legal aid)\b/i,
    cues: [
      'parental responsibility',
      'take a child abroad',
      'child abroad',
      'deed poll',
      'power of attorney',
      'legal aid',
      'small claims',
    ],
  },
  {
    re: /\b(subject access|gdpr|data protection|ico|nanny cam|cctv|covert (?:camera|recording)|home (?:camera|recording))\b/i,
    cues: [
      'gdpr',
      'data protection',
      'subject access request',
      'ico',
      'personal data',
      'cctv',
      'recording',
      'privacy',
    ],
  },
  {
    re: /\b(neighbour|neighbor|boundary dispute|noisy neighbour)\b/i,
    cues: ['neighbour', 'neighbour disputes', 'boundary', 'hedge', 'tree', 'fence'],
  },
  {
    re: /\b(nhs|hospital|gp\b|dentist|clinical negligence|medical negligence|medication)\b/i,
    cues: [
      'nhs',
      'hospital',
      'clinical negligence',
      'complain about nhs',
      'nhs complaints',
      'medical',
      'dentist',
    ],
  },
  {
    re: /\b(conveyanc|exchange of contracts|completion|house sale|buying a (?:house|home)|selling (?:my )?(?:house|home))\b/i,
    cues: [
      'conveyancing',
      'buying a home',
      'selling a home',
      'exchange of contracts',
      'completion',
      'surveyor',
    ],
  },
  {
    re: /\b(dog|cat|pet|animal|vet|rspca|animal bite|wildlife)\b/i,
    cues: ['pet', 'dog', 'animal', 'rspca', 'animal welfare', 'dangerous dogs'],
  },
  {
    re: /\b(copyright|trademark|trade mark|patent|intellectual property)\b/i,
    cues: ['copyright', 'trade mark', 'intellectual property', 'ipo'],
  },
  {
    re: /\b(flight|airline|airport|luggage|package holiday|denied boarding|flight delay)\b/i,
    cues: [
      'flight',
      'airline',
      'air passenger',
      'luggage',
      'package holiday',
      'caa',
      'flight delay',
    ],
  },
  {
    re: /\b(ebay|vinted|amazon|solar panel|installer no longer)\b/i,
    cues: ['consumer rights', 'refund', 'faulty', 'trader', 'warranty'],
  },
  {
    re: /\b(family court|directions hearing)\b/i,
    cues: ['family court', 'child arrangements', 'parental responsibility'],
  },
  {
    re: /\b(bail conditions?|court summons|crown court|magistrates|suspended sentence|police caution|\bnfa\b|citizens.? arrest)\b/i,
    cues: [
      'bail',
      'bail conditions',
      'court summons',
      'crown court',
      'magistrates',
      'caution',
      'nfa',
      'cps',
      'plea',
      'sentence',
      'breach',
    ],
  },
  {
    re: /\b(scotland|scottish|northern ireland|\bn\.?i\.?\b|wales|welsh)\b/i,
    cues: ['scotland', 'scottish', 'northern ireland', 'wales', 'welsh', 'citizens advice scotland', 'mygov', 'nidirect'],
  },
  {
    re: /\b(leasehold|service charge|ground rent|freeholder|leaseholder)\b/i,
    cues: [
      'leasehold',
      'service charge',
      'ground rent',
      'leaseholder',
      'freeholder',
      'housing ombudsman',
      'service charge increase',
    ],
  },
  {
    re: /\b(complain .{0,20}solicitor|solicitor negligence|legal ombudsman|\bsra\b|barrister complaint)\b/i,
    cues: [
      'solicitor',
      'legal ombudsman',
      'sra',
      'complain about solicitor',
      'solicitor negligence',
      'lawyer complaint',
    ],
  },
  {
    re: /\b(energy bill|ofgem|ofcom|broadband|energy supplier|smart meter|telecoms|bt\b|energy ombudsman)\b/i,
    cues: [
      'energy bill',
      'ofgem',
      'ofcom',
      'broadband',
      'energy supplier',
      'telecoms',
      'energy ombudsman',
    ],
  },
  {
    re: /\b(parking (?:fine|ticket|charge|app|company)|car\s*park|pcn|popla|private parking)\b/i,
    cues: [
      'parking fine',
      'parking charge',
      'private parking',
      'car park',
      'popla',
      'parking ticket',
      'appeal parking',
    ],
  },
  {
    re: /\bgrandparents?['’`]?\s*rights?\b/i,
    cues: ['grandparents rights', 'child arrangements', 'family court', 'contact with child'],
  },
  {
    re: /\b(bank details|identity|personal details|name and bank).{0,40}(stolen|used|fraud|laptops|phones)|used .{0,40}(name and bank|bank details)\b/i,
    cues: ['identity theft', 'identity fraud', 'personal details', 'report a scam'],
  },
  {
    re: /\b(will)\b.{0,40}(added|without consent|someone else)|home added to .{0,20}will\b/i,
    cues: ['probate', 'will', 'inheritance', 'lasting power of attorney'],
  },
  {
    re: /\b(fintech|payment institution|e-?money|fca licence|fca license)\b/i,
    cues: ['FCA authorisation', 'financial services', 'consumer credit'],
  },
  {
    re: /\b(litter(ing)?|cigarette).{0,20}(fine|ticket|penalty)|fpn\b/i,
    cues: ['fixed penalty notice', 'littering', 'penalty charge'],
  },
  {
    re: /\b(discipline|smack|corporal).{0,20}(child|kid|teen)|discipline kids?\b/i,
    cues: ['reasonable chastisement', 'child protection', 'assault', 'parental responsibility'],
  },
  {
    re: /\b(university|offer letter|fee status|student).{0,40}(withdraw|disciplinary|complaint)|facebook (page|group).{0,20}renamed\b/i,
    cues: ['student complaint', 'university', 'university disciplinary', 'OIA', 'facebook page got renamed'],
  },
  {
    re: /\b(section\s*8|ground[s]?\s*\d+)\b/i,
    cues: ['section 8', 'eviction', 'possession', 'landlord', 'tenant'],
  },
]

export function injectAuthorityCues(text: string): { text: string; cues: string[] } {
  const cues: string[] = []
  const seen = new Set<string>()
  for (const rule of CUE_RULES) {
    if (!rule.re.test(text)) continue
    for (const c of rule.cues) {
      const key = c.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      cues.push(c)
    }
  }
  if (!cues.length) return { text, cues: [] }
  return { text: `${text}\n\n${cues.join(' ')}`, cues }
}

/**
 * Build retrieval blob for authority matching.
 * Prefer confirmed LLM reformulation; always allow offline cue injection on the lay text.
 */
export function prepareAuthorityRetrievalText(opts: {
  original: string
  confirmedReformulation?: string | null
}): AuthorityRewriteResult {
  const original = (opts.original || '').trim()
  const confirmed = (opts.confirmedReformulation || '').trim()
  const fromOrig = injectAuthorityCues(original)
  const fromConf =
    confirmed && confirmed.toLowerCase() !== original.toLowerCase()
      ? injectAuthorityCues(confirmed)
      : { text: confirmed, cues: [] as string[] }

  const seen = new Set<string>()
  const cues: string[] = []
  for (const c of [...fromOrig.cues, ...fromConf.cues]) {
    const key = c.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    cues.push(c)
  }

  if (confirmed && confirmed.toLowerCase() !== original.toLowerCase()) {
    const merged = cues.length
      ? `${confirmed}\n\n${original}\n\n${cues.join(' ')}`
      : `${confirmed}\n\n${original}`
    return {
      retrievalText: merged,
      injectedCues: cues,
      source: cues.length ? 'cues+confirmed' : 'confirmed_reformulation',
    }
  }

  if (cues.length) {
    return { retrievalText: fromOrig.text, injectedCues: cues, source: 'cues' }
  }

  return { retrievalText: original, injectedCues: [], source: 'original' }
}
