"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowLeft } from "lucide-react";
import { AuthLayout } from "@/components/auth/auth-layout";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const supabase = createClient();

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`,
    });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    setSuccess(true);
    setLoading(false);
  };

  if (success) {
    return (
      <AuthLayout>
        <div className="mb-8">
          <p className="mb-2 font-mono text-xs tracking-[0.14em] text-primary uppercase">
            Convix &middot; Reset password
          </p>
          <h2 className="text-2xl font-semibold tracking-tight text-auth-form-foreground">
            Check your email
          </h2>
          <p className="mt-1.5 text-sm text-auth-form-muted">
            We&apos;ve sent a password reset link to{" "}
            <span className="text-auth-form-foreground">{email}</span>.
            Please check your inbox.
          </p>
        </div>
        <Link href="/login">
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
          Convix &middot; Reset password
        </p>
        <h2 className="text-2xl font-semibold tracking-tight text-auth-form-foreground">
          Reset password
        </h2>
        <p className="mt-1.5 text-sm text-auth-form-muted">
          Enter your email and we&apos;ll send you a reset link
        </p>
      </div>

      <form onSubmit={handleReset} className="flex flex-col gap-4">
        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
            {error}
          </div>
        )}

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

        <Button
          type="submit"
          disabled={loading}
          className="mt-2 h-11 w-full rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {loading ? "Sending..." : "Send reset link"}
        </Button>
      </form>

      <Link
        href="/login"
        className="mt-6 flex items-center justify-center gap-2 text-sm text-auth-form-muted hover:text-auth-form-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to sign in
      </Link>
    </AuthLayout>
  );
}
