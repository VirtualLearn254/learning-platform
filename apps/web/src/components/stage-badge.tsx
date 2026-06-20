import type { BeatStage } from "@lp/shared";
import { Badge } from "@/components/ui/badge";

const LABELS: Record<BeatStage, string> = {
  queued:        "Queued",
  ingested:      "Outlined",
  authoring:     "Authoring",
  ai_review:     "AI review",
  human_review:  "Needs review",
  revising:      "Revising",
  rendering:     "Rendering",
  approved:      "Approved",
  stitched:      "Stitched",
  published:     "Published",
};

export function StageBadge({ stage }: { stage: BeatStage }) {
  return <Badge variant={stage}>{LABELS[stage]}</Badge>;
}
