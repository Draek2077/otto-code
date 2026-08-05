import * as React from "react";
import {
  motion,
  AnimatePresence,
  useInView,
  useScroll,
  useTransform,
  type Transition,
} from "framer-motion";

// Shared motion presets, hoisted so every JSX site receives the same object
// reference and doesn't trigger jsx-no-new-object-as-prop.
const FADE_IN_UP = { opacity: 0, y: 20 };
const FADE_IN = { opacity: 1, y: 0 };
const FADE_IN_UP_TINY = { opacity: 0, y: -10 };
const FADE_IN_UP_XL = { opacity: 0, y: 30 };
const FADE_IN_UP_40 = { opacity: 0, y: 40 };
const FADE_IN_UP_4 = { opacity: 0, y: 4 };
const FADE_OUT_UP_4 = { opacity: 0, y: 4 };

const EASE_OUT_06_DELAY_01: Transition = { duration: 0.6, delay: 0.1, ease: "easeOut" };
const EASE_OUT_08_DELAY_05: Transition = { duration: 0.8, delay: 0.5, ease: "easeOut" };
const EASE_OUT_05: Transition = { duration: 0.5, ease: "easeOut" };
const EASE_OUT_015: Transition = { duration: 0.15, ease: "easeOut" };
const DURATION_05: Transition = { duration: 0.5 };

const VIEWPORT_60 = { once: true, margin: "-60px" };

const SVG_OVERFLOW_VISIBLE_STYLE = { overflow: "visible" as const };
const PHONE_PERSPECTIVE_STYLE = { minHeight: 480, perspective: 1200 };
import { CursorFieldProvider } from "~/components/butterfly";
import { CommandDialog } from "~/components/command-dialog";
import { AGENT_PAGES } from "~/data/agent-pages";
import {
  webAppUrl,
  getDownloadOptions,
  useDetectedPlatform,
  TerminalIcon,
  GlobeIcon,
} from "~/downloads";
import { useRelease } from "~/routes/__root";
import { HeroMockup } from "~/components/hero-mockup";
import { FeatureShot, ShotRow } from "~/components/feature-shot";
import { ClaudeIcon } from "~/components/mockup";
import { FAQItem } from "~/components/faq-item";
import { SiteFooter } from "~/components/site-footer";
import { SiteHeader } from "~/components/site-header";
import "~/styles.css";

interface LandingPageProps {
  title: React.ReactNode;
  /**
   * A plain string gets the standard hero paragraph treatment (the agent pages
   * pass one). Pass nodes only when the hero needs more than one paragraph.
   */
  subtitle: React.ReactNode;
}

export function LandingPage({ title, subtitle }: LandingPageProps) {
  return (
    <CursorFieldProvider>
      {/* Hero section with background image */}
      <div className="relative bg-cover bg-center bg-no-repeat">
        <div className="relative p-6 pb-10 md:px-32 md:pt-20 md:pb-12 max-w-7xl mx-auto">
          <Nav />
          <Hero title={title} subtitle={subtitle} />
          <GetStarted />
        </div>

        {/* Mockup - inside hero so it's above the gradient, positioned to overflow into black section */}
        <motion.div
          initial={FADE_IN_UP_40}
          animate={FADE_IN}
          transition={EASE_OUT_08_DELAY_05}
          className="relative px-6 md:px-8 pb-8 md:pb-16"
        >
          <div className="max-w-7xl mx-auto">
            <HeroVisual />
          </div>
        </motion.div>
      </div>

      {/* Phone showcase */}
      <PhoneShowcase />

      {/* Content section. Order and grouping: see
          projects/marketing-strategy/website-showcase.md */}
      <div className="bg-background">
        <main className="p-6 md:p-20 md:pt-40 max-w-5xl mx-auto">
          <div className="space-y-24">
            <VisualizerSection />
            <PreviewVerificationSection />
            <AgentTeamSection />
            <AutonomousWorkSection />
            <CodeIdeSection />
            <InterfaceSection />
            <CostSection />
            <ShipSection />
            <BringAnyModelSection />
            <OttoBrainSection />
            <VoiceSection />
            <BuiltOnPaseoSection />
            <FAQ />
            <OttoCreditCTA />
          </div>
        </main>
        <SiteFooter />
      </div>
    </CursorFieldProvider>
  );
}

/**
 * The hero is a looping capture of the real app mid-turn: spinner spinning,
 * tokens streaming. Not a still. Until `hero-desktop` is captured, the old
 * hand-built replica keeps rendering. Flip this to false the moment the asset
 * lands, then delete hero-mockup.tsx.
 */
const HERO_USE_MOCKUP = true;

function HeroVisual() {
  if (HERO_USE_MOCKUP) return <HeroMockup />;
  return (
    <FeatureShot
      id="hero-desktop"
      kind="loop"
      ratio="16/9"
      chrome
      scenario="00-website-hero"
      alt="Otto running an agent across a chat pane and a live diff"
      spec="The whole app mid-turn: both staged repos in the sidebar, a real streaming reply with a named personality, and a second pane showing colour, either the diff or the browser."
    />
  );
}

function Nav() {
  return (
    <nav className="mb-16">
      <SiteHeader />
    </nav>
  );
}

function Hero({ title, subtitle }: { title: React.ReactNode; subtitle: React.ReactNode }) {
  return (
    <div className="space-y-6">
      <h1 className="text-3xl md:text-5xl font-medium tracking-tight">{title}</h1>
      {typeof subtitle === "string" ? (
        <p className="text-white/70 text-lg leading-relaxed max-w-lg">{subtitle}</p>
      ) : (
        <div className="space-y-4 max-w-lg">{subtitle}</div>
      )}
    </div>
  );
}

const CLAUDE_CODE_BADGE_ICON = <ClaudeCodeIcon className="h-6 w-6" />;
const CODEX_BADGE_ICON = <CodexIcon className="h-6 w-6" />;
const OPENCODE_BADGE_ICON = <OpenCodeIcon className="h-6 w-6" />;
const PI_BADGE_ICON = <PiIcon className="h-6 w-6" />;
const CURSOR_BADGE_ICON = <CursorIcon className="h-6 w-6" />;

const FEATURED_AGENT_COUNT = 5;
const ADDITIONAL_AGENT_COUNT = AGENT_PAGES.length - FEATURED_AGENT_COUNT;

