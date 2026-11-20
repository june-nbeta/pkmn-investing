import { Navigation } from "@/components/Navigation";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { ProvisionForm } from "./provision-form";

/**
 * New-user collection provisioning page (COB-812 production beta).
 * Brand-new accounts land here after signup: one click creates their own fresh,
 * empty collection identity. No claim token. Binding to a PRE-EXISTING legacy
 * users row remains exclusive to /claim with an operator-issued token.
 */
export default async function ProvisionPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  return (
    <div className="page">
      <Navigation />
      <main className="main">
        <h1>Create your collection</h1>
        <p>
          One click creates a fresh collection identity for your account — your cards
          stay isolated to your own collection. Existing collections can only be claimed
          with an operator-issued token.
        </p>
        <ProvisionForm />
      </main>
    </div>
  );
}
