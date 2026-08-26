import { GitBranch, MessageSquare, Users, Zap } from "lucide-react";
import { ConvixLogo } from "@/components/ui/convix-logo";

// Same four pillars as the sidebar nav (inbox / contacts / pipelines /
// automations) — the auth panel's pitch should never drift from what
// the product actually does once you're inside it.
const FEATURES = [
  { icon: MessageSquare, text: "Shared team inbox for every WhatsApp number" },
  { icon: Users, text: "Contacts and CRM built around conversations" },
  { icon: GitBranch, text: "Sales pipelines with drag-and-drop stages" },
  { icon: Zap, text: "No-code automations and broadcast campaigns" },
];

// Persistent dark brand panel for the whole auth flow (login, signup,
// forgot-password, reset-password) — the H&M Business ecosystem's
// shared split-screen convention (see Orbix/Vaultex). Deliberately the
// SAME component instance/content on every auth page: only the form
// panel next to it changes per step. Uses the fixed `auth-panel-*`
// tokens (globals.css) rather than the MODE-aware `background`/
// `foreground` ones, so it stays dark independent of any later
// light/dark preference — pre-login there's no such preference yet.
export function AuthBrandPanel() {
  return (
    <aside
      aria-hidden="true"
      className="relative hidden flex-[0_0_65%] flex-col justify-between overflow-hidden bg-auth-panel px-12 py-14 lg:flex xl:px-16"
    >
      {/* Faint grid — same layered-texture convention as Vaultex/Orbix's
          auth panels, tuned to Convix's own violet --primary accent
          (color-mix keeps it in sync if the token ever changes) rather
          than their gold/amber. Masked to a soft ellipse so the lines
          fade out before the edges instead of cutting off hard. */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            "linear-gradient(color-mix(in oklch, var(--primary) 4%, transparent) 1px, transparent 1px), linear-gradient(90deg, color-mix(in oklch, var(--primary) 4%, transparent) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
          maskImage:
            "radial-gradient(ellipse 80% 80% at 50% 50%, black 40%, transparent 100%)",
          WebkitMaskImage:
            "radial-gradient(ellipse 80% 80% at 50% 50%, black 40%, transparent 100%)",
        }}
      />

      {/* Subtle grain — a hair of fractal noise so the panel doesn't read
          as a flat gradient under the grid. */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 512 512' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.75' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.025'/%3E%3C/svg%3E\")",
        }}
      />

      {/* Ambient glow — echoes the primary accent without competing with copy. */}
      <div className="pointer-events-none absolute -top-32 -left-24 h-96 w-96 rounded-full bg-primary/10 blur-3xl" />
      <div className="pointer-events-none absolute -right-16 -bottom-24 h-80 w-80 rounded-full bg-primary/5 blur-3xl" />

      {/* Logo */}
      <div className="relative flex items-center gap-4">
        <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl border border-primary/30 bg-auth-panel-foreground/[0.04]">
          <ConvixLogo className="h-10 w-10 text-primary" />
        </div>
        <div className="min-w-0">
          <div className="text-2xl font-semibold tracking-tight text-auth-panel-foreground">
            Convix
          </div>
          <div className="mt-0.5 font-mono text-[11px] tracking-[0.14em] text-primary/80 uppercase">
            WhatsApp CRM
          </div>
        </div>
      </div>

      {/* Headline */}
      <div className="relative py-10">
        <div className="mb-4 font-mono text-xs tracking-[0.16em] text-primary uppercase">
          Inbox &middot; Pipelines &middot; Automations
        </div>
        <h1 className="max-w-md text-4xl leading-tight font-bold tracking-tight text-auth-panel-foreground">
          All your WhatsApp,{" "}
          <span className="text-primary">one shared inbox.</span>
        </h1>
        <p className="mt-5 max-w-sm text-[15px] leading-relaxed text-auth-panel-muted">
          Contacts, sales pipelines, broadcasts and no-code automations —
          built for teams who sell and support over WhatsApp.
        </p>
      </div>

      {/* Feature bullets */}
      <div className="relative flex flex-col gap-3.5">
        {FEATURES.map(({ icon: Icon, text }) => (
          <div key={text} className="flex items-center gap-3">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-primary/25 bg-primary/10">
              <Icon className="h-3.5 w-3.5 text-primary" />
            </div>
            <span className="min-w-0 text-sm text-auth-panel-muted">
              {text}
            </span>
          </div>
        ))}
      </div>

      {/* Ecosystem affiliation */}
      <p className="relative mt-10 font-mono text-[11px] tracking-wide text-auth-panel-muted">
        Parte del ecosistema{" "}
        <span className="font-medium text-auth-panel-foreground/80">
          H&amp;M Business
        </span>
      </p>
    </aside>
  );
}
