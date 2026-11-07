"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { FieldError, Notice } from "@/components/notice";
import { SiteHeader } from "@/components/site-header";
import { useAuth } from "@/lib/auth";
import { authErrorMessage, supabase } from "@/lib/supabase";
import { passwordScore } from "@/lib/password";

export default function ResetPasswordPage() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [fieldError, setFieldError] = useState("");
  const [error, setError] = useState<{ title: string; message: string } | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) return;
    setFieldError("");
    setError(null);
    if (password.length < 8) return setFieldError("Use at least 8 characters.");
    if (password !== confirm) return setFieldError("The passwords don't match.");
    setBusy(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (updateError) return setError(authErrorMessage(updateError));
    setDone(true);
    window.setTimeout(() => router.replace("/profile"), 1200);
  }

  return (
    <>
      <SiteHeader />
      <main className="page container" id="main-content">
        <div className="center-page">
          <section aria-labelledby="reset-title" className="auth-card" style={{ width: "100%", maxWidth: 520 }}>
            <h2 id="reset-title">Set a new password</h2>
            {!loading && !user ? (
              <Notice actions={<Link className="pill pill-dark pill-sm" href="/sign-in">Request a new link</Link>} title="Reset link required" tone="warning">Open the link from your email to set a new password.</Notice>
            ) : done ? (
              <Notice title="Password updated" tone="success">Taking you to your profileâ€¦</Notice>
            ) : (
              <form className="auth-form" noValidate onSubmit={submit}>
                <label>New password
                  <input autoComplete="new-password" className="input" onChange={(event) => setPassword(event.target.value)} type="password" value={password} />
                  {password && <span className="strength" data-level={passwordScore(password)}><i /><i /><i /><i /></span>}
                </label>
                <label>Confirm password
                  <input autoComplete="new-password" className="input" onChange={(event) => setConfirm(event.target.value)} type="password" value={confirm} />
                </label>
                {fieldError && <FieldError>{fieldError}</FieldError>}
                {error && <Notice title={error.title} tone="error">{error.message}</Notice>}
                <button className="pill pill-dark block" disabled={busy} type="submit">{busy ? "Saving" : "Save password"} <ArrowRight size={15} /></button>
              </form>
            )}
          </section>
        </div>
      </main>
    </>
  );
}
