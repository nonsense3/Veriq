"use client";

import { ArrowRight, Eye, EyeOff, Mail } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { CyberScene } from "@/components/gl/cyber-scene";
import { FieldError, Notice, type Tone } from "@/components/notice";
import { GitHubIcon, GoogleIcon } from "@/components/provider-icons";
import { SiteHeader } from "@/components/site-header";
import { SlidingTabs } from "@/components/sliding-tabs";
import { useAuth } from "@/lib/auth";
import { markFreshSignIn } from "@/lib/devices";
import { passwordScore } from "@/lib/password";
import { authErrorMessage, safeNext, siteOrigin, supabase } from "@/lib/supabase";

type Mode = "signin" | "signup" | "magic" | "reset";

const TITLES: Record<Mode, string> = { signin: "Welcome back", signup: "Create your account", magic: "Sign in with a link", reset: "Reset your password" };

export default function SignInPage() {
  const router = useRouter();
  const { configured, user, loading, providers } = useAuth();
  const [mode, setMode] = useState<Mode>("signin");
  const [next, setNext] = useState("/profile");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fieldError, setFieldError] = useState("");
  const [notice, setNotice] = useState<{ tone: Tone; title: string; message: string } | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setNext(safeNext(params.get("next")));
    if (params.get("mode") === "signup") setMode("signup");
    const error = params.get("error_description");
    if (error) setNotice({ tone: "error", ...authErrorMessage(new Error(error)) });
    try {
      if (window.sessionStorage.getItem("veriq.signedOutRemotely")) {
        window.sessionStorage.removeItem("veriq.signedOutRemotely");
        setNotice({ tone: "info", title: "Signed out from another device", message: "Sign in again to continue." });
      }
    } catch {
      // storage disabled
    }
  }, []);

  useEffect(() => {
    if (!loading && user) router.replace(next);
  }, [loading, user, next, router]);

  function switchMode(value: Mode) {
    setMode(value);
    setFieldError("");
    setNotice(null);
  }

  const callback = () => `${siteOrigin()}/auth/callback?next=${encodeURIComponent(next)}`;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || busy) return;
    setFieldError("");
    setNotice(null);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setFieldError("Enter a valid email address.");
      return;
    }
    if ((mode === "signin" || mode === "signup") && password.length < (mode === "signup" ? 8 : 1)) {
      setFieldError(mode === "signup" ? "Use at least 8 characters for your password." : "Enter your password.");
      return;
    }
    setBusy(true);
    try {
      if (mode === "signin") {
        markFreshSignIn();
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
        router.replace(next);
      } else if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: callback(), data: { display_name: name.trim() || undefined, password_set: true } } });
        if (error) throw error;
        if (data.session) {
          markFreshSignIn();
          router.replace(next);
        }
        else setNotice({ tone: "success", title: "Check your inbox", message: "Open the confirmation link to activate your account." });
      } else if (mode === "magic") {
        const { error } = await supabase.auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo: callback(), shouldCreateUser: true } });
        if (error) throw error;
        setNotice({ tone: "success", title: "Link sent", message: "Open it on this device to sign in." });
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${siteOrigin()}/auth/callback?next=/auth/reset` });
        if (error && !/rate/i.test(error.message)) throw error;
        // Neutral wording: never reveal whether the address has an account.
        setNotice({ tone: "info", title: "If that email has an account", message: "you'll receive a reset link shortly." });
      }
    } catch (error) {
      setNotice({ tone: "error", ...authErrorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  async function oauth(provider: "google" | "github") {
    if (!supabase) return;
    const label = provider === "google" ? "Google" : "GitHub";
    if (providers && !providers.includes(provider)) {
      // Supabase would redirect to a raw JSON error page; explain it here instead.
      setNotice({ tone: "info", title: `${label} sign-in isn't switched on yet`, message: "Use email for now. It's enabled in Supabase under Authentication → Providers." });
      return;
    }
    setBusy(true);
    setNotice(null);
    const { error } = await supabase.auth.signInWithOAuth({ provider, options: { redirectTo: callback() } });
    if (error) {
      setNotice({ tone: "error", ...authErrorMessage(error) });
      setBusy(false);
    }
  }

  const score = passwordScore(password);

  return (
    <>
      <SiteHeader />
      <main className="page container" id="main-content">
        <div className="auth-layout">
          <div className="stage auth-visual">
            <div className="auth-art"><CyberScene align="center" shapes={["lock", "shield"]} size={1.15} /></div>
            <h1>Your reports, everywhere.</h1>
            <p>Accounts are optional. Signing in keeps your reports and on-chain records together.</p>
          </div>

          <section aria-labelledby="auth-title" className="auth-card">
            <SlidingTabs label="Account" onChange={(value) => switchMode(value)} options={[{ value: "signin", label: "Sign in" }, { value: "signup", label: "Create account" }]} style={{ alignSelf: "flex-start" }} value={mode === "signup" ? "signup" : "signin"} />
            <h2 id="auth-title">{TITLES[mode]}</h2>
            <p className="small muted">Read our <Link className="text-link" href="/privacy">Privacy Policy</Link> and <Link className="text-link" href="/terms">Terms of Service</Link> before continuing.</p>

            {loading ? null : !configured ? (
              <Notice actions={<Link className="pill pill-ghost pill-sm" href="/dashboard">Investigate without an account</Link>} title="Accounts aren't set up yet" tone="info">
                This instance has no Supabase project configured. Investigations still work.
              </Notice>
            ) : (
              <>
                {(mode === "signin" || mode === "signup") && (
                  <>
                    <div className="oauth">
                      <button className="pill pill-ghost" disabled={busy} onClick={() => void oauth("google")} type="button"><GoogleIcon /> Continue with Google</button>
                      <button className="pill pill-ghost" disabled={busy} onClick={() => void oauth("github")} type="button"><GitHubIcon /> Continue with GitHub</button>
                    </div>
                    <div className="divider">or with email</div>
                  </>
                )}

                <form className="auth-form" noValidate onSubmit={submit}>
                  {mode === "signup" && (
                    <label>Name
                      <input autoComplete="name" className="input" maxLength={80} onChange={(event) => setName(event.target.value)} placeholder="How should we greet you?" value={name} />
                    </label>
                  )}
                  <label>Email
                    <input aria-invalid={Boolean(fieldError) && !password} autoComplete="email" className="input" onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" type="email" value={email} />
                  </label>
                  {(mode === "signin" || mode === "signup") && (
                    <label>
                      <span className="label-row">
                        Password
                        {mode === "signin" && <button className="text-link small" onClick={() => switchMode("reset")} type="button">Forgot?</button>}
                      </span>
                      <span className="field" style={{ padding: "0 6px 0 16px" }}>
                        <input autoComplete={mode === "signup" ? "new-password" : "current-password"} onChange={(event) => setPassword(event.target.value)} placeholder={mode === "signup" ? "At least 8 characters" : "Your password"} style={{ padding: "13px 0" }} type={show ? "text" : "password"} value={password} />
                        <button aria-label={show ? "Hide password" : "Show password"} className="round round-bare" onClick={() => setShow((value) => !value)} type="button">{show ? <EyeOff size={16} /> : <Eye size={16} />}</button>
                      </span>
                      {mode === "signup" && password && (
                        <span aria-label={`Password strength ${score} of 4`} className="strength" data-level={score}><i /><i /><i /><i /></span>
                      )}
                    </label>
                  )}
                  {fieldError && <FieldError>{fieldError}</FieldError>}
                  <button className="pill pill-dark block" disabled={busy} type="submit">
                    {busy ? "Please wait" : mode === "signin" ? "Sign in" : mode === "signup" ? "Create account" : mode === "magic" ? "Email me a link" : "Send reset link"} <ArrowRight size={15} />
                  </button>
                </form>

                {notice && <Notice title={notice.title} tone={notice.tone}>{notice.message}</Notice>}

                <p className="small muted" style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
                  {mode !== "magic" && <button className="text-link" onClick={() => switchMode("magic")} type="button"><Mail size={12} style={{ verticalAlign: "-1px" }} /> Use a magic link</button>}
                  {mode !== "signin" && <button className="text-link" onClick={() => switchMode("signin")} type="button">Sign in with password</button>}
                  <Link className="text-link" href="/dashboard">Continue without an account</Link>
                </p>
              </>
            )}
          </section>
        </div>
      </main>
    </>
  );
}
