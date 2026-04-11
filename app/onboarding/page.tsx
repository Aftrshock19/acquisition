import { redirect } from "next/navigation";
import { IntroFlow } from "@/components/onboarding/IntroFlow";
import { getOnboardingState } from "@/lib/onboarding/state";
import { decideOnboardingGate } from "@/lib/onboarding/gate";

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const state = await getOnboardingState();

  if (!state.signedIn) {
    redirect("/login?next=/onboarding");
  }

  if (decideOnboardingGate(state).action === "allow") {
    redirect("/today");
  }

  return <IntroFlow />;
}
