import { z } from "zod";

const Slug = z.string().regex(/^[a-z0-9][a-z0-9-]*$/);
const Hostname = z.string().regex(/^[a-z0-9.-]+\.[a-z]{2,}$/);
const IsoDate = z.iso.date();
const IsoDateTime = z.iso.datetime();

// ---------------------------------------------------------------------------------------------
// Policy (repo, shared): safety rules the runner enforces regardless of operator, product or batch.
// ---------------------------------------------------------------------------------------------

export const PolicySchema = z.strictObject({
  /** Never true. Kept as a literal so a future edit that flips it fails validation. */
  allow_payments: z.literal(false),
  /** Hosts that may appear mid-flow as an identity provider. Navigation there is click-driven only. */
  auth_hosts: z.array(Hostname),
  /** Hosts that mean "a payment is being taken". Reaching one ends the item as deferred_paid. */
  payment_hosts: z.array(Hostname),
});
export type Policy = z.infer<typeof PolicySchema>;

// ---------------------------------------------------------------------------------------------
// Config (workspace, per operator): who the launch identity is and how big a run may be.
// ---------------------------------------------------------------------------------------------

export const ConfigSchema = z.strictObject({
  /** The Google account the dedicated Chrome profile is signed into. */
  launch_identity: z.email(),
  /** Product used when a command is given no --product. */
  default_product: Slug.nullable(),
  max_items_per_run: z.int().min(1).max(10),
  item_timeout_minutes: z.int().min(3).max(60),
  /** The CLI that runs each submission (src/agents). Every backend gets the same guarded tools. */
  agent: z.enum(["claude", "opencode"]).default("claude"),
  /** The agent's model id (opencode: provider/model); null = that agent's default. */
  model: z.string().nullable(),
});
export type Config = z.infer<typeof ConfigSchema>;

// ---------------------------------------------------------------------------------------------
// Platform playbooks (repo, shared). Facts about the site only: nothing about any one product.
// ---------------------------------------------------------------------------------------------

/** Copy-bank choice lists. The agent may type only these values into a site's search boxes and comboboxes. */
export const CHOICE_KEYS = ["categories", "tags", "pricing_models", "alternatives_to", "platforms", "tech_stack"] as const;

/** A copy-bank value, as strings.<key>, choices.<list> or assets.<key>. */
const CopyBankRef = z.string().regex(new RegExp(`^(?:(?:strings|assets)\\.[a-z0-9_]+|choices\\.(?:${CHOICE_KEYS.join("|")}))$`));

export const PLATFORM_CATEGORIES = ["product-launch", "ai-tools", "software-tools", "b2b-software", "company-profile", "community", "mcp-servers"] as const;

export const PlatformSchema = z.strictObject({
  slug: Slug,
  name: z.string().min(1),
  category: z.enum(PLATFORM_CATEGORIES),
  home_url: z.url(),
  submit_url: z.url().nullable(),
  /** The platform's own hostnames. goto() is confined to these (plus the launch inbox). */
  domains: z.array(Hostname).min(1),
  auth: z.enum(["google", "github", "email_magic_link", "email_code", "password", "none", "unknown"]),
  free_route: z.enum(["yes", "no", "unknown"]),
  badge: z.enum(["required", "optional", "none", "unknown"]),
  /** manual = never auto-submitted (communities, founder-led launches). */
  mode: z.enum(["auto", "manual"]),
  /** Lists open-source projects only: proposed only for a product with a confirmed license and a repo_url. */
  open_source_only: z.boolean().default(false),
  /** Lists MCP servers only: proposed only for a product whose product.yaml confirms it is or ships one (mcp_server). */
  mcp_only: z.boolean().default(false),
  /**
   * Needs the product on its own domain: the site allows one listing per domain, or must show the
   * site itself, so a URL on a shared code host (github.com, ...) is refused. Such a product isn't proposed.
   */
  own_domain: z.boolean().default(false),
  /** Who the site lists and who reads it. Each product rates its own fit in product.yaml. */
  audience: z.string(),
  /**
   * The site's reach, from its Tranco rank (tranco-list.eu): 1 = top 100k, 2 = top 1M, 3 = beyond or
   * unranked. Breaks ties between directories that fit a product equally well; fit handles relevance.
   */
  tier: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  /** Whether a listing's link to the product is followed, as `verify` saw it on a live listing. */
  link: z.enum(["dofollow", "nofollow", "unknown"]).default("unknown"),
  queue_note: z.string().nullable(),
  eligibility: z.array(z.string()),
  /**
   * Copy-bank values the site won't let a listing finish without (e.g. choices.tech_stack for a
   * required "Built with" step). A product whose copy bank lacks one isn't proposed for the site.
   */
  requires: z.array(CopyBankRef).default([]),
  /** How the site's flow works: routes, field quirks, dialogs. Read by the agent before it starts. */
  recipe: z.string().max(4000).nullable(),
  observed_at: IsoDate,
  sources: z.array(z.url()),
});
export type Platform = z.infer<typeof PlatformSchema>;

