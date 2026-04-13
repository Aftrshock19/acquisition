import { redirect } from "next/navigation";
import { IntroFlow } from "@/components/onboarding/IntroFlow";
import { getOnboardingState } from "@/lib/onboarding/state";
import { decideOnboardingGate } from "@/lib/onboarding/gate";

export const dynamic = "force-dynamic";

type OnboardingPageProps = {
  searchParams?: Promise<{ replay?: string }>;
};

export default async function OnboardingPage({
  searchParams,
}: OnboardingPageProps) {
  const params = (await searchParams) ?? {};
  const replay = params.replay === "1";

  const state = await getOnboardingState();

  if (!state.signedIn) {
    redirect("/login?next=/onboarding");
  }

  // Replay mode lets already-onboarded users revisit the intro from their
  // profile, so we deliberately skip the usual "you're done — go home" gate.
  if (!replay && decideOnboardingGate(state).action === "allow") {
    redirect("/");
  }

  return <IntroFlow replay={replay} />;
}
