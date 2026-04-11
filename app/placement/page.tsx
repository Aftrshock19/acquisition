import Link from "next/link";
import { getPlacementState } from "@/app/actions/placement";
import { PlacementFlow } from "@/components/placement/PlacementFlow";

export const dynamic = "force-dynamic";

export default async function PlacementPage() {
  const result = await getPlacementState();

  if (!result.ok) {
    return (
      <main className="app-shell">
        <section className="app-hero">
          <h1 className="app-title">Find your starting point</h1>
        </section>
        <div className="app-card p-8">
          <p>
            {result.error === "not_signed_in"
              ? "Please sign in to take the placement check."
              : `Unable to load placement: ${result.error}`}
          </p>
          <Link href="/today" className="mt-4 inline-block underline">
            Back to today
          </Link>
        </div>
      </main>
    );
  }

  return <PlacementFlow initialState={result.state} />;
}
