"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Notice } from "@/components/notice";
import { SiteHeader } from "@/components/site-header";
import { markFreshSignIn } from "@/lib/devices";
import { authErrorMessage, loadAuthConfig, safeNext, supabase } from "@/lib/supabase";

/**
 * OAuth, magic-link, confirmation and recovery redirects land here. supabase-js (PKCE, detectSessionInUrl)
 * exchanges the `code` parameter on load; this page waits for the session and forwards to a safe local path.
 */
export default function AuthCallbackPage() {
  const router = useRouter();
  const [error, setError] = useState<{ title: string; message: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: () => void = () => {};
    let timeout = 0;
    void loadAuthConfig().then((ready) => {
      if (cancelled) return;
      const client = supabase;
      if (!ready || !client) {
        setError({ title: "Accounts aren't set up", message: "This instance has no Supabase project configured." });
        return;
      }
      continueSignIn(client);
    });

    function continueSignIn(client: NonNullable<typeof supabase>) {
    const params = new URLSearchParams(window.location.search);
    const hash = new URLSearchParams(window.location.hash.slice(1));
    const failure = params.get("error_description") ?? hash.get("error_description");
    if (failure) {
      setError(authErrorMessage(new Error(failure)));
      return;
    }
    let done = false;
    timeout = window.setTimeout(() => {
      if (!cancelled && !done) setError({ title: "This link didn't work", message: "It may have expired or been opened in a different browser. Request a new one." });
    }, 9000);
    // Mark before the session lands so this device's old revocation (if any) is cleared, not enforced.
    markFreshSignIn();
    const next = safeNext(params.get("next"));
    const go = (path: string) => {
      if (done) return;
      done = true;
      router.replace(path);
    };
    const { data } = client.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY") go("/auth/reset");
      else if (session) go(next);
    });
    unsubscribe = () => data.subscription.unsubscribe();
    void client.auth.getSession().then(({ data: current }) => {
      if (current.session) go(next);
    });
    }

    return () => {
      cancelled = true;
      unsubscribe();
      window.clearTimeout(timeout);
    };
  }, [router]);

  return (
    <>
      <SiteHeader />
      <main className="page container" id="main-content">
        <div className="center-page">
          <div className="error-card">
            {error ? (
              <Notice actions={<Link className="pill pill-dark pill-sm" href="/sign-in">Back to sign in</Link>} title={error.title} tone="error">{error.message}</Notice>
            ) : (
              <Notice title="Signing you in" tone="info">One moment…</Notice>
            )}
          </div>
        </div>
      </main>
    </>
  );
}
