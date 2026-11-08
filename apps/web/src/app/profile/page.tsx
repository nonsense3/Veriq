"use client";

import type { UserIdentity } from "@supabase/supabase-js";
import { RISK_LABELS, myInvestigationSchema, type MyInvestigation, type RiskClass } from "@veriq/contracts";
import { ArrowUpRight, Check, KeyRound, Laptop, LogOut, Mail, Monitor, Moon, Pencil, Sun, Trash2, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CyberScene } from "@/components/gl/cyber-scene";
import { FieldError, Notice, type Tone } from "@/components/notice";
import { GitHubIcon, GoogleIcon } from "@/components/provider-icons";
import { RiskBadge } from "@/components/risk";
import { SiteFooter, SiteHeader } from "@/components/site-header";
import { SlidingTabs } from "@/components/sliding-tabs";
import { InlineStatus, useToast } from "@/components/toast";
import { api, ApiError } from "@/lib/api";
import { remember } from "@/lib/history";
import { loadHistorySources } from "@/lib/account-history";
import { useAuth } from "@/lib/auth";
import { deviceId, type Device } from "@/lib/devices";
import { passwordScore } from "@/lib/password";
import { authErrorMessage, siteOrigin, supabase } from "@/lib/supabase";
import { useTheme, type ThemePreference } from "@/lib/theme";

const CLASSES: RiskClass[] = ["confirmed_malicious", "high_risk", "suspicious", "low_risk", "inconclusive"];
const CLASS_COLOR: Record<RiskClass, string> = { confirmed_malicious: "var(--crit-bg)", high_risk: "var(--bad)", suspicious: "var(--warn)", low_risk: "var(--ok)", inconclusive: "var(--unk)" };
const PROVIDERS = [
  { id: "google" as const, label: "Google", icon: <GoogleIcon /> },
  { id: "github" as const, label: "GitHub", icon: <GitHubIcon /> },
];

type Row = { report_id: string; kind: "url" | "message"; subject: string; classification: RiskClass; label: string; findings: number; registry_status: MyInvestigation["registry"]; published: boolean; created_at: string };

const fromRow = (row: Row): MyInvestigation => ({ reportId: row.report_id, kind: row.kind, subject: row.subject, classification: row.classification, label: row.label, createdAt: row.created_at, findings: row.findings, registry: row.registry_status, published: row.published });

