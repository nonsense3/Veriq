import Link from "next/link";
import { Notice } from "@/components/notice";

export default function NotFound() {
  return (
    <main className="container center-page" id="main-content">
      <div className="error-card">
        <span className="code">404</span>
        <h1>This path has no evidence.</h1>
        <Notice actions={<Link className="pill pill-dark pill-sm" href="/">Back to Veriq</Link>} title="Page not found" tone="warning">
          The page doesn't exist or has moved.
        </Notice>
      </div>
    </main>
  );
}
