import StepWizard from "@/components/StepWizard";

export const dynamic = "force-dynamic";

export default function GuidePage() {
  return (
    <main className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-6xl py-10">
        <StepWizard />
      </div>
    </main>
  );
}