function initials(name: string) {
  return name.split(/[\s._-]+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "V";
}

function ago(iso: string) {
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (minutes < 2) return "active now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

const reveal = { initial: { height: 0, opacity: 0 }, animate: { height: "auto", opacity: 1 }, exit: { height: 0, opacity: 0 }, transition: { duration: 0.35, ease: [0.16, 1, 0.3, 1] as const } };

export default function ProfilePage() {
  const router = useRouter();
  const { configured, loading, user, profile, profileTableMissing, providers, refreshProfile, signOut } = useAuth();
  const { preference, set: setTheme } = useTheme();
  const [historyItems, setItems] = useState<MyInvestigation[] | null>(null);
  const historyOwner = useRef<string | null>(null);
  const historyRequest = useRef(0);
  const historyAbort = useRef<AbortController | null>(null);
  const items = historyOwner.current === user?.id ? historyItems : null;
  const [historyLoading, setHistoryLoading] = useState(true);
  const [live, setLive] = useState(false);
  const [historyNote, setHistoryNote] = useState("");
  const [historyLimit, setHistoryLimit] = useState(12);
  const [removeSubmission, setRemoveSubmission] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [identities, setIdentities] = useState<UserIdentity[]>([]);
  const [hasPassword, setHasPassword] = useState<boolean | null>(null);
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [devicesMissing, setDevicesMissing] = useState(false);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const toast = useToast();
  const [inline, setInline] = useState<Record<string, { tone: Tone; text: string }>>({});
  /** Show a short message right under the control it belongs to; success/info clear themselves. */
  const say = useCallback((area: string, tone: Tone, text: string) => {
    setInline((current) => ({ ...current, [area]: { tone, text } }));
    if (tone === "success" || tone === "info") {
      window.setTimeout(() => setInline((current) => {
        if (current[area]?.text !== text) return current;
        const next = { ...current };
        delete next[area];
        return next;
      }), 4500);
    }
  }, []);
  const status = (area: string) => <InlineStatus tone={inline[area]?.tone ?? "info"}>{inline[area]?.text}</InlineStatus>;
  const [password, setPassword] = useState("");
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [passwordError, setPasswordError] = useState("");
  const [otp, setOtp] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [busy, setBusy] = useState("");
  const [confirmEverywhere, setConfirmEverywhere] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteText, setDeleteText] = useState("");

  async function unpublish(reportId: string) {
    if (!user || removing) return;
    const owner = user.id;
    setRemoving(reportId);
    try {
      const updated = await api.unpublish(reportId);
      if (historyOwner.current !== owner) return;
      historyRequest.current++;
      historyAbort.current?.abort();
      setHistoryLoading(false);
      setItems((current) => current?.map((item) => item.reportId === reportId ? { ...item, published: false } : item) ?? null);
      remember(updated);
      setRemoveSubmission(null);
      say("repository", "success", "Removed from the online repository. Your private investigation and blockchain fingerprint are unchanged.");
    } catch (caught) {
      if (historyOwner.current === owner) say("repository", "error", caught instanceof ApiError ? caught.error.message : "Removal could not be confirmed. Please retry.");
    } finally { setRemoving(null); }
  }

  useEffect(() => {
    if (!loading && configured && !user) router.replace("/sign-in?next=/profile");
  }, [loading, configured, user, router]);

  const loadIdentities = useCallback(async () => {
    if (!supabase) return;
    const { data } = await supabase.auth.getUserIdentities();
    setIdentities(data?.identities ?? []);
    const status = await supabase.rpc("my_auth_status");
    if (!status.error && Array.isArray(status.data) && status.data[0]) setHasPassword(Boolean((status.data[0] as { has_password: boolean }).has_password));
    else setHasPassword(null);
  }, []);

  /** History: realtime rows from Supabase, merged with anything the scanner holds for this account. */
  const loadHistory = useCallback(async () => {
    const client = supabase;
    const ownerId = user?.id;
    if (!client || !ownerId) return;
    const generation = ++historyRequest.current;
    historyAbort.current?.abort();
    const controller = new AbortController();
    historyAbort.current = controller;
    if (historyOwner.current !== ownerId) setItems(null);
    historyOwner.current = ownerId;
    setHistoryLoading(true);
    setHistoryNote("");
    await loadHistorySources({
      database: async () => {
        const db = await client.from("investigations").select("report_id, kind, subject, classification, label, findings, registry_status, published, created_at").eq("owner_id", ownerId).order("created_at", { ascending: false }).limit(200).abortSignal(controller.signal);
        if (db.error) throw new Error("History database unavailable");
        return ((db.data ?? []) as Row[]).map(row => myInvestigationSchema.parse(fromRow(row)));
      },
      scanner: async () => {
        const result = await api.mine(controller.signal);
        if (result.user.id !== ownerId) throw new Error("History account mismatch");
        return result.items;
      },
    }, result => {
      if (generation !== historyRequest.current || historyOwner.current !== ownerId) return;
      setItems(current => result.available ? result.items : current);
      setHistoryLoading(result.loading);
      setHistoryNote(result.note);
    });
    controller.abort();
  }, [user?.id]);

  const loadDevices = useCallback(async () => {
    if (!supabase) return;
    const { data, error } = await supabase.from("user_devices").select("id, device_id, label, user_agent, created_at, last_seen_at, revoked_at").order("last_seen_at", { ascending: false });
    setDevicesMissing(Boolean(error));
    setDevices(error ? [] : ((data ?? []) as Device[]).filter((device) => !device.revoked_at));
  }, []);

  useEffect(() => {
    const client = supabase;
    if (!user || !client) return;
    void loadIdentities();
    void loadHistory();
    void loadDevices();
    const channel = client
      .channel(`profile-${user.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "investigations", filter: `owner_id=eq.${user.id}` }, () => void loadHistory())
      .on("postgres_changes", { event: "*", schema: "public", table: "user_devices", filter: `user_id=eq.${user.id}` }, () => void loadDevices())
      .subscribe((status) => setLive(status === "SUBSCRIBED"));
    return () => {
      historyRequest.current++;
      historyAbort.current?.abort();
      void client.removeChannel(channel);
    };
  }, [user, loadIdentities, loadHistory, loadDevices]);

  const displayName = profile?.display_name || user?.email?.split("@")[0] || "Investigator";
  const totals = useMemo(() => {
    const byClass: Record<string, number> = {};
    for (const item of items ?? []) byClass[item.classification] = (byClass[item.classification] ?? 0) + 1;
    return {
      investigations: items?.length ?? 0,
      threats: (byClass.confirmed_malicious ?? 0) + (byClass.high_risk ?? 0) + (byClass.suspicious ?? 0),
      registered: items?.filter((item) => item.registry === "confirmed").length ?? 0,
      published: items?.filter((item) => item.published).length ?? 0,
      byClass,
    };
  }, [items]);
  const days = useMemo(() => {
    const buckets = Array.from({ length: 14 }, () => 0);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    for (const item of items ?? []) {
      const created = new Date(item.createdAt);
      created.setHours(0, 0, 0, 0);
      const age = Math.round((today.getTime() - created.getTime()) / 86_400_000);
      if (age >= 0 && age < 14) buckets[13 - age]! += 1;
    }
    return buckets;
  }, [items]);
  const peak = Math.max(1, ...days);

  async function saveName(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !user) return;
    const value = name.trim().slice(0, 80);
    if (!value) return;
    setBusy("name");
    const { error } = profileTableMissing ? await supabase.auth.updateUser({ data: { display_name: value } }) : await supabase.from("profiles").upsert({ id: user.id, display_name: value });
    setBusy("");
    if (error) return say("name", "error", authErrorMessage(error).title);
    setEditing(false);
    await refreshProfile();
    say("name", "success", "Name updated");
  }

  async function chooseTheme(value: ThemePreference) {
    setTheme(value);
    if (supabase && user && !profileTableMissing) await supabase.from("profiles").upsert({ id: user.id, theme: value });
  }

  function closePassword() {
    setPasswordOpen(false);
    setPassword("");
    setOtp("");
    setOtpSent(false);
    setPasswordError("");
  }

  async function savePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !user) return;
    setPasswordError("");
    if (password.length < 8) return setPasswordError("Use at least 8 characters.");
    if (!user.email) return setPasswordError("This account has no email address to verify.");
    setBusy("password");
    if (!otpSent) {
      const { error } = await supabase.auth.reauthenticate();
      setBusy("");
      if (error) {
        const message = authErrorMessage(error);
        return say("password", "error", `${message.title}. ${message.message}`);
      }
      setOtpSent(true);
      return say("password", "info", `Enter the code sent to ${user.email}.`);
    }
    if (!/^\d{6,8}$/.test(otp.trim())) {
      setBusy("");
      return setPasswordError("Enter the code from that email.");
    }
    const { error } = await supabase.auth.updateUser({ password, nonce: otp.trim(), data: { password_set: true } });
    setBusy("");
    if (error) {
      const message = authErrorMessage(error);
      return say("password", "error", `${message.title}. ${message.message}`);
    }
    setPassword("");
    setOtp("");
    setOtpSent(false);
    setPasswordOpen(false);
    setHasPassword(true);
    say("password", "success", "Password saved after email verification.");
  }

  async function connect(provider: "google" | "github") {
    if (!supabase) return;
    if (providers && !providers.includes(provider)) return say(provider, "info", "Not enabled in Supabase yet.");
    setBusy(provider);
    const { data, error } = await supabase.auth.linkIdentity({ provider, options: { redirectTo: `${siteOrigin()}/auth/callback?next=/profile` } });
    if (error) {
      setBusy("");
      const message = authErrorMessage(error);
      return say(provider, "error", `${message.title}. ${message.message}`);
    }
    // supabase-js redirects to the provider itself; this is only a fallback if it didn't.
    if (data?.url) window.setTimeout(() => window.location.assign(data.url), 600);
  }

  async function disconnect(identity: UserIdentity) {
    if (!supabase) return;
    const label = identity.provider === "github" ? "GitHub" : identity.provider === "google" ? "Google" : identity.provider;
    if (identities.length < 2) return say(identity.provider, "warning", hasPassword ? "This is your only linked provider, so it can't be removed." : "Set a password or connect another provider first.");
    setBusy(identity.provider);
    const { error } = await supabase.auth.unlinkIdentity(identity);
    setBusy("");
    if (error) return say(identity.provider, "error", authErrorMessage(error).title);
    await loadIdentities();
    say(identity.provider, "success", `${label} disconnected`);
  }

  async function revokeDevice(device: Device) {
    if (!supabase) return;
    if (device.device_id === deviceId()) {
      setBusy("local");
      await signOut("local");
      router.replace("/");
      return;
    }
    setBusy(device.id);
    const { error } = await supabase.from("user_devices").update({ revoked_at: new Date().toISOString() }).eq("id", device.id);
    setBusy("");
    if (error) return say("devices", "error", "Couldn't sign that device out. Try again.");
    say("devices", "success", `${device.label} signed out`);
    void loadDevices();
  }

  async function signOutEverywhere() {
    if (!supabase || !user) return;
    setBusy("global");
    await supabase.from("user_devices").update({ revoked_at: new Date().toISOString() }).eq("user_id", user.id);
    await signOut("global");
    router.replace("/");
  }

  async function deleteAccount() {
    if (!supabase || deleteText !== "DELETE") return;
    setBusy("delete");
    try {
      await api.forgetMe();
    } catch {
      // The scanner copy is best-effort; the account deletion below is what matters.
    }
    const { error } = await supabase.rpc("delete_my_account");
    if (error) {
      setBusy("");
      const missing = /function|does not exist|PGRST202/i.test(`${error.code} ${error.message}`);
      return toast.show(missing
        ? { tone: "error", title: "Account deletion isn't set up", message: "Run the realtime/devices/deletion migration, then try again." }
        : { tone: "error", title: "Account not deleted", message: "Something went wrong and nothing was removed. Try again." });
    }
    await signOut("local");
    try {
      window.localStorage.removeItem("veriq.history.v1");
    } catch {
      // ignore
    }
    toast.show({ tone: "success", title: "Account deleted", message: "Your profile, history and devices were removed." });
    router.replace("/");
  }

  if (!configured) {
    return (
      <>
        <SiteHeader />
        <main className="page container" id="main-content">
          <div className="center-page">
            <div className="error-card">
              <h1>Profile</h1>
              <Notice actions={<Link className="pill pill-dark pill-sm" href="/dashboard">Investigate</Link>} title="Accounts aren't set up yet" tone="info">This instance has no Supabase project configured.</Notice>
            </div>
          </div>
        </main>
      </>
    );
  }
  if (loading || !user) {
    return (
      <>
        <SiteHeader />
        <main className="page container" id="main-content"><p className="card muted" role="status">Loading your profile…</p></main>
      </>
    );
  }

  const thisDevice = deviceId();
  const latest = items?.[0];
  const oauthOnly = hasPassword === false;

  return (
    <>
      <SiteHeader />
      <main className="page container" id="main-content">

        <section aria-labelledby="profile-name" className="profile-hero">
          <div className="identity">
            <div className="avatar">
              <span aria-hidden="true" className="avatar-ring" />
              <span aria-hidden="true" className="initials">{initials(displayName)}</span>
              {profile?.avatar_url && /^https:\/\//.test(profile.avatar_url) && <img alt="" referrerPolicy="no-referrer" src={profile.avatar_url} />}
            </div>
            <div style={{ minWidth: 0 }}>
              <span className="eyebrow">Your profile</span>
              {editing ? (
                <form className="name-edit" onSubmit={saveName}>
                  <label className="sr-only" htmlFor="display-name">Display name</label>
                  <input autoFocus className="input" id="display-name" maxLength={80} onChange={(event) => setName(event.target.value)} value={name} />
                  <button aria-label="Save name" className="round" disabled={busy === "name"} type="submit"><Check size={16} /></button>
                  <button aria-label="Cancel" className="round" onClick={() => setEditing(false)} type="button"><X size={16} /></button>
                </form>
              ) : (
                <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 6 }}>
                  <h1 className="wrap" id="profile-name">{displayName}</h1>
                  <button aria-label="Edit name" className="round" onClick={() => { setName(displayName); setEditing(true); }} type="button"><Pencil size={15} /></button>
                </div>
              )}
              {status("name")}
              <div className="meta-chips">
                <span className="meta-chip"><Mail size={13} /> {user.email}</span>
                <span className="meta-chip"><span>Member since</span> {new Date(user.created_at).toLocaleDateString([], { month: "short", year: "numeric" })}</span>
                {live && <span className="meta-chip"><span className="live-dot" /> Live</span>}
              </div>
            </div>
          </div>
          <div className="stage mini-stage">
            <CyberScene align="top" shapes={["fingerprint", "shield"]} />
            <span className="eyebrow" style={{ color: "rgba(255,255,255,.75)" }}>Latest verdict</span>
            <div style={{ display: "grid", gap: 12 }}>
              <strong className="wrap" style={{ fontSize: "clamp(1.6rem, 2.6vw, 2.3rem)", fontWeight: 400, letterSpacing: "-0.03em", lineHeight: 1.05 }}>{latest ? latest.subject : historyLoading ? "Loading investigations…" : !items ? "History unavailable" : "No investigations yet"}</strong>
              <span style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                {latest && <RiskBadge classification={latest.classification} label={latest.label} />}
                <Link className="pill pill-light pill-sm" href={latest ? `/report?id=${latest.reportId}` : "/dashboard"}>{latest ? "Open" : "Start one"} <ArrowUpRight size={13} /></Link>
              </span>
            </div>
          </div>
        </section>

        <div className="stats">
          {([["Investigations", totals.investigations], ["Threats found", totals.threats], ["Sealed on-chain", totals.registered], ["Shared", totals.published]] as const).map(([label, value]) => (
            <div className="stat" key={label}>
              {label === "Investigations" ? <>
                <a className="mobile-stat-jump" href="#your-investigations" onClick={() => window.requestAnimationFrame(() => document.getElementById("your-investigations")?.focus({ preventScroll: true }))}>
                  <span className="eyebrow">{label}</span><strong>{items ? value : "–"}</strong><span className="muted small">View your investigations ↓</span>
                </a>
                <div className="desktop-stat-label"><span className="eyebrow">{label}</span><strong>{items ? value : "–"}</strong></div>
              </> : <><span className="eyebrow">{label}</span><strong>{items ? value : "–"}</strong></>}
            </div>
          ))}
        </div>

        <div className="layout-main" style={{ marginTop: 10 }}>
          <div className="stack">
            <section aria-labelledby="dist-title" className="card">
              <div className="card-head"><h2 id="dist-title">Risk mix</h2><span className="muted small">All time</span></div>
              <div aria-hidden="true" className="dist">
                {CLASSES.map((risk) => <i key={risk} style={{ width: `${totals.investigations ? ((totals.byClass[risk] ?? 0) / totals.investigations) * 100 : 0}%`, background: CLASS_COLOR[risk] }} />)}
              </div>
              <div className="legend">
                {CLASSES.map((risk) => (
                  <div key={risk}><span><span className="swatch" style={{ background: CLASS_COLOR[risk] }} />{RISK_LABELS[risk]}</span><b>{items ? totals.byClass[risk] ?? 0 : "–"}</b></div>
                ))}
              </div>
            </section>

            <section aria-labelledby="activity-title" className="card">
              <div className="card-head"><h2 id="activity-title">Activity</h2><span className="muted small">Last 14 days</span></div>
              <div aria-label={`${days.reduce((sum, value) => sum + value, 0)} investigations in the last 14 days`} className="spark" role="img">
                {days.map((value, index) => <i data-zero={value === 0} key={index} style={{ height: `${Math.max(4, (value / peak) * 100)}%` }} title={`${value}`} />)}
              </div>
            </section>

            <section aria-labelledby="mine-title" className="card" id="your-investigations" tabIndex={-1}>
              <div className="card-head" style={{ flexWrap: "wrap" }}><h2 id="mine-title">Your investigations</h2><div style={{ display: "flex", gap: 8 }}><button className="pill pill-ghost pill-sm" disabled={historyLoading} onClick={() => void loadHistory()} type="button">{historyLoading ? "Syncing…" : "Refresh"}</button><Link className="pill pill-ghost pill-sm" href="/dashboard">New</Link></div></div>
              {historyNote && <p className="muted small" role="status" style={{ marginBottom: 10 }}>{historyNote}</p>}
              {status("repository")}
              {!items ? <p className="muted small" role="status">{historyLoading ? "Loading…" : "History is unavailable. Use Refresh to try again."}</p> : items.length === 0 ? (
                <p className="empty">{historyLoading ? "Checking the remaining history source…" : historyNote ? "No entries were returned by the available history source." : "Investigations you run while signed in appear here."}</p>
              ) : (
                <div className="list-rows">
                  {items.slice(0, historyLimit).map((item) => (
                    <div className="owned-investigation" key={item.reportId}>
                    <Link href={`/report?id=${item.reportId}`}>
                      <span style={{ minWidth: 0 }}>
                        <span className="title wrap">{item.subject}</span>
                        <br />
                        <span className="muted small">{new Date(item.createdAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}{item.registry === "confirmed" ? " · sealed" : ""}{item.published ? " · shared" : ""}</span>
                      </span>
                      <RiskBadge classification={item.classification} label={item.label} />
                    </Link>
                    {item.published && (removeSubmission === item.reportId ? <Notice title="Remove this public submission?" tone="warning" actions={<>
                      <button className="pill pill-dark pill-sm" type="button" disabled={Boolean(removing)} onClick={() => void unpublish(item.reportId)}>{removing === item.reportId ? "Removing…" : "Remove from repository"}</button>
                      <button className="pill pill-ghost pill-sm" type="button" disabled={Boolean(removing)} onClick={() => setRemoveSubmission(null)}>Cancel</button>
                    </>}>This removes the online incident, public note and community reviews. Your private investigation stays available. The blockchain fingerprint cannot be deleted.</Notice> : <button className="text-link remove-submission" type="button" disabled={Boolean(removing)} onClick={() => setRemoveSubmission(item.reportId)}><Trash2 size={13} /> Remove from repository</button>)}
                    </div>
                  ))}
                  {items.length > historyLimit && <button className="pill pill-ghost pill-sm" type="button" onClick={() => setHistoryLimit((value) => value + 12)}>Show more investigations</button>}
                </div>
              )}
            </section>
          </div>

          <aside className="stack">
            <section aria-labelledby="signin-title" className="card">
              <div className="card-head"><h2 id="signin-title">Sign-in methods</h2></div>
              {oauthOnly && !passwordOpen && (
                <div style={{ marginBottom: 12 }}>
                  <Notice actions={<button className="pill pill-dark pill-sm" onClick={() => setPasswordOpen(true)} type="button"><KeyRound size={13} /> Set password</button>} title="No password set" tone="warning">
                    You signed up with {identities[0]?.provider === "google" ? "Google" : "GitHub"}. Add a password so you can still sign in with your email.
                  </Notice>
                </div>
              )}
              <div>
                <div className="provider">
                  <span className="who"><span className="logo"><Mail size={16} /></span> Email & password</span>
                  {hasPassword ? (
                    <span className="d-pill d-clear">Password set</span>
                  ) : hasPassword === false ? (
                    <span className="d-pill d-concern">No password</span>
                  ) : (
                    <span className="d-pill d-unavailable">Unknown</span>
                  )}
                </div>
                {PROVIDERS.map((provider) => {
                  const identity = identities.find((item) => item.provider === provider.id);
                  const enabled = !providers || providers.includes(provider.id);
                  return (
                    <div className="provider-block" key={provider.id}>
                    <div className="provider">
                      <span className="who"><span className="logo">{provider.icon}</span> {provider.label}</span>
                      {identity ? (
                        <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
                          <span className="d-pill d-clear">Connected</span>
                          <button aria-label={`Remove ${provider.label}`} className="round round-sm" disabled={busy === provider.id} onClick={() => void disconnect(identity)} type="button"><X size={14} /></button>
                        </span>
                      ) : enabled ? (
                        <button className="pill pill-dark pill-sm" disabled={busy === provider.id} onClick={() => void connect(provider.id)} type="button">{busy === provider.id ? "Opening" : "Connect"}</button>
                      ) : (
                        <span className="d-pill d-unavailable">Not enabled</span>
                      )}
                    </div>
                    {status(provider.id)}
                    </div>
                  );
                })}
              </div>
              <AnimatePresence initial={false}>
                {passwordOpen && (
                  <motion.form {...reveal} className="auth-form" noValidate onSubmit={savePassword} style={{ overflow: "hidden" }}>
                    <label style={{ marginTop: 14 }}>{hasPassword ? "New password" : "Create a password"}
                      <input autoComplete="new-password" className="input" onChange={(event) => setPassword(event.target.value)} type="password" value={password} />
                      {password && <span className="strength" data-level={passwordScore(password)}><i /><i /><i /><i /></span>}
                    </label>
                    {otpSent && (
                      <label>Email code
                        <input autoComplete="one-time-code" className="input" inputMode="numeric" onChange={(event) => setOtp(event.target.value)} value={otp} />
                      </label>
                    )}
                    {passwordError && <FieldError>{passwordError}</FieldError>}
                    <div style={{ display: "flex", gap: 8 }}>
                      <button className="pill pill-dark pill-sm" disabled={busy === "password"} type="submit"><KeyRound size={13} /> {otpSent ? "Verify and save" : "Email a code"}</button>
                      <button className="pill pill-ghost pill-sm" onClick={closePassword} type="button">Cancel</button>
                    </div>
                  </motion.form>
                )}
              </AnimatePresence>
              {status("password")}
              {!passwordOpen && hasPassword && <button className="text-link small" onClick={() => setPasswordOpen(true)} style={{ marginTop: 12 }} type="button">Change password</button>}
            </section>

            <section aria-labelledby="devices-title" className="card">
              <div className="card-head"><h2 id="devices-title">Devices</h2><span className="muted small">{devices?.length ?? 0} signed in</span></div>
              {devicesMissing ? (
                <Notice title="Device list not set up" tone="info">Run the Supabase migration to see and manage devices.</Notice>
              ) : (
                <div>
                  {(devices ?? []).map((device) => {
                    const current = device.device_id === thisDevice;
                    return (
                      <div className="provider" key={device.id}>
                        <span className="who">
                          <span className="logo"><Laptop size={16} /></span>
                          <span>{device.label}{current && <span className="tag" style={{ marginLeft: 6 }}>This device</span>}<br /><span className="muted small">{current ? "active now" : ago(device.last_seen_at)}</span></span>
                        </span>
                        <button className="pill pill-ghost pill-sm" disabled={Boolean(busy)} onClick={() => void revokeDevice(device)} type="button"><LogOut size={12} /> Sign out</button>
                      </div>
                    );
                  })}
                  {status("devices")}
                  {devices === null && <p className="muted small">Loading devices…</p>}
                  {devices?.length === 0 && <p className="muted small">This device will appear here after it registers.</p>}
                </div>
              )}
              <AnimatePresence initial={false} mode="wait">
                {confirmEverywhere ? (
                  <motion.div {...reveal} key="confirm" style={{ overflow: "hidden" }}>
                    <div style={{ marginTop: 12 }}>
                      <Notice
                        actions={<>
                          <button className="pill pill-dark pill-sm" disabled={busy === "global"} onClick={() => void signOutEverywhere()} type="button">Sign out everywhere</button>
                          <button className="pill pill-ghost pill-sm" onClick={() => setConfirmEverywhere(false)} type="button">Cancel</button>
                        </>}
                        title="Sign out of every device?"
                        tone="warning"
                      >
                        This includes this browser. You'll need to sign in again.
                      </Notice>
                    </div>
                  </motion.div>
                ) : (
                  <motion.button {...reveal} className="text-link small" key="ask" onClick={() => setConfirmEverywhere(true)} style={{ marginTop: 12, display: "block" }} type="button">Sign out of all devices…</motion.button>
                )}
              </AnimatePresence>
            </section>

            <section aria-labelledby="pref-title" className="card">
              <div className="card-head"><h2 id="pref-title">Appearance</h2></div>
              <SlidingTabs className="segmented" label="Theme" onChange={(value) => void chooseTheme(value)} options={[{ value: "system", label: <><Monitor size={14} /> System</> }, { value: "light", label: <><Sun size={14} /> Light</> }, { value: "dark", label: <><Moon size={14} /> Dark</> }]} value={preference} variant="toggle" />
            </section>

            <section aria-labelledby="danger-title" className="card danger-card">
              <div className="card-head"><h2 id="danger-title">Delete account</h2></div>
              <p className="muted small">Removes your profile, history, devices and sign-in methods. Reports you shared stay in the repository without your name, because their fingerprints are already on-chain.</p>
              <AnimatePresence initial={false} mode="wait">
                {deleteOpen ? (
                  <motion.div {...reveal} key="confirm" style={{ overflow: "hidden" }}>
                    <div className="auth-form" style={{ marginTop: 12 }}>
                      <label>Type DELETE to confirm
                        <input autoComplete="off" className="input" onChange={(event) => setDeleteText(event.target.value)} value={deleteText} />
                      </label>
                      <div style={{ display: "flex", gap: 8 }}>
                        <button className="pill pill-danger pill-sm" disabled={deleteText !== "DELETE" || busy === "delete"} onClick={() => void deleteAccount()} type="button"><Trash2 size={13} /> {busy === "delete" ? "Deleting" : "Delete forever"}</button>
                        <button className="pill pill-ghost pill-sm" onClick={() => { setDeleteOpen(false); setDeleteText(""); }} type="button">Cancel</button>
                      </div>
                    </div>
                  </motion.div>
                ) : (
                  <motion.button {...reveal} className="pill pill-ghost pill-sm danger-outline" key="open" onClick={() => setDeleteOpen(true)} style={{ marginTop: 12 }} type="button"><Trash2 size={13} /> Delete my account</motion.button>
                )}
              </AnimatePresence>
            </section>

            {profileTableMissing && <Notice title="Profile table missing" tone="info">Run the Supabase migrations to store profiles. Your name is saved to your account for now.</Notice>}
          </aside>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