// ---------------------------------------------------------------------------------------------
// Product settings (workspace): where badges go, and how well each directory fits this product.
// ---------------------------------------------------------------------------------------------

export const FITS = ["strong", "ok", "weak", "none"] as const;

/** How badges:sync writes the badge list: markup to paste or include, data for any framework, or a TS module. */
export const BADGE_FORMATS = ["html", "json", "ts"] as const;
export type BadgeFormat = (typeof BADGE_FORMATS)[number];

export const PlatformSettingsSchema = z.strictObject({
  /** How well the directory fits this product. Missing = unrated, proposed after rated directories. */
  fit: z.enum(FITS).optional(),
  note: z.string().default(""),
  /**
   * The owner's own instructions for this directory ("pick the Marketing category", "use the dark
   * badge"). Shown in the batch, covered by its approval, and read by the agent. Guidance only: the
   * tools' rules still apply, and the agent still can't type anything outside the copy bank.
   */
  instructions: z.string().max(1000).nullable().default(null),
});

export const ProductSchema = z.strictObject({
  product: Slug,
  /**
   * The open-source license of the public repo at the copy bank's repo_url (e.g. MIT), set once the
   * owner has confirmed it. null = not open source: open_source_only directories are never proposed.
   */
  open_source_license: z.string().min(1).nullable().default(null),
  /**
   * true once the owner has confirmed the product is, or ships, an MCP (Model Context Protocol)
   * server. false = mcp_only directories are never proposed.
   */
  mcp_server: z.boolean().default(false),
  badges: z.strictObject({
    enabled: z.boolean(),
    /** File the captured badge list is written to (absolute, or relative to the product dir). null = badges.html in the product dir. */
    output_file: z.string().nullable(),
    /** Output format. null = from output_file's extension (.html/.htm, .json, .ts/.tsx/.js/.mjs), else html. */
    format: z.enum(BADGE_FORMATS).nullable().default(null),
    /** Public page that shows the badges once deployed; runs check it before badge retries. */
    check_url: z.url().nullable(),
  }),
  /** Per-directory fit and instructions. An all-commented list is empty. */
  platforms: z.preprocess((v) => v ?? {}, z.record(Slug, PlatformSettingsSchema)),
});
export type ProductSettings = z.infer<typeof ProductSchema>;

// ---------------------------------------------------------------------------------------------
// Copy bank: the only free text the agent may put into a form. Approved as part of a batch.
// ---------------------------------------------------------------------------------------------

const Variant = z.string().min(1);

export const CopyBankSchema = z.strictObject({
  product: Slug,
  /** Each key holds one or more variants; fill() picks the longest variant that fits the field. */
  strings: z.record(z.string().regex(/^[a-z0-9_]+$/), z.array(Variant).min(1)),
  /** Values the agent may pick from a site's own options or type into a search/combobox. */
  choices: z.strictObject({
    categories: z.array(z.string()).min(1),
    tags: z.array(z.string()),
    pricing_models: z.array(z.string()).min(1),
    alternatives_to: z.array(z.string()),
    platforms: z.array(z.string()),
    /** Languages, frameworks and services it is built with, for "Built with" / technology fields. */
    tech_stack: z.array(z.string()).default([]),
  }),
  /** Asset key -> path relative to the product directory. */
  assets: z.record(z.string().regex(/^[a-z0-9_]+$/), z.string()),
});
export type CopyBank = z.infer<typeof CopyBankSchema>;

