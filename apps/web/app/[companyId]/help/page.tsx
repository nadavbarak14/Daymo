import { notFound } from "next/navigation";
import { getConfig } from "../../../lib/blob.js";
import { isValidCompanyId } from "../../../lib/company-id.js";
import { ChatPanel } from "../../../components/ChatPanel.js";

export default async function HelpPage({
  params,
  searchParams,
}: {
  params: Promise<{ companyId: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const { companyId } = await params;
  const { q } = await searchParams;
  if (!isValidCompanyId(companyId)) notFound();
  const config = await getConfig(companyId);
  if (!config) notFound();

  const brand = config.brandColor ?? "#2563eb";

  return (
    <main style={{ maxWidth: "720px", margin: "0 auto", padding: "2rem 1.5rem" }}>
      <header style={{ borderBottom: `2px solid ${brand}`, paddingBottom: "1rem", marginBottom: "1.5rem" }}>
        <h1 style={{ margin: 0, fontSize: "1.75rem" }}>{config.name} — Product Manual</h1>
        <p style={{ color: "#666", margin: "0.5rem 0 0" }}>Ask me anything about {config.name}. I'll show you how.</p>
      </header>

      <ChatPanel
        companyId={companyId}
        suggestedQuestions={config.suggestedQuestions}
        initialQuery={q}
      />

      <footer style={{ marginTop: "3rem", textAlign: "center", color: "#aaa", fontSize: "0.75rem" }}>
        powered by <a href="https://daymo.dev" style={{ color: "#aaa" }}>daymo</a>
      </footer>
    </main>
  );
}

export const dynamic = "force-dynamic";
