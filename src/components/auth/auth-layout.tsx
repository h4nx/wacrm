import type { ReactNode } from "react";
import { AuthBrandPanel } from "./auth-brand-panel";

// Shared chrome for every unauthenticated page (login, signup,
// forgot-password, reset-password): a persistent dark brand panel
// (AuthBrandPanel — identical on all four pages) beside a light form
// panel that only renders whatever step-specific content each page
// passes in. Individual pages keep their own state/handlers/validation
// entirely — this component only owns layout and the two panels'
// fixed surface colors.
//
// Below `lg` the brand panel hides (see AuthBrandPanel) and the form
// panel takes the full viewport width.
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <AuthBrandPanel />
      <div className="flex min-w-0 flex-1 items-center justify-center bg-auth-form px-6 py-12 sm:px-10">
        <div className="w-full max-w-sm">{children}</div>
      </div>
    </div>
  );
}