// ---------------------------------------------------------------------------------------------
// Batches: the up-front approval. Nothing is submitted outside an approved batch.
// ---------------------------------------------------------------------------------------------

export const BatchItemSchema = z.strictObject({
  platform: Slug,
  submit_url: z.url().nullable(),
  auth: PlatformSchema.shape.auth,
  badge: PlatformSchema.shape.badge,
  expected: z.string(),
  risks: z.array(z.string()),
});

export const BatchSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9-]+$/),
  product: Slug,
  status: z.enum(["proposed", "approved", "closed"]),
  created_at: IsoDateTime,
  approved_at: IsoDateTime.nullable(),
  approved_by: z.string().nullable(),
  /** Hash of the copy bank + assets at approval. A later edit invalidates the approval. */
  approval_fingerprint: z.string().nullable(),
  grants: z.strictObject({
    sign_in_with_google: z.boolean(),
    accept_platform_terms: z.boolean(),
    add_badge_to_footer: z.boolean(),
    open_verification_emails: z.boolean(),
  }),
  items: z.array(BatchItemSchema).min(1),
}).refine((b) => b.status === "proposed" || (b.approved_at && b.approved_by && b.approval_fingerprint), {
  message: "an approved or closed batch must carry approved_at, approved_by and approval_fingerprint",
});
export type Batch = z.infer<typeof BatchSchema>;

// ---------------------------------------------------------------------------------------------
// Tracker: one record per product x platform. States mirror what the platform showed us.
// ---------------------------------------------------------------------------------------------

export const STATES = [
  "planned",
  "prepared_needs_human",   // a precise owner action blocks prepared work (CAPTCHA, password, unknown field)
  "waiting_badge",          // submission needs our badge live on the site before it will accept
  "submitted_pending_review",
  "queued",
  "scheduled",
  "live",                   // public URL observed; verify re-checks it logged out
  "already_listed",
  "blocked",
  "deferred_paid",          // only a paid route exists; nothing was bought
  "not_a_fit",
  "unavailable",
] as const;
export const StateSchema = z.enum(STATES);
export type State = z.infer<typeof StateSchema>;

/** States the runner will not retry. */
export const TERMINAL_STATES: ReadonlySet<State> = new Set([
  "submitted_pending_review", "queued", "scheduled", "live", "already_listed", "deferred_paid", "not_a_fit",
]);

/** States that count as a new confirmed submission. */
export const CONFIRMED_STATES: ReadonlySet<State> = new Set(["submitted_pending_review", "queued", "scheduled", "live"]);

export const BadgeSchema = z.strictObject({
  platform: Slug,
  href: z.url(),
  img_src: z.url(),
  alt: z.string(),
  width: z.int().positive().nullable(),
  height: z.int().positive().nullable(),
  captured_at: IsoDateTime,
  source_url: z.url(),
});
export type Badge = z.infer<typeof BadgeSchema>;

export const EvidenceSchema = z.strictObject({
  at: IsoDateTime,
  url: z.string(),
  note: z.string(),
  screenshot: z.string().nullable(),
});

export const TrackerRecordSchema = z.strictObject({
  platform: Slug,
  state: StateSchema,
  batch_id: z.string().nullable(),
  updated_at: IsoDateTime,
  public_url: z.url().nullable(),
  verified_live_at: IsoDateTime.nullable(),
  note: z.string(),
  needs_human: z.string().nullable(),
  /** Lessons about this product on this site (its listing id, chosen categories). Site-wide lessons go to site notes. */
  notes: z.string().max(4000).nullable().default(null),
  attempts: z.int().min(0),
  badge: BadgeSchema.nullable(),
  /** What `verify` saw on the live listing: a followed link to us, and whether the page may be indexed. */
  link: z.strictObject({
    follow: z.boolean(),
    indexable: z.boolean(),
    checked_at: IsoDateTime,
  }).nullable().default(null),
  evidence: z.array(EvidenceSchema),
});
export type TrackerRecord = z.infer<typeof TrackerRecordSchema>;

export const TrackerSchema = z.strictObject({
  product: Slug,
  records: z.record(Slug, TrackerRecordSchema),
});
export type Tracker = z.infer<typeof TrackerSchema>;