function AgentBadge({ name, icon }: { name: string; icon: React.ReactNode }) {
  const [hovered, setHovered] = React.useState(false);
  const handleMouseEnter = React.useCallback(() => setHovered(true), []);
  const handleMouseLeave = React.useCallback(() => setHovered(false), []);

  return (
    <span
      className="relative inline-flex items-center justify-center rounded-full p-1.5 text-white/60"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {icon}
      <AnimatePresence>
        {hovered && (
          <motion.span
            initial={FADE_IN_UP_4}
            animate={FADE_IN}
            exit={FADE_OUT_UP_4}
            transition={EASE_OUT_015}
            className="absolute -top-8 left-1/2 -translate-x-1/2 px-2 py-1 rounded bg-white text-black text-xs whitespace-nowrap pointer-events-none"
          >
            {name}
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
}

function FeatureSection({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <motion.section
      initial={FADE_IN_UP}
      whileInView={FADE_IN}
      viewport={VIEWPORT_60}
      transition={EASE_OUT_05}
    >
      <SectionTitle title={title} description={description} />
      {children}
    </motion.section>
  );
}

function SectionTitle({ title, description }: { title: string; description: string }) {
  return (
    <div className="mb-12 space-y-2">
      <h2 className="text-3xl font-medium">{title}</h2>
      <p className="text-base text-muted-foreground max-w-lg">{description}</p>
    </div>
  );
}

const UPSTREAM_PILLARS = [
  {
    title: "From Paseo, by Mo",
    items: [
      "Multi-provider agent orchestration",
      "Self-hosted daemon, your machines",
      "Mobile, desktop, web, and CLI clients",
      "E2E encrypted relay for remote access",
    ],
  },
  {
    title: "From Agent Flow, by Simon Patole",
    items: [
      "The live orchestration graph render layer",
      "Agent, subagent, and tool-call nodes",
      "Timeline scrubbing and file-attention heat",
      "A bridge protocol clean enough to re-feed",
    ],
  },
  {
    title: "The Otto mission",
    items: [
      "Frontier-model tooling for every provider",
      "In-browser preview verification for agents",
      "Real per-subagent token and cost accounting",
      "Named agent personalities, spawnable by role",
      "Local models via OpenAI Compatible providers",
      "A familiar, refined UI that never boxes you in",
    ],
  },
] as const;

function BuiltOnPaseoSection() {
  return (
    <motion.section
      initial={FADE_IN_UP}
      whileInView={FADE_IN}
      viewport={VIEWPORT_60}
      transition={EASE_OUT_05}
    >
      <SectionTitle
        title="Built on Paseo"
        description="Everything above stands on a foundation someone else got right first. Multi-provider agent orchestration, a self-hosted daemon, real clients on every platform, split panes, worktrees, the CLI. That is Paseo, and Otto keeps all of it intact."
      />

      <div className="space-y-4">
        <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Otto is built on{" "}
          <a
            href="https://github.com/getpaseo/paseo"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-white/80"
          >
            Paseo
          </a>
          , the self-hosted daemon by{" "}
          <a
            href="https://github.com/boudra"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-white/80"
          >
            Mo
          </a>
          . That gives us the plumbing: process lifecycle, WebSocket protocol, cross-platform
          clients. So we ship features instead of infrastructure. Paseo stays intact, upstream
          history preserved.
        </p>
        <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
          The Visualizer is the render layer of{" "}
          <a
            href="https://github.com/patoles/agent-flow"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-white/80"
          >
            Agent Flow
          </a>{" "}
          (Apache-2.0) by{" "}
          <a
            href="https://github.com/patoles"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-white/80"
          >
            Simon Patole
          </a>
          . The renderer is cleanly separated from event collection and talks to a small documented
          bridge. So Otto feeds it its own provider-neutral stream and the graph lights up for every
          provider on day one: Claude, Codex, OpenCode, local models. If the graph is the part you
          like, go star Agent Flow too.
        </p>
        <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Otto is a personal project by Philippe, not a startup. Most of it is written by the agents
          it runs. The problem I keep hitting is that agents can now do a lot of work on their own,
          and it&apos;s hard to see what they did, what it cost, and where it went sideways. So the
          work leans toward legibility: real per-subagent token and cost accounting, the
          orchestration graph, and browser-verified previews so an agent proves a change instead of
          claiming it. All credit for the foundations belongs to the people who wrote them.
        </p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {UPSTREAM_PILLARS.map((pillar) => (
            <div
              key={pillar.title}
              className="rounded-2xl border border-white/10 bg-white/[0.02] p-5"
            >
              <p className="mb-3 text-sm font-medium text-white/80">{pillar.title}</p>
              <ul className="space-y-2">
                {pillar.items.map((item) => (
                  <li key={item} className="flex items-start gap-2 text-sm text-white/60">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400/70" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="space-y-12 pt-6">
          <SplitPanesBlock />
          <MultiProviderBlock />
          <SelfHostedBlock />
          <ServiceProxyBlock />
          <ShortcutsBlock />
          <CLIBlock />
        </div>
      </div>
    </motion.section>
  );
}

/** A named block inside a section, one level below SectionTitle. */
function SubFeature({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-5">
      <div className="space-y-1.5">
        <h3 className="text-xl font-medium text-white/90">{title}</h3>
        <p className="max-w-lg text-sm text-muted-foreground">{description}</p>
      </div>
      {children}
    </div>
  );
}

function SplitPanesBlock() {
  return (
    <SubFeature
      title="Split panels"
      description="Open agents, browsers, terminals, diffs, and logs in the same workspace. Split them side by side or group them in tabs."
    >
      <FeatureShot
        id="otto-panes"
        kind="focus"
        ratio="16/9"
        scenario="15-workspace-layouts"
        alt="One Otto workspace split into an agent chat, a browser pane, a terminal and a diff"
        spec="A real four-pane workspace (agent, browser, terminal, diff), each pane with genuine content, tab rows visible."
      />
    </SubFeature>
  );
}

const LIGHT_THEMES = ["Daylight", "Sherbet", "Meadow", "Terracotta", "Horizon", "Powder"] as const;
const DARK_THEMES = [
  "Twilight",
  "Evergreen",
  "Graphite",
  "Nightfall",
  "Ember",
  "Slate",
  "Neotokyo",
] as const;

const CUSTOMIZATION_OPTIONS = [
  "UI and monospace fonts",
  "Interface and code text sizes",
  "Syntax highlighting themes",
  "Chat column width",
  "Light / dark / adaptive mode",
] as const;

function ThemeChip({ name, dark }: { name: string; dark: boolean }) {
  return (
    <span
      className={`rounded-full border px-3 py-1 text-xs ${
        dark
          ? "border-white/10 bg-white/[0.04] text-white/70"
          : "border-white/15 bg-white/[0.9] text-black/70"
      }`}
    >
      {name}
    </span>
  );
}

function ThemesBlock() {
  return (
    <SubFeature
      title="Made yours"
      description="Cleaner surfaces and refined spacing on top of Otto, then the dials: a full set of light and dark themes, and the details tuned until it feels like your environment."
    >
      <FeatureShot
        id="ui-themes"
        kind="focus"
        ratio="16/9"
        scenario="12-themes"
        alt="The same Otto workspace rendered in three different themes"
        spec="Triptych: one identical workspace in three themes (Twilight, Daylight, Neotokyo), same scroll position in each so the comparison reads instantly."
      />
      <div className="space-y-6 rounded-2xl border border-white/10 bg-white/[0.02] p-5">
        <div className="space-y-3">
          <p className="text-sm font-medium text-white/80">Themes</p>
          <div className="flex flex-wrap gap-2">
            {DARK_THEMES.map((name) => (
              <ThemeChip key={name} name={name} dark />
            ))}
            {LIGHT_THEMES.map((name) => (
              <ThemeChip key={name} name={name} dark={false} />
            ))}
          </div>
        </div>
        <div className="space-y-3">
          <p className="text-sm font-medium text-white/80">Tune everything else</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {CUSTOMIZATION_OPTIONS.map((option) => (
              <div key={option} className="flex items-start gap-2 text-sm text-white/60">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400/70" />
                {option}
              </div>
            ))}
          </div>
        </div>
      </div>
    </SubFeature>
  );
}

function MultiProviderBlock() {
  const providers = [
    { name: "Claude Code", icon: <ClaudeIcon size={28} /> },
    { name: "Codex", icon: <CodexIcon className="w-7 h-7" /> },
    { name: "OpenCode", icon: <OpenCodeIcon className="w-7 h-7" /> },
    { name: "Pi", icon: <PiIcon className="w-7 h-7" /> },
    { name: "Cursor", icon: <CursorIcon className="w-7 h-7" /> },
  ];

  return (
    <SubFeature
      title="Works with your tools"
      description="Run your agents from one interface. Otto uses each provider's native harness, so your subscriptions, skills, config, and MCP servers keep working."
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {providers.map((p) => (
          <div
            key={p.name}
            className="flex items-center justify-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-5 py-4"
          >
            <span className="text-white/80">{p.icon}</span>
            <span className="font-medium">{p.name}</span>
          </div>
        ))}
        <a
          href="/agents"
          className="flex items-center justify-center gap-3 rounded-xl border border-dashed border-white/10 bg-white/[0.01] px-5 py-4 text-white/50 hover:text-white/80 hover:border-white/20 hover:bg-white/[0.03] transition-colors"
        >
          <span className="font-medium">+{ADDITIONAL_AGENT_COUNT} more</span>
        </a>
      </div>
    </SubFeature>
  );
}

const OPENAI_COMPATIBLE_ENDPOINTS = [
  "LM Studio",
  "Ollama",
  "vLLM",
  "Z.AI",
  "Alibaba Qwen",
  "Any OpenAI-compatible API",
] as const;

function BringAnyModelSection() {
  return (
    <FeatureSection
      title="Bring any model"
      description="Point Otto at any OpenAI-compatible endpoint and it becomes a first-class agent provider, with the same frontier-level tooling as the built-in ones: coding tools, browser-verified previews, MCP servers, context compaction, and rich permission modes. Run models locally or on your own server; your prompts never have to leave your network."
    >
      <div className="space-y-4">
        <FeatureShot
          id="model-local-verify"
          kind="loop"
          ratio="16/9"
          chrome
          scenario="02-preview-verify, DEMO_PROVIDER=local-ai"
          alt="A local model running Otto's browser verification loop end to end"
          spec="The same verification loop as the Preview section, driven by a model served from LM Studio. The model badge must be legible. This is the proof that none of it is Claude-only."
        />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {OPENAI_COMPATIBLE_ENDPOINTS.map((name) => (
            <div
              key={name}
              className="flex items-center justify-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-5 py-4"
            >
              <span className="font-medium">{name}</span>
            </div>
          ))}
        </div>
        <FeatureShot
          id="model-local"
          kind="focus"
          ratio="16/10"
          scenario="17-multi-provider"
          alt="Otto's provider settings with a local endpoint configured"
          spec="Provider settings with a local endpoint filled in and its model list loaded. Connection and Models tabs visible, no empty fields."
        />
      </div>
    </FeatureSection>
  );
}

// Starter team of agent personalities. Each carries two "spinner" glow colors
// (the app tints a running agent's identity with them), represented here as a
// gradient orb. Style objects live at module scope so JSX passes a stable
// reference (jsx-no-new-object-as-prop).
const PERSONALITY_TEAM = [
  {
    name: "Atlas",
    model: "Claude · Opus",
    roles: ["Orchestrator", "Chatter"],
    orbStyle: { background: "linear-gradient(135deg, #4f46e5, #f59e0b)" },
  },
  {
    name: "Sage",
    model: "Claude · Opus",
    roles: ["Advisor"],
    orbStyle: { background: "linear-gradient(135deg, #14b8a6, #8b5cf6)" },
  },
  {
    name: "Vera",
    model: "Claude · Sonnet",
    roles: ["Judger"],
    orbStyle: { background: "linear-gradient(135deg, #f43f5e, #fbbf24)" },
  },
  {
    name: "Pixel",
    model: "Claude · Sonnet",
    roles: ["Artificer"],
    orbStyle: { background: "linear-gradient(135deg, #ec4899, #06b6d4)" },
  },
  {
    name: "Dash",
    model: "Claude · Haiku",
    roles: ["Worker", "Scheduler"],
    orbStyle: { background: "linear-gradient(135deg, #22c55e, #a3e635)" },
  },
  {
    name: "Sprocket",
    model: "Claude · Sonnet",
    roles: ["Chatter", "Worker"],
    orbStyle: { background: "linear-gradient(135deg, #64748b, #38bdf8)" },
  },
] as const;

function PersonalityCard({
  name,
  model,
  roles,
  orbStyle,
}: {
  name: string;
  model: string;
  roles: readonly string[];
  orbStyle: React.CSSProperties;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
      <span className="h-8 w-8 shrink-0 rounded-full ring-2 ring-white/10" style={orbStyle} />
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex items-baseline justify-between gap-2">
          <span className="font-medium text-white/90">{name}</span>
          <span className="truncate text-xs text-white/35">{model}</span>
        </div>
        <div className="flex flex-wrap gap-1">
          {roles.map((role) => (
            <span
              key={role}
              className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] text-white/55"
            >
              {role}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function AgentTeamSection() {
  return (
    <FeatureSection
      title="A team of agents, by name"
      description="Save a provider, model, effort, permission mode, and prompt as a named personality with one or more roles. Pick one at the top of any model picker, or let an orchestrator spawn a whole team by role: a Worker to build, a Judger to review, an Advisor for a second opinion. Each gets its own color and voice, on a frontier API or a local model alike. They remember what they learn, and you can read, edit and transfer those lessons."
    >
      <div className="space-y-4">
        <FeatureShot
          id="team-runs"
          kind="focus"
          ratio="16/9"
          chrome
          scenario="23-orchestration-runs"
          alt="The Runs view following a multi-phase orchestration across several agents"
          spec="A multi-phase run in flight: phases listed, one active, several named personalities working under it with their own colours."
        />
        <ShotRow cols={3}>
          <FeatureShot
            id="team-roster"
            kind="focus"
            ratio="4/3"
            scenario="04-personalities"
            alt="The personality roster with roles and colors"
            spec="The roster, fully populated, each row showing role chips and its spinner colour."
          />
          <FeatureShot
            id="team-switcher"
            kind="focus"
            ratio="4/3"
            scenario="05-agent-teams"
            alt="Switching the active agent team from the sidebar"
            spec="The team switcher open in the sidebar, two teams present, one active."
          />
          <FeatureShot
            id="team-memory"
            kind="focus"
            ratio="4/3"
            scenario="23-orchestration-runs"
            alt="A personality's accrued lessons"
            spec="The personality memory panel with several real accrued lessons. The sci-fi-sounding feature that actually works."
          />
        </ShotRow>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {PERSONALITY_TEAM.map((p) => (
            <PersonalityCard
              key={p.name}
              name={p.name}
              model={p.model}
              roles={p.roles}
              orbStyle={p.orbStyle}
            />
          ))}
        </div>
      </div>
    </FeatureSection>
  );
}

// Generic UI icons: Material Symbols (outlined family), matching the app's icon
// set (docs/ui-icons.md). Brand/provider logos below keep their own marks.
function MaterialGlyph({ path, ...props }: { path: string } & React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 -960 960 960"
      fill="currentColor"
      aria-hidden="true"
      {...props}
    >
      <path d={path} />
    </svg>
  );
}

const MONITOR_PATH =
  "M260-120v-73l47-47H140q-24 0-42-18t-18-42v-480q0-24 18-42t42-18h680q24 0 42 18t18 42v480q0 24-18 42t-42 18H652l48 47v73H260ZM140-300h680v-480H140v480Zm0 0v-480 480Z";
const GLOBE_PATH =
  "M480.27-80q-82.74 0-155.5-31.5Q252-143 197.5-197.5t-86-127.34Q80-397.68 80-480.5t31.5-155.66Q143-709 197.5-763t127.34-85.5Q397.68-880 480.5-880t155.66 31.5Q709-817 763-763t85.5 127Q880-563 880-480.27q0 82.74-31.5 155.5Q817-252 763-197.68q-54 54.31-127 86Q563-80 480.27-80Zm-.27-60q142.38 0 241.19-99.5T820-480v-13q-6 26-27.41 43.5Q771.19-432 742-432h-80q-33 0-56.5-23.5T582-512v-40H422v-80q0-33 23.5-56.5T502-712h40v-22q0-16 13.5-40t30.5-29q-25-8-51.36-12.5Q508.29-820 480-820q-141 0-240.5 98.81T140-480h150q66 0 113 47t47 113v40H330v105q34 17 71.7 26t78.3 9Z";
const MOBILE_PATH =
  "M260-40q-24.75 0-42.37-17.63Q200-75.25 200-100v-760q0-24 18-42t42-18h438q24.75 0 42.38 17.62Q758-884.75 758-860v150q18 3 30 16.95 12 13.96 12 31.63V-587q0 19-12 33t-30 17v437q0 24.75-17.62 42.37Q722.75-40 698-40H260Zm0-60h438v-760H260v760Zm0 0v-760 760Zm240-629q9-9 9-21t-9-21q-9-9-21-9t-21 9q-9 9-9 21t9 21q9 9 21 9t21-9Z";
const SERVER_PATH =
  "M286.88-717q-20.88 0-35.38 14.62-14.5 14.62-14.5 35.5 0 20.88 14.62 35.38 14.62 14.5 35.5 14.5 20.88 0 35.38-14.62 14.5-14.62 14.5-35.5 0-20.88-14.62-35.38-14.62-14.5-35.5-14.5Zm0 414q-20.88 0-35.38 14.62-14.5 14.62-14.5 35.5 0 20.88 14.62 35.38 14.62 14.5 35.5 14.5 20.88 0 35.38-14.62 14.5-14.62 14.5-35.5 0-20.88-14.62-35.38-14.62-14.5-35.5-14.5ZM154-839h651q16 0 25.5 9.5t9.5 25.81V-535q0 17.42-9.5 29.21T805-494H154q-15 0-24.5-11.79T120-535v-268.69q0-16.31 9.5-25.81T154-839Zm26 60v225h600v-225H180Zm-26 353h647q15 0 27 12.5t12 28.53V-121q0 20-12 30.5T801-80H159q-16 0-27.5-10.5T120-121v-263.97q0-16.03 9.5-28.53T154-426Zm26 60v226h600v-226H180Zm0-413v225-225Zm0 413v226-226Z";
const FOLDER_PATH =
  "M140-160q-24 0-42-18.5T80-220v-520q0-23 18-41.5t42-18.5h281l60 60h339q23 0 41.5 18.5T880-680v460q0 23-18.5 41.5T820-160H140Zm0-60h680v-460H456l-60-60H140v520Zm0 0v-520 520Z";
const ARROW_DOWN_PATH = "M450-800v526L202-522l-42 42 320 320 320-320-42-42-248 248v-526h-60Z";
const ARROW_FORWARD_PATH = "M686-450H160v-60h526L438-758l42-42 320 320-320 320-42-42 248-248Z";
const COPY_PATH =
  "M300-200q-24 0-42-18t-18-42v-560q0-24 18-42t42-18h440q24 0 42 18t18 42v560q0 24-18 42t-42 18H300Zm0-60h440v-560H300v560ZM180-80q-24 0-42-18t-18-42v-620h60v620h500v60H180Zm120-180v-560 560Z";
const CHECK_PATH = "M378-246 154-470l43-43 181 181 384-384 43 43-427 427Z";
const TERMINAL_PATH =
  "M140-160q-24 0-42-18t-18-42v-520q0-24 18-42t42-18h680q24 0 42 18t18 42v520q0 24-18 42t-42 18H140Zm0-60h680v-436H140v436Zm160-72-42-42 103-104-104-104 43-42 146 146-146 146Zm190 4v-60h220v60H490Z";

function ServerIcon(props: React.SVGProps<SVGSVGElement>) {
  return <MaterialGlyph path={SERVER_PATH} {...props} />;
}

function SelfHostedDiagram() {
  const clients = [
    { name: "Desktop", icon: <MaterialGlyph path={MONITOR_PATH} width={28} height={28} /> },
    { name: "Web", icon: <MaterialGlyph path={GLOBE_PATH} width={28} height={28} /> },
    { name: "Mobile", icon: <MaterialGlyph path={MOBILE_PATH} width={28} height={28} /> },
    { name: "CLI", icon: <MaterialGlyph path={TERMINAL_PATH} width={28} height={28} /> },
  ];
  const hosts = ["MacBook Pro", "Hetzner VM", "Dev server"];
  const containerRef = React.useRef<HTMLDivElement>(null);
  const clientRefs = React.useRef<(HTMLDivElement | null)[]>([]);
  const hostRefs = React.useRef<(HTMLDivElement | null)[]>([]);
  const centerRef = React.useRef<HTMLDivElement>(null);

  const setClientRef = React.useCallback(
    (index: number) => (el: HTMLDivElement | null) => {
      clientRefs.current[index] = el;
    },
    [],
  );
  const setHostRef = React.useCallback(
    (index: number) => (el: HTMLDivElement | null) => {
      hostRefs.current[index] = el;
    },
    [],
  );
  const [paths, setPaths] = React.useState<{ left: string[]; right: string[] }>({
    left: [],
    right: [],
  });

  React.useEffect(() => {
    function computePaths() {
      const container = containerRef.current;
      const center = centerRef.current;
      if (!container || !center) return;

      const cRect = container.getBoundingClientRect();
      const mRect = center.getBoundingClientRect();
      const midL = mRect.left - cRect.left;
      const midR = mRect.right - cRect.left;
      const midY = mRect.top - cRect.top + mRect.height / 2;

      const left = clientRefs.current.map((el) => {
        if (!el) return "";
        const r = el.getBoundingClientRect();
        const x1 = r.right - cRect.left;
        const y1 = r.top - cRect.top + r.height / 2;
        const cpx = x1 + (midL - x1) * 0.6;
        return `M${x1},${y1} C${cpx},${y1} ${midL - (midL - x1) * 0.3},${midY} ${midL},${midY}`;
      });

      const right = hostRefs.current.map((el) => {
        if (!el) return "";
        const r = el.getBoundingClientRect();
        const x2 = r.left - cRect.left;
        const y2 = r.top - cRect.top + r.height / 2;
        const cpx = midR + (x2 - midR) * 0.4;
        return `M${midR},${midY} C${cpx},${midY} ${x2 - (x2 - midR) * 0.3},${y2} ${x2},${y2}`;
      });

      setPaths({ left, right });
    }

    computePaths();
    window.addEventListener("resize", computePaths);
    return () => window.removeEventListener("resize", computePaths);
  }, []);

  return (
    <>
      {/* Mobile: vertical stack */}
      <div className="md:hidden flex flex-col items-center gap-4 py-4">
        <div className="space-y-2 w-full">
          {clients.map((c) => (
            <div
              key={c.name}
              className="flex items-center justify-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-5 py-4"
            >
              <span className="text-white/80">{c.icon}</span>
              <span className="font-medium">{c.name}</span>
            </div>
          ))}
        </div>
        <div className="w-px h-6 border-l border-dashed border-white/25" />
        <div className="rounded-xl border border-white/10 bg-white/[0.03] px-6 py-5 text-center space-y-1">
          <p className="text-xs font-medium text-white/50">E2E Encrypted Relay</p>
          <p className="text-[10px] text-white/25">or</p>
          <p className="text-xs font-medium text-white/50">Direct Connection</p>
        </div>
        <div className="w-px h-6 border-l border-dashed border-white/25" />
        <div className="space-y-2 w-full">
          {hosts.map((h) => (
            <div
              key={h}
              className="flex items-center justify-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-5 py-4"
            >
              <span className="text-white/80">
                <ServerIcon width={28} height={28} />
              </span>
              <span className="font-medium">{h}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Desktop: horizontal with bezier curves */}
      <div ref={containerRef} className="relative hidden md:flex items-center py-4 gap-0">
        {/* SVG curves */}
        <svg
          className="absolute inset-0 w-full h-full pointer-events-none"
          style={SVG_OVERFLOW_VISIBLE_STYLE}
        >
          {[...paths.left, ...paths.right].map(
            (d) =>
              d && (
                <path
                  key={d}
                  d={d}
                  fill="none"
                  stroke="rgba(255,255,255,0.25)"
                  strokeWidth="1"
                  strokeDasharray="4 4"
                />
              ),
          )}
        </svg>

        {/* Clients */}
        <div className="space-y-3 flex-shrink-0 relative z-10">
          {clients.map((c, i) => (
            <div
              key={c.name}
              ref={setClientRef(i)}
              className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-5 py-4 backdrop-blur-sm"
            >
              <span className="text-white/80">{c.icon}</span>
              <span className="font-medium">{c.name}</span>
            </div>
          ))}
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Center label */}
        <div
          ref={centerRef}
          className="flex-shrink-0 rounded-xl border border-white/10 bg-white/[0.03] px-8 py-6 text-center space-y-1.5 relative z-10 backdrop-blur-sm"
        >
          <p className="text-sm font-medium text-white/50">E2E Encrypted Relay</p>
          <p className="text-xs text-white/25">or</p>
          <p className="text-sm font-medium text-white/50">Direct Connection</p>
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Hosts */}
        <div className="space-y-3 flex-shrink-0 relative z-10">
          {hosts.map((h, i) => (
            <div
              key={h}
              ref={setHostRef(i)}
              className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-5 py-4 backdrop-blur-sm"
            >
              <span className="text-white/80">
                <ServerIcon width={28} height={28} />
              </span>
              <span className="font-medium">{h}</span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

function SelfHostedBlock() {
  return (
    <SubFeature
      title="Runs where you work"
      description="Start agents on your laptop, a VM, or a dev server. Use them from any device over a direct connection or the end-to-end encrypted relay."
    >
      <SelfHostedDiagram />
    </SubFeature>
  );
}

function ShipSection() {
  return (
    <FeatureSection
      title="Review, preview, ship"
      description="Review the diff against the right base, commit the files you choose with a message written by a Writer personality, then open a PR and merge, without leaving Otto. Investigate any file through git while you are at it: what changed, when, and who wrote each line."
    >
      <div className="space-y-4">
        <FeatureShot
          id="ship-diff"
          kind="focus"
          ratio="16/9"
          chrome
          scenario="03-diff-review"
          alt="The Changes view showing a real diff across several files"
          spec="Changes view with the staged repo's uncommitted work: several files, real additions and deletions, the file list and the diff body both in frame."
        />
        <ShotRow cols={3}>
          <FeatureShot
            id="ship-commit"
            kind="focus"
            ratio="4/3"
            scenario="10-diff-ai-review"
            alt="Committing selected files with an AI-written message"
            spec="The commit sheet with files checked and a generated message filled in. Never an empty form."
          />
          <FeatureShot
            id="ship-blame"
            kind="focus"
            ratio="4/3"
            scenario="25-git-history"
            alt="Blame gutter showing who last wrote each line"
            spec="A file open with the blame gutter populated, with plausible authors and dates from the staged history."
          />
          <FeatureShot
            id="ship-worktree"
            kind="focus"
            ratio="4/3"
            scenario="18-worktrees"
            alt="Archiving a worktree with its branch cleanup prompt"
            spec="The archive prompt stating whether the branch is fully merged and how many commits deleting would discard."
          />
        </ShotRow>
      </div>
    </FeatureSection>
  );
}

function AutonomousWorkSection() {
  return (
    <FeatureSection
      title="Work that runs without you"
      description="Agents generate shareable artifacts, run on a cron schedule, take on background tasks you can monitor or stop from the chat, and offer follow-up work as chips you start in a new chat, a sub-agent, or a fresh worktree. Unattended runs are deny-by-default: nothing pre-approved, nothing surprising."
    >
      <div className="space-y-4">
        <ShotRow>
          <FeatureShot
            id="auto-artifacts"
            kind="focus"
            ratio="4/3"
            scenario="13-artifacts"
            alt="The Artifacts screen with generated documents"
            spec="A populated Artifacts grid: several real generated documents, each card showing the personality that made it."
          />
          <FeatureShot
            id="auto-artifact-tab"
            kind="focus"
            ratio="4/3"
            scenario="13-artifacts"
            alt="An artifact open as a workspace tab"
            spec="One artifact open and rendered as a tab, with its regenerate control visible."
          />
        </ShotRow>
        <ShotRow>
          <FeatureShot
            id="auto-schedules"
            kind="focus"
            ratio="4/3"
            scenario="14-schedules"
            alt="Scheduled agent runs"
            spec="The Schedules cards with several schedules, each showing its cadence and the personality that last ran it. Fill the form completely if it is in frame."
          />
          <FeatureShot
            id="auto-suggested"
            kind="focus"
            ratio="4/3"
            scenario="09-composer-intelligence"
            alt="Suggested follow-up tasks above the composer"
            spec="Suggested task chips above the message box, with the start-mode picker open on one of them."
          />
        </ShotRow>
      </div>
    </FeatureSection>
  );
}

function CodeIdeSection() {
  return (
    <FeatureSection
      title="An IDE, not a chat box"
      description="Jump to a symbol's definition, see its type on hover, find every reference, and rename it across a project. Problems from your language server and your linter land in the gutter and in a diagnostics panel. Create, rename, delete and move files. The Solution lens shows a .NET solution the way the build system sees it."
    >
      <div className="space-y-4">
        <FeatureShot
          id="ide-rename"
          kind="loop"
          ratio="16/9"
          chrome
          scenario="24-code-intelligence"
          alt="Renaming a symbol across a whole project"
          spec="A rename running across several files: the preview of affected sites, then the applied result. The single clearest proof this is a real IDE."
        />
        <ShotRow cols={3}>
          <FeatureShot
            id="ide-definition"
            kind="focus"
            ratio="4/3"
            scenario="19-editor-ide"
            alt="Go to definition in the editor"
            spec="The editor with a go-to-definition result open, status bar showing language and cursor position."
          />
          <FeatureShot
            id="ide-diagnostics"
            kind="focus"
            ratio="4/3"
            scenario="24-code-intelligence"
            alt="Language server and linter problems in the gutter"
            spec="Diagnostics in the gutter right of the line numbers, plus the panel listing them. Real problems from the staged repo, not invented ones."
          />
          <FeatureShot
            id="ide-solution"
            kind="focus"
            ratio="4/3"
            scenario="24-code-intelligence"
            alt="The Solution lens over a .NET solution"
            spec="The Solution tree with projects expanded and their real file sets."
          />
        </ShotRow>
      </div>
    </FeatureSection>
  );
}

function VisualizerSection() {
  return (
    <FeatureSection
      title="See what your agents are doing"
      description="A live, interactive map of the work in progress (agents, subagents, tool calls, messages, and a file-attention heatmap) that works for every provider and opens from any chat or scoped to a single run. Scrub the timeline, pin it as a picture-in-picture over your workspace, or let it read the room out loud."
    >
      <div className="space-y-4">
        <FeatureShot
          id="viz-graph"
          kind="loop"
          ratio="16/9"
          chrome
          scenario="08-visualizer"
          alt="The Visualizer graph animating while agents work"
          spec="The graph mid-run with a parent agent fanning out to subagents: nodes settling, tool calls firing, the heatmap warming. Motion is the whole point."
        />
        <ShotRow>
          <FeatureShot
            id="viz-node"
            kind="focus"
            ratio="4/3"
            scenario="08-visualizer"
            alt="A single agent node with its context readout and tool cards"
            spec="One node close up: personality colour, context ring, and the tool cards with their token costs."
          />
          <FeatureShot
            id="viz-pip"
            kind="focus"
            ratio="4/3"
            scenario="08-visualizer"
            alt="The Visualizer pinned as a picture-in-picture over a workspace"
            spec="The PIP viewport floating over a working workspace, so the graph stays glanceable while you work."
          />
        </ShotRow>
        <p className="text-sm leading-relaxed text-muted-foreground">
          The render layer is{" "}
          <a
            href="https://github.com/patoles/agent-flow"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-white/80"
          >
            Agent Flow
          </a>{" "}
          by Simon Patole, fed by Otto&apos;s own provider-neutral event stream, which is why it
          lights up for every provider, not just one. Go star it.
        </p>
      </div>
    </FeatureSection>
  );
}

function PreviewVerificationSection() {
  return (
    <FeatureSection
      title="Agents that prove their work"
      description="Otto ships a rebuilt, more functional preview server system. Agents start your dev server from a launch config, open the app in a browser pane, and verify their own changes: reading accessibility snapshots, inspecting the DOM, checking the console and network, clicking and filling forms, resizing the viewport, and capturing screenshots. You get proof, not 'should work now, can you check?'"
    >
      <div className="space-y-4">
        <FeatureShot
          id="preview-verify"
          kind="loop"
          ratio="16/9"
          chrome
          scenario="02-preview-verify"
          alt="An agent verifying its own change in a live browser pane"
          spec="Chat left, the real running app right. The agent edits, the page updates, the agent clicks through and confirms. One continuous take."
        />
        <ShotRow>
          <FeatureShot
            id="preview-proof"
            kind="focus"
            ratio="4/3"
            scenario="02-preview-verify"
            alt="A screenshot attached to the conversation as proof"
            spec="The message bubble where the agent attaches its own screenshot and states what it verified."
          />
          <FeatureShot
            id="preview-console"
            kind="focus"
            ratio="4/3"
            scenario="02-preview-verify"
            alt="Console and network output captured from the preview"
            spec="Captured console and network output from the running dev server, in the agent's own tool output."
          />
        </ShotRow>
      </div>
    </FeatureSection>
  );
}

function ServiceProxyBlock() {
  const workspaces = [
    { name: "fix-auth", url: "web.fix-auth.my-app.localhost" },
    { name: "add-search", url: "web.add-search.my-app.localhost" },
    { name: "upgrade-deps", url: "web.upgrade-deps.my-app.localhost" },
  ];

  return (
    <SubFeature
      title="Forget about ports"
      description="When agents work in parallel, they all run dev servers. Otto gives each one a URL based on the branch name, no port conflicts, no guessing."
    >
      <div className="rounded-2xl border border-white/10 bg-white/[0.02] overflow-hidden">
        <div className="px-5 py-4 space-y-3">
          {/* Project */}
          <div className="flex items-center gap-2.5">
            <MaterialGlyph path={FOLDER_PATH} width={16} height={16} className="text-white/40" />
            <span className="text-sm font-medium text-white/60">my-app</span>
          </div>

          {/* Workspaces indented */}
          <div className="pl-6 space-y-2">
            {workspaces.map((ws) => (
              <div key={ws.name} className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                  <span className="text-sm text-white/80">{ws.name}</span>
                  <span className="text-xs text-white/25 font-mono">npm run dev</span>
                </div>
                <span className="text-xs font-mono text-white/30">{ws.url}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </SubFeature>
  );
}

function ShortcutsBlock() {
  const shortcuts = [
    { keys: ["⌘", "1-9"], action: "Switch panels" },
    { keys: ["⌘", "D"], action: "Split vertical" },
    { keys: ["⌘", "Shift", "D"], action: "Split horizontal" },
    { keys: ["⌘", "W"], action: "Close panel" },
    { keys: ["⌘", "N"], action: "New agent" },
    { keys: ["⌘", "K"], action: "Command palette" },
  ];

  return (
    <SubFeature
      title="Keyboard-first"
      description="Every action has a shortcut. Panels, splits, agents - all from the keyboard."
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {shortcuts.map((s) => (
          <div
            key={s.action}
            className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.03] px-4 py-2.5"
          >
            <span className="text-sm text-white/60">{s.action}</span>
            <div className="flex items-center gap-1">
              {s.keys.map((k) => (
                <kbd
                  key={k}
                  className="text-xs px-1.5 py-0.5 rounded bg-white/10 text-white/50 font-mono"
                >
                  {k}
                </kbd>
              ))}
            </div>
          </div>
        ))}
      </div>
    </SubFeature>
  );
}

function VoiceSection() {
  return (
    <FeatureSection
      title="Voice control, fully local"
      description="Speech-to-text and text-to-speech run entirely on your machine by default. Nothing leaves your network. Replies queue up and play in order, with pauses where a voice would take them, and every personality can speak its own lines when it joins, starts thinking, and finishes."
    >
      <div className="space-y-4">
        <FeatureShot
          id="voice-mode"
          kind="loop"
          ratio="16/9"
          chrome
          scenario="21-voice"
          alt="Voice mode driving an agent conversation hands-free"
          spec="Voice mode live: the listening indicator, dictated text landing in the composer, then the reply being spoken back with its playback state visible."
        />
        <FeatureShot
          id="voice-playback"
          kind="focus"
          ratio="16/10"
          scenario="21-voice"
          alt="Per-message playback controls and speech settings"
          spec="A chat with the per-bubble play button showing, and the speech settings panel with its Dictation and Voice sections filled in."
        />
      </div>
    </FeatureSection>
  );
}

function OttoBrainSection() {
  return (
    <FeatureSection
      title="Otto Brain"
      description="A model hosting and management system, local or remote. Run a model on your machine or point Otto at a brain running on another installation of your own. Start, stop, and switch models from the same interface you use for Claude and Codex: no separate GUI, no separate process to babysit. Pull models from Hugging Face, calibrate context windows and reasoning budgets, and benchmark your models against each other. Your prompts stay on hardware you own."
    >
      <FeatureShot
        id="brain-dashboard"
        kind="focus"
        ratio="16/9"
        chrome
        alt="The Otto Brain dashboard showing live VRAM, telemetry verdicts, and the running model"
        spec="The dashboard sheet: model name and version at top, VRAM usage bar, telemetry bars (reasoning-only / truncated / failed), and the recent completions list showing live verdicts."
      />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
          <p className="mb-2 text-sm font-medium text-white/80">Self-contained</p>
          <p className="text-sm leading-relaxed text-white/60">
            Owns its own llama.cpp runtime and models. Nothing else to install.
          </p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
          <p className="mb-2 text-sm font-medium text-white/80">Daemon-managed</p>
          <p className="text-sm leading-relaxed text-white/60">
            Starts, stops, and restarts with the daemon. Lifecycle is{" "}
            <code className="text-xs text-white/70">otto brain start/stop/restart/status</code>.
          </p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
          <p className="mb-2 text-sm font-medium text-white/80">Calibrate &amp; benchmark</p>
          <p className="text-sm leading-relaxed text-white/60">
            Measure KV bytes per token, calibrate context windows and reasoning budgets, and rank
            models against each other with evals and variance.
          </p>
        </div>
      </div>
    </FeatureSection>
  );
}

function InterfaceSection() {
  return (
    <FeatureSection
      title="The interface you live in"
      description="Agents put small interactive widgets straight into the conversation. The task list is an open checklist you can pin above the chat. Messages you send mid-turn queue up and arrive together. Mermaid diagrams, AsciiDoc and embedded HTML all render properly, on every platform."
    >
      <div className="space-y-12">
        <div className="space-y-4">
          <FeatureShot
            id="ui-widget"
            kind="focus"
            ratio="16/9"
            chrome
            scenario="22-widgets"
            alt="An agent-built interactive widget inside the conversation"
            spec="A real widget rendered inline in the chat: something interactive the agent built, not a static card. The best five seconds in this section."
          />
          <ShotRow>
            <FeatureShot
              id="ui-tasklist"
              kind="focus"
              ratio="4/3"
              scenario="01-agent-live"
              alt="The agent's live task checklist pinned above the chat"
              spec="The task list pinned, with items done, one in progress, and the rest pending."
            />
            <FeatureShot
              id="ui-mermaid"
              kind="focus"
              ratio="4/3"
              scenario="22-widgets"
              alt="A Mermaid diagram rendered in chat"
              spec="A Mermaid diagram rendered in a reply, legible at reading size, not a wall of nodes."
            />
          </ShotRow>
        </div>
        <ThemesBlock />
      </div>
    </FeatureSection>
  );
}

function CostSection() {
  return (
    <FeatureSection
      title="Know what it costs"
      description="A Context Management tab accounts for everything filling an agent's window before you type (context files, memory, skills, MCP tools, Otto's own prompt), read as a share of the model window rather than a bare token count. Usage is itemized per agent and per sub-agent at any nesting depth, with cost reported by the provider or left blank, never estimated from a rate table."
    >
      <div className="space-y-4">
        <FeatureShot
          id="cost-context"
          kind="focus"
          ratio="16/9"
          chrome
          scenario="20-context-cost"
          alt="The Context Management tab accounting for a full context window"
          spec="The three-pane Context tab with a real inventory: every category present, percentages of the window shown, and a finding selected so its assembled text is visible."
        />
        <ShotRow>
          <FeatureShot
            id="cost-ledger"
            kind="focus"
            ratio="4/3"
            scenario="20-context-cost"
            alt="The itemized usage log grouped by chat turn"
            spec="The Usage Log tab: several turns, sub-agents nested under the turn that spawned them, real token and cost columns."
          />
          <FeatureShot
            id="cost-metrics"
            kind="focus"
            ratio="4/3"
            scenario="20-context-cost"
            alt="The metrics bar above the chat"
            spec="The metrics bar showing what the conversation has cost so far, with the context ring beside it."
          />
        </ShotRow>
      </div>
    </FeatureSection>
  );
}

function GetStarted() {
  return (
    <div className="pt-10">
      <div className="flex flex-row flex-wrap gap-3">
        <DownloadButton />
        <a
          href={webAppUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center justify-center gap-2 rounded-lg border border-white/20 px-4 py-2 text-sm font-medium text-white hover:bg-white/10 transition-colors"
        >
          <GlobeIcon className="h-4 w-4" />
          Web App
        </a>
        <ServerInstallButton />
      </div>
      <div className="pt-3">
        <a
          href="/download"
          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          All download options
        </a>
      </div>
      <div className="flex items-center gap-2 pt-6">
        <span className="text-xs text-muted-foreground">Supports</span>
        <div className="flex items-center gap-1">
          <AgentBadge name="Claude Code" icon={CLAUDE_CODE_BADGE_ICON} />
          <AgentBadge name="Codex" icon={CODEX_BADGE_ICON} />
          <AgentBadge name="OpenCode" icon={OPENCODE_BADGE_ICON} />
          <AgentBadge name="Pi" icon={PI_BADGE_ICON} />
          <AgentBadge name="Cursor" icon={CURSOR_BADGE_ICON} />
        </div>
        <a
          href="/agents"
          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          +{ADDITIONAL_AGENT_COUNT} more
        </a>
      </div>
    </div>
  );
}

function DownloadButton() {
  const release = useRelease();
  const detectedPlatform = useDetectedPlatform();
  // Falls back to the download page when the detected platform has no artifact
  // on this release. Mac builds can be absent if their job failed.
  const primary = getDownloadOptions(release).find((o) => o.platform === detectedPlatform);

  if (!primary) {
    return (
      <a
        href="/download"
        className="inline-flex items-center gap-2 rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background hover:bg-foreground/90 transition-colors"
      >
        Download
      </a>
    );
  }

  const PrimaryIcon = primary.icon;

  return (
    <a
      href={primary.href}
      {...(primary.openInPage ? {} : { target: "_blank", rel: "noopener noreferrer" })}
      className="inline-flex items-center gap-2 rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background hover:bg-foreground/90 transition-colors"
    >
      <PrimaryIcon className="h-4 w-4" />
      Download for {primary.label}
    </a>
  );
}

const SERVER_INSTALL_TRIGGER = (
  <span className="inline-flex items-center justify-center rounded-lg border border-white/20 px-3 py-2 text-white hover:bg-white/10 transition-colors">
    <TerminalIcon className="h-5 w-5" />
  </span>
);

const SERVER_INSTALL_FOOTNOTE = (
  <>
    Requires Node.js 18+. Run <span className="font-mono text-white/40">otto</span> to start the
    daemon.
  </>
);

function ServerInstallButton() {
  return (
    <CommandDialog
      trigger={SERVER_INSTALL_TRIGGER}
      title="Run agents on a remote machine"
      description="For headless machines you want to connect to from the Otto apps. The desktop app already includes a built-in daemon."
      command="npm install -g @otto-code/cli && otto"
      footnote={SERVER_INSTALL_FOOTNOTE}
    />
  );
}

function ClaudeCodeIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      fillRule="evenodd"
      aria-hidden="true"
      {...props}
    >
      <path d="M4.709 15.955l4.72-2.647.08-.23-.08-.128H9.2l-.79-.048-2.698-.073-2.339-.097-2.266-.122-.571-.121L0 11.784l.055-.352.48-.321.686.06 1.52.103 2.278.158 1.652.097 2.449.255h.389l.055-.157-.134-.098-.103-.097-2.358-1.596-2.552-1.688-1.336-.972-.724-.491-.364-.462-.158-1.008.656-.722.881.06.225.061.893.686 1.908 1.476 2.491 1.833.365.304.145-.103.019-.073-.164-.274-1.355-2.446-1.446-2.49-.644-1.032-.17-.619a2.97 2.97 0 01-.104-.729L6.283.134 6.696 0l.996.134.42.364.62 1.414 1.002 2.229 1.555 3.03.456.898.243.832.091.255h.158V9.01l.128-1.706.237-2.095.23-2.695.08-.76.376-.91.747-.492.584.28.48.685-.067.444-.286 1.851-.559 2.903-.364 1.942h.212l.243-.242.985-1.306 1.652-2.064.73-.82.85-.904.547-.431h1.033l.76 1.129-.34 1.166-1.064 1.347-.881 1.142-1.264 1.7-.79 1.36.073.11.188-.02 2.856-.606 1.543-.28 1.841-.315.833.388.091.395-.328.807-1.969.486-2.309.462-3.439.813-.042.03.049.061 1.549.146.662.036h1.622l3.02.225.79.522.474.638-.079.485-1.215.62-1.64-.389-3.829-.91-1.312-.329h-.182v.11l1.093 1.068 2.006 1.81 2.509 2.33.127.578-.322.455-.34-.049-2.205-1.657-.851-.747-1.926-1.62h-.128v.17l.444.649 2.345 3.521.122 1.08-.17.353-.608.213-.668-.122-1.374-1.925-1.415-2.167-1.143-1.943-.14.08-.674 7.254-.316.37-.729.28-.607-.461-.322-.747.322-1.476.389-1.924.315-1.53.286-1.9.17-.632-.012-.042-.14.018-1.434 1.967-2.18 2.945-1.726 1.845-.414.164-.717-.37.067-.662.401-.589 2.388-3.036 1.44-1.882.93-1.086-.006-.158h-.055L4.132 18.56l-1.13.146-.487-.456.061-.746.231-.243 1.908-1.312-.006.006z" />
    </svg>
  );
}

function CodexIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      fillRule="evenodd"
      aria-hidden="true"
      {...props}
    >
      <path d="M21.55 10.004a5.416 5.416 0 00-.478-4.501c-1.217-2.09-3.662-3.166-6.05-2.66A5.59 5.59 0 0010.831 1C8.39.995 6.224 2.546 5.473 4.838A5.553 5.553 0 001.76 7.496a5.487 5.487 0 00.691 6.5 5.416 5.416 0 00.477 4.502c1.217 2.09 3.662 3.165 6.05 2.66A5.586 5.586 0 0013.168 23c2.443.006 4.61-1.546 5.361-3.84a5.553 5.553 0 003.715-2.66 5.488 5.488 0 00-.693-6.497v.001zm-8.381 11.558a4.199 4.199 0 01-2.675-.954c.034-.018.093-.05.132-.074l4.44-2.53a.71.71 0 00.364-.623v-6.176l1.877 1.069c.02.01.033.029.036.05v5.115c-.003 2.274-1.87 4.118-4.174 4.123zM4.192 17.78a4.059 4.059 0 01-.498-2.763c.032.02.09.055.131.078l4.44 2.53c.225.13.504.13.73 0l5.42-3.088v2.138a.068.068 0 01-.027.057L9.9 19.288c-1.999 1.136-4.552.46-5.707-1.51h-.001zM3.023 8.216A4.15 4.15 0 015.198 6.41l-.002.151v5.06a.711.711 0 00.364.624l5.42 3.087-1.876 1.07a.067.067 0 01-.063.005l-4.489-2.559c-1.995-1.14-2.679-3.658-1.53-5.63h.001zm15.417 3.54l-5.42-3.088L14.896 7.6a.067.067 0 01.063-.006l4.489 2.557c1.998 1.14 2.683 3.662 1.529 5.633a4.163 4.163 0 01-2.174 1.807V12.38a.71.71 0 00-.363-.623zm1.867-2.773a6.04 6.04 0 00-.132-.078l-4.44-2.53a.731.731 0 00-.729 0l-5.42 3.088V7.325a.068.068 0 01.027-.057L14.1 4.713c2-1.137 4.555-.46 5.707 1.513.487.833.664 1.809.499 2.757h.001zm-11.741 3.81l-1.877-1.068a.065.065 0 01-.036-.051V6.559c.001-2.277 1.873-4.122 4.181-4.12.976 0 1.92.338 2.671.954-.034.018-.092.05-.131.073l-4.44 2.53a.71.71 0 00-.365.623l-.003 6.173v.002zm1.02-2.168L12 9.25l2.414 1.375v2.75L12 14.75l-2.415-1.375v-2.75z" />
    </svg>
  );
}

function OpenCodeIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="96 64 288 384"
      fill="currentColor"
      aria-hidden="true"
      {...props}
    >
      <path d="M320 224V352H192V224H320Z" opacity="0.4" />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M384 416H128V96H384V416ZM320 160H192V352H320V160Z"
      />
    </svg>
  );
}

function CursorIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 466.73 532.09"
      fill="currentColor"
      aria-hidden="true"
      {...props}
    >
      <path d="M457.43,125.94L244.42,2.96c-6.84-3.95-15.28-3.95-22.12,0L9.3,125.94c-5.75,3.32-9.3,9.46-9.3,16.11v247.99c0,6.65,3.55,12.79,9.3,16.11l213.01,122.98c6.84,3.95,15.28,3.95,22.12,0l213.01-122.98c5.75-3.32,9.3-9.46,9.3-16.11v-247.99c0-6.65-3.55-12.79-9.3-16.11h-.01ZM444.05,151.99l-205.63,356.16c-1.39,2.4-5.06,1.42-5.06-1.36v-233.21c0-4.66-2.49-8.97-6.53-11.31L24.87,145.67c-2.4-1.39-1.42-5.06,1.36-5.06h411.26c5.84,0,9.49,6.33,6.57,11.39h-.01Z" />
    </svg>
  );
}

function PiIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 800 800"
      fill="currentColor"
      aria-hidden="true"
      {...props}
    >
      <path
        d="M165.29 165.29 H517.36 V400 H400 V517.36 H282.65 V634.72 H165.29 Z M282.65 282.65 V400 H400 V282.65 Z"
        fillRule="evenodd"
      />
      <path d="M517.36 400 H634.72 V634.72 H517.36 Z" />
    </svg>
  );
}

const bashKeywords = new Set([
  "while",
  "do",
  "done",
  "if",
  "then",
  "fi",
  "else",
  "break",
  "true",
  "false",
]);
const bashCommands = new Set(["otto", "echo", "jq"]);

function tokenizeBashComment(code: string, i: number): { node: React.ReactNode; len: number } {
  const end = code.indexOf("\n", i);
  const comment = end === -1 ? code.slice(i) : code.slice(i, end);
  return {
    node: <span className="text-white/30 italic">{comment}</span>,
    len: comment.length,
  };
}

function tokenizeBashDoubleQuoted(code: string, i: number): { node: React.ReactNode; len: number } {
  let j = i + 1;
  while (j < code.length && code[j] !== '"') {
    if (code[j] === "\\") j++;
    j++;
  }
  const str = code.slice(i, j + 1);
  return { node: <span className="text-green-400/80">{str}</span>, len: str.length };
}

function tokenizeBashSingleQuoted(code: string, i: number): { node: React.ReactNode; len: number } {
  let j = i + 1;
  while (j < code.length && code[j] !== "'") j++;
  const str = code.slice(i, j + 1);
  return { node: <span className="text-green-400/80">{str}</span>, len: str.length };
}

function tokenizeBashDollar(code: string, i: number): { node: React.ReactNode; len: number } {
  if (code[i + 1] === "(") {
    return { node: <span className="text-amber-300/70">$(</span>, len: 2 };
  }
  let j = i + 1;
  while (j < code.length && /\w/.test(code[j])) j++;
  return {
    node: <span className="text-amber-300/70">{code.slice(i, j)}</span>,
    len: j - i,
  };
}

function tokenizeBashFlag(code: string, i: number): { node: React.ReactNode; len: number } {
  let j = i;
  if (code[j + 1] === "-") j++;
  j++;
  while (j < code.length && /[\w-]/.test(code[j])) j++;
  return {
    node: <span className="text-sky-300/70">{code.slice(i, j)}</span>,
    len: j - i,
  };
}

function tokenizeBashWord(code: string, i: number): { node: React.ReactNode; len: number } {
  let j = i;
  while (j < code.length && /\w/.test(code[j])) j++;
  const word = code.slice(i, j);
  const len = j - i;
  if (bashKeywords.has(word)) {
    return { node: <span className="text-purple-400">{word}</span>, len };
  }
  if (bashCommands.has(word)) {
    return { node: <span className="text-white">{word}</span>, len };
  }
  return { node: word, len };
}

function isBashFlagStart(code: string, i: number): boolean {
  return (
    code[i] === "-" &&
    (i === 0 || /\s/.test(code[i - 1])) &&
    i + 1 < code.length &&
    /[\w-]/.test(code[i + 1])
  );
}

function isBashCommentStart(code: string, i: number): boolean {
  return code[i] === "#" && (i === 0 || /[\s(]/.test(code[i - 1]));
}

function tokenizeBashChar(code: string, i: number): { node: React.ReactNode; len: number } {
  const c = code[i];
  if (c === "|" || (c === "&" && code[i + 1] === "&")) {
    const op = c === "|" ? "|" : "&&";
    return { node: <span className="text-white/40">{op}</span>, len: op.length };
  }
  if (c === "\\") return { node: <span className="text-white/40">\</span>, len: 1 };
  if (c === ")") return { node: <span className="text-amber-300/70">)</span>, len: 1 };
  return { node: c, len: 1 };
}

function nextBashToken(code: string, i: number): { node: React.ReactNode; len: number } {
  if (isBashCommentStart(code, i)) return tokenizeBashComment(code, i);
  if (code[i] === '"') return tokenizeBashDoubleQuoted(code, i);
  if (code[i] === "'") return tokenizeBashSingleQuoted(code, i);
  if (code[i] === "$") return tokenizeBashDollar(code, i);
  if (isBashFlagStart(code, i)) return tokenizeBashFlag(code, i);
  if (/[a-zA-Z_]/.test(code[i])) return tokenizeBashWord(code, i);
  return tokenizeBashChar(code, i);
}

function highlightBash(code: string): React.ReactNode {
  const tokens: React.ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < code.length) {
    const { node, len } = nextBashToken(code, i);
    if (React.isValidElement(node)) {
      tokens.push(React.cloneElement(node, { key: key++ }));
    } else {
      tokens.push(node);
    }
    i += len;
  }

  return tokens;
}

function CLICodeBlock({ children }: { children: string }) {
  const [copied, setCopied] = React.useState(false);

  const handleCopy = React.useCallback(() => {
    navigator.clipboard.writeText(children);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [children]);

  return (
    <div className="relative bg-white/5 rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={handleCopy}
        className="absolute top-3 right-3 text-white/30 hover:text-white/70 transition-colors p-1"
        title="Copy to clipboard"
      >
        {copied ? (
          <MaterialGlyph path={CHECK_PATH} width={14} height={14} />
        ) : (
          <MaterialGlyph path={COPY_PATH} width={14} height={14} />
        )}
      </button>
      <pre className="p-4 pr-10 text-xs leading-relaxed overflow-x-auto text-white/70 font-mono whitespace-pre">
        {highlightBash(children)}
      </pre>
    </div>
  );
}

interface CLIExample {
  title: string;
  description: string;
  code: string;
}

const cliExamples: CLIExample[] = [
  {
    title: "Run agents",
    description:
      "Launch agents locally or on any remote host. The --worktree flag spins up an isolated git branch so you can run multiple agents on the same repo without conflicts.",
    code: `otto run "implement user authentication"
otto run --provider codex --worktree feature-x "implement feature X"
otto run --host devbox:6868 "run the full test suite"

otto ls                           # list running agents
otto attach abc123                # stream live output
otto send abc123 "also add tests" # follow-up task`,
  },
  {
    title: "Loops",
    description:
      "Have one agent do the work, another verify the result, and loop until it passes. Built-in, no shell scripting needed.",
    code: `# Worker-verifier loop: fix tests until they pass
otto loop run "make all tests pass" \\
  --verify "verify tests pass and the code is production-ready" \\
  --verify-check "npm test" \\
  --max-iterations 5

otto loop ls                        # list running loops
otto loop logs abc123               # stream loop output`,
  },
  {
    title: "Schedules",
    description:
      "Run agents on a cron schedule. Automate recurring tasks like dependency updates, security audits, or report generation.",
    code: `# Run a security audit every Monday at 9am
otto schedule create --cron "0 9 * * 1" \\
  "audit the codebase for security issues and open PRs for fixes"

otto schedule ls                    # list all schedules
otto schedule pause abc123          # pause a schedule
otto schedule delete abc123         # remove a schedule`,
  },
];

function PhoneShowcase() {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const textInView = useInView(containerRef, { once: true, margin: "-80px" });

  // Scroll-linked animation: track how far through the container the user has scrolled
  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ["start end", "center center"],
  });

  // Responsive slide distance
  const [slideDistance, setSlideDistance] = React.useState(260);
  React.useEffect(() => {
    function update() {
      setSlideDistance(window.innerWidth < 768 ? 140 : 260);
    }
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  // Side phones start at x=0 (behind center) and slide out to final position
  const sideOpacity = useTransform(scrollYProgress, [0.2, 0.6], [0, 1]);
  const leftX = useTransform(scrollYProgress, [0.2, 0.6], [0, -slideDistance]);
  const rightX = useTransform(scrollYProgress, [0.2, 0.6], [0, slideDistance]);

  const leftPhoneStyle = React.useMemo(
    () => ({ opacity: sideOpacity, x: leftX, rotateY: -15, scale: 0.97 }),
    [sideOpacity, leftX],
  );
  const rightPhoneStyle = React.useMemo(
    () => ({ opacity: sideOpacity, x: rightX, rotateY: 15, scale: 0.97 }),
    [sideOpacity, rightX],
  );
  const centerPhoneAnimate = React.useMemo(() => (textInView ? FADE_IN : {}), [textInView]);
  const textAnimate = React.useMemo(() => (textInView ? FADE_IN : {}), [textInView]);

  return (
    <div ref={containerRef} className="flex flex-col items-center pt-4 pb-16 gap-20">
      {/* Arrow + text */}
      <motion.div
        initial={FADE_IN_UP_TINY}
        animate={textAnimate}
        transition={DURATION_05}
        className="flex flex-col items-center gap-1.5 px-6"
      >
        <MaterialGlyph path={ARROW_DOWN_PATH} width={24} height={24} className="text-white/20" />
        <p className="text-lg text-white/80 text-center">
          When you want to step away from your desk,
          <br className="md:hidden" /> you can.
        </p>
        <p className="text-sm text-white/50 text-center">
          The native mobile app has full feature parity with desktop.
        </p>
      </motion.div>

      {/* Phone trio. Side phones are absolute, start behind center, slide outward with perspective rotation */}
      <div
        className="relative flex items-center justify-center overflow-x-clip w-full"
        style={PHONE_PERSPECTIVE_STYLE}
      >
        {/* Left phone, rotated to face inward */}
        <motion.div style={leftPhoneStyle} className="w-[160px] md:w-[240px] absolute">
          <img
            src="/phone-1-480.webp"
            srcSet="/phone-1-320.webp 320w, /phone-1-480.webp 480w"
            sizes="(min-width: 768px) 240px, 160px"
            alt="Otto sessions list"
            width={480}
            height={1044}
            loading="lazy"
            decoding="async"
            className="w-full rounded-[40px] shadow-2xl border-[3px] border-black outline-[3px] outline-white/20"
          />
        </motion.div>

        {/* Center phone */}
        <motion.div
          initial={FADE_IN_UP_XL}
          animate={centerPhoneAnimate}
          transition={EASE_OUT_06_DELAY_01}
          className="w-[220px] md:w-[240px] relative z-10"
        >
          <img
            src="/phone-2-480.webp"
            srcSet="/phone-2-320.webp 320w, /phone-2-480.webp 480w"
            sizes="(min-width: 768px) 240px, 220px"
            alt="Otto agent chat"
            width={480}
            height={1044}
            loading="lazy"
            decoding="async"
            className="w-full rounded-[40px] shadow-2xl border-[3px] border-black outline-[3px] outline-white/20"
          />
        </motion.div>

        {/* Right phone, rotated to face inward */}
        <motion.div style={rightPhoneStyle} className="w-[160px] md:w-[240px] absolute">
          <img
            src="/phone-3-480.webp"
            srcSet="/phone-3-320.webp 320w, /phone-3-480.webp 480w"
            sizes="(min-width: 768px) 240px, 160px"
            alt="Otto diff view"
            width={480}
            height={1044}
            loading="lazy"
            decoding="async"
            className="w-full rounded-[40px] shadow-2xl border-[3px] border-black outline-[3px] outline-white/20"
          />
        </motion.div>
      </div>
    </div>
  );
}

function CLITabButton({
  title,
  index,
  active,
  onSelect,
}: {
  title: string;
  index: number;
  active: boolean;
  onSelect: (i: number) => void;
}) {
  const handleClick = React.useCallback(() => onSelect(index), [onSelect, index]);
  return (
    <button
      type="button"
      onClick={handleClick}
      className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
        active
          ? "border-white/40 text-white bg-white/10"
          : "border-white/15 text-white/50 hover:text-white/80 hover:border-white/30"
      }`}
    >
      {title}
    </button>
  );
}

function CLIBlock() {
  const [activeIndex, setActiveIndex] = React.useState(0);
  const active = cliExamples[activeIndex];

  return (
    <SubFeature
      title="Fully scriptable"
      description="Everything you can do in the app, you can do from the terminal."
    >
      <div className="mb-3 flex flex-wrap gap-2">
        {cliExamples.map((example, i) => (
          <CLITabButton
            key={example.title}
            title={example.title}
            index={i}
            active={i === activeIndex}
            onSelect={setActiveIndex}
          />
        ))}
      </div>

      <div className="mb-3">
        <CLICodeBlock>{active.code}</CLICodeBlock>
      </div>

      <a
        href="/docs/cli"
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        Full CLI reference
        <MaterialGlyph path={ARROW_FORWARD_PATH} width={12} height={12} />
      </a>
    </SubFeature>
  );
}

function FAQ() {
  return (
    <motion.div
      initial={FADE_IN_UP}
      whileInView={FADE_IN}
      viewport={VIEWPORT_60}
      transition={EASE_OUT_05}
      className="space-y-6"
    >
      <h2 className="text-3xl font-medium">FAQ</h2>
      <div className="space-y-6">
        <FAQItem question="How is Otto related to Paseo?">
          Otto is an open-source fork of{" "}
          <a
            href="https://github.com/getpaseo/paseo"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-white/80"
          >
            Paseo
          </a>
          , with full upstream history preserved. I&apos;m proud of that lineage. Paseo is a
          fantastic platform to build on. Otto tracks upstream improvements and adds its own
          direction on top: growing into a fully featured agentic coding assistant, with in-browser
          preview verification, artifacts, and frontier-model tooling brought to every provider,
          cloud APIs and local models alike. Otto is an independent project and isn&apos;t
          affiliated with or endorsed by the Paseo team; Paseo&apos;s community, sponsors, and
          testimonials are theirs, not mine.
        </FAQItem>
        <FAQItem question="What powers the Visualizer?">
          The render layer of{" "}
          <a
            href="https://github.com/patoles/agent-flow"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-white/80"
          >
            Agent Flow
          </a>{" "}
          (Apache-2.0) by{" "}
          <a
            href="https://github.com/patoles"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-white/80"
          >
            Simon Patole
          </a>
          , vendored into Otto and fed by Otto&apos;s own provider-neutral event stream rather than
          its original ingestion, which is why the graph works for every provider, not just one.
          Simon&apos;s separation between rendering and event collection is what made that possible,
          and it&apos;s been a pleasure to work with. Agent Flow is an independent project; it
          doesn&apos;t endorse Otto, and its name and logos are its own. Go star it.
        </FAQItem>
        <FAQItem question="Is this free?">
          Yes. Otto is free and open source. You need Claude Code, Codex, Cursor, OpenCode, or Pi
          installed with your own credentials. Voice is local-first by default and can optionally
          use OpenAI speech providers if you configure them.
        </FAQItem>
        <FAQItem question="Does my code leave my machine?">
          Otto doesn&apos;t send your code anywhere. Agents run locally and talk to their own APIs
          as they normally would. For remote access, you can use the optional{" "}
          <a href="/docs/security" className="underline hover:text-white/80">
            end-to-end encrypted relay
          </a>
          , connect directly over your local network, or use your own tunnel.
        </FAQItem>
        <FAQItem question="What agents does it support?">
          Claude Code, Codex, Cursor, OpenCode, and Pi. Each agent runs as its own process using its
          own CLI or local integration. Otto doesn&apos;t modify or wrap their behavior.
        </FAQItem>
        <FAQItem question="Do I need the desktop app?">
          No. You can run the daemon headless with{" "}
          <code className="font-mono text-muted-foreground">
            npm install -g @otto-code/cli && otto
          </code>{" "}
          and use the CLI, web app, or mobile app to connect. The desktop app just bundles the
          daemon with a UI.
        </FAQItem>
        <FAQItem question="How does voice work?">
          Voice runs locally on your device by default. You talk, the app transcribes and sends it
          to your agent as text. Optionally, you can configure OpenAI speech providers for
          higher-quality transcription and text-to-speech. See the{" "}
          <a href="/docs/voice" className="underline hover:text-white/80">
            voice docs
          </a>
          .
        </FAQItem>
        <FAQItem question="Can I connect from outside my network?">
          Yes. You can use the hosted relay (end-to-end encrypted, Otto can&apos;t read your
          traffic), set up your own tunnel (Tailscale, Cloudflare Tunnel, etc.), or expose the
          daemon port directly. See{" "}
          <a href="/docs/configuration" className="underline hover:text-white/80">
            configuration
          </a>
          .
        </FAQItem>
        <FAQItem question="Do I need git or GitHub?">
          No. Otto works in any directory. Worktrees are optional and only relevant if you use git.
          You can run agents anywhere you&apos;d normally work.
        </FAQItem>
        <FAQItem question="Can I get banned for using Otto?">
          <p>I can&apos;t make promises on behalf of providers.</p>
          <p>
            That said, Otto launches each provider&apos;s local CLI or integration (Claude Code,
            Codex, Cursor, OpenCode, Pi) as a subprocess. It doesn&apos;t extract tokens or call
            inference APIs directly. From the provider&apos;s perspective, usage through Otto is
            indistinguishable from running the provider yourself.
          </p>
        </FAQItem>
        <FAQItem question="How do worktrees work?">
          When you launch an agent with the worktree option (from the app, desktop, or CLI), Otto
          creates a git worktree and runs the agent inside it. The agent works on an isolated branch
          without touching your main working directory. See the{" "}
          <a href="/docs/worktrees" className="underline hover:text-white/80">
            worktrees docs
          </a>
          .
        </FAQItem>
      </div>
    </motion.div>
  );
}

function OttoCreditCTA() {
  return (
    <motion.div
      initial={FADE_IN_UP}
      whileInView={FADE_IN}
      viewport={VIEWPORT_60}
      transition={EASE_OUT_05}
      className="rounded-xl bg-white/5 border border-white/10 p-8 md:p-10 text-left space-y-4 max-w-xl mx-auto"
    >
      <div className="text-sm text-muted-foreground leading-relaxed space-y-3">
        <p>
          Otto is an independent open-source fork of{" "}
          <a
            href="https://github.com/getpaseo/paseo"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-white/80"
          >
            Paseo
          </a>
          , created by{" "}
          <a
            href="https://github.com/boudra"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-white/80"
          >
            Mo
          </a>
          . None of this would exist without the platform Mo built and shares under an open-source
          license. That generosity is what makes projects like Otto possible. The Visualizer is the
          same story: it&apos;s the render layer of{" "}
          <a
            href="https://github.com/patoles/agent-flow"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-white/80"
          >
            Agent Flow
          </a>{" "}
          (Apache-2.0) by{" "}
          <a
            href="https://github.com/patoles"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-white/80"
          >
            Simon Patole
          </a>
          , driven by Otto&apos;s own event stream.
        </p>
        <p>
          Otto doesn&apos;t take sponsorships or donations. If you&apos;d like to support this work,
          support the projects underneath it instead. They did the hard parts.
        </p>
      </div>
      <div className="flex flex-wrap gap-3 pt-2">
        <a
          href="https://github.com/sponsors/boudra"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-lg bg-white/10 border border-white/20 px-5 py-2.5 text-sm font-medium text-white hover:bg-white/15 transition-colors"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="currentColor"
            className="text-pink-400"
          >
            <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
          </svg>
          Sponsor Mo on GitHub
        </a>
        <a
          href="https://github.com/patoles/agent-flow"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-lg bg-white/5 border border-white/15 px-5 py-2.5 text-sm font-medium text-white/80 hover:bg-white/10 transition-colors"
        >
          Star Agent Flow
        </a>
      </div>
    </motion.div>
  );
}
