"use client";

import { useState } from "react";
import { provisionMyCollection } from "./actions";

/**
 * One-click new-collection provisioning (COB-812 production beta).
 * Calls the transactional server action; on success the user's own collection
 * identity exists and they can import immediately.
 */
export function ProvisionForm() {
  const [result, setResult] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setPending(true);
        setResult(null);
        try {
          const res = await provisionMyCollection();
          setResult(res.message);
          if (res.ok) {
            setTimeout(() => {
              window.location.href = "/import";
            }, 800);
          }
        } finally {
          setPending(false);
        }
      }}
    >
      <button type="submit" className="button" disabled={pending}>
        {pending ? "Creating…" : "Create my collection"}
      </button>
      {result && <p>{result}</p>}
    </form>
  );
}
