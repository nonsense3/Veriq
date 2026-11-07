"use client";

import { RotateCcw } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";
import { Notice } from "@/components/notice";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <main className="container center-page" id="main-content">
      <div className="error-card">
        <h1>This view broke.</h1>
        <Notice
          actions={
            <>
              <button className="pill pill-dark pill-sm" onClick={reset} type="button"><RotateCcw size={13} /> Try again</button>
              <Link className="pill pill-ghost pill-sm" href="/">Home</Link>
            </>
          }
          reference={error.digest}
          title="Something went wrong on this page"
          tone="error"
        >
          Nothing was marked safe or deleted. Reload to continue.
        </Notice>
      </div>
    </main>
  );
}
