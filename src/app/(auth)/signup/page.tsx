"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthLayout } from "@/components/auth/auth-layout";

// `useSearchParams` opts the component out of static prerendering
// unless wrapped in Suspense — same pattern as /login.
export default function SignupPage() {
  return (
    <Suspense fallback={null}>
      <SignupPageInner />
    </Suspense>
  );
}

function SignupPageInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  // When the user lands here from `/join/<token>` we carry the
  // invite token in the query. Signup now signs the user in
  // directly (auth propia, sin verificación por email), so on
  // success we route straight to the redeem step or the dashboard.
  const inviteToken = searchParams.get("invite");

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const supabase = createClient();

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }

    setLoading(true);

    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName,
        },
      },
    });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    // La cuenta queda creada y la sesión iniciada en el mismo paso.
    setSuccess(true);
    if (inviteToken) {
      router.push(`/join/${encodeURIComponent(inviteToken)}`);
    } else {
      router.push("/dashboard");
    }
  };

  if (success) {
    return (
      <AuthLayout>
        <div className="mb-8">
          <p className="mb-2 font-mono text-xs tracking-[0.14em] text-primary uppercase">
            Convix &middot; Sign up
          </p>
          <h2 className="text-2xl font-semibold tracking-tight text-auth-form-foreground">
            Account created
          </h2>
          <p className="mt-1.5 text-sm text-auth-form-muted">
            You&apos;re signed in as{" "}
            <span className="text-auth-form-foreground">{email}</span>. Taking
            you to your dashboard…
          </p>
        </div>
        <Link
          href={
            inviteToken
              ? `/login?invite=${encodeURIComponent(inviteToken)}`
              : "/login"
          }
        >
          <Button
            variant="outline"
            className="h-11 w-full rounded-xl border-auth-form-border text-auth-form-muted hover:bg-auth-form-input hover:text-auth-form-foreground"
          >
            Back to sign in
          </Button>
        </Link>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <div className="mb-8">
        <p className="mb-2 font-mono text-xs tracking-[0.14em] text-primary uppercase">
          Convix &middot; Sign up
        </p>
        <h2 className="text-2xl font-semibold tracking-tight text-auth-form-foreground">
          {inviteToken ? "Create account & join" : "Create account"}
        </h2>
        <p className="mt-1.5 text-sm text-auth-form-muted">
          {inviteToken
            ? "Verify your email, then accept the invitation to join your team."
            : "Get started with CRM Template for WhatsApp"}
        </p>
      </div>

      <form onSubmit={handleSignup} className="flex flex-col gap-4">
        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
            {error}
          </div>
        )}

        <div className="flex flex-col gap-2">
          <Label htmlFor="fullName" className="text-auth-form-muted">
            Full name
          </Label>
          <Input
            id="fullName"
            type="text"
            placeholder="John Doe"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            required
            className="h-11 rounded-xl border-auth-form-border bg-auth-form-input text-auth-form-foreground placeholder:text-auth-form-muted focus-visible:border-primary focus-visible:ring-primary/20"
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="email" className="text-auth-form-muted">
            Email
          </Label>
          <Input
            id="email"
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="h-11 rounded-xl border-auth-form-border bg-auth-form-input text-auth-form-foreground placeholder:text-auth-form-muted focus-visible:border-primary focus-visible:ring-primary/20"
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="password" className="text-auth-form-muted">
            Password
          </Label>
          <Input
            id="password"
            type="password"
            placeholder="At least 6 characters"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className="h-11 rounded-xl border-auth-form-border bg-auth-form-input text-auth-form-foreground placeholder:text-auth-form-muted focus-visible:border-primary focus-visible:ring-primary/20"
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="confirmPassword" className="text-auth-form-muted">
            Confirm password
          </Label>
          <Input
            id="confirmPassword"
            type="password"
            placeholder="Repeat your password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
            className="h-11 rounded-xl border-auth-form-border bg-auth-form-input text-auth-form-foreground placeholder:text-auth-form-muted focus-visible:border-primary focus-visible:ring-primary/20"
          />
        </div>

        <Button
          type="submit"
          disabled={loading}
          className="mt-2 h-11 w-full rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {loading ? "Creating account..." : "Create account"}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-auth-form-muted">
        Already have an account?{" "}
        <Link
          href={
            inviteToken
              ? `/login?invite=${encodeURIComponent(inviteToken)}`
              : "/login"
          }
          className="text-primary hover:text-primary/80"
        >
          Sign in
        </Link>
      </p>
    </AuthLayout>
  );
}
