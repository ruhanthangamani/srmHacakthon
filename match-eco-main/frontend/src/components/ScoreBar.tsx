import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface ScoreBarProps {
  score: number;
  subScores?: {
    material_match?: number;
    distance?: number;
    quantity?: number;
    cost?: number;
  };
}

export function ScoreBar({ score, subScores }: ScoreBarProps) {
  const getColor = (score: number) => {
    if (score >= 80) return 'bg-accent';
    if (score >= 60) return 'bg-warning';
    return 'bg-destructive';
  };

  const content = (
    <div className="flex items-center gap-2 w-full">
      <div className="flex-1 bg-muted rounded-full h-2 overflow-hidden">
        <div 
          className={`h-full transition-all ${getColor(score)}`}
          style={{ width: `${score}%` }}
        />
      </div>
      <span className="text-sm font-medium min-w-[3rem] text-right">{score.toFixed(0)}%</span>
    </div>
  );

  if (!subScores) {
    return content;
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="cursor-help">{content}</div>
        </TooltipTrigger>
        <TooltipContent>
          <div className="space-y-1 text-xs">
            {subScores.material_match !== undefined && (
              <div>Material Match: {subScores.material_match.toFixed(0)}%</div>
            )}
            {subScores.distance !== undefined && (
              <div>Distance: {subScores.distance.toFixed(0)}%</div>
            )}
            {subScores.quantity !== undefined && (
              <div>Quantity: {subScores.quantity.toFixed(0)}%</div>
            )}
            {subScores.cost !== undefined && (
              <div>Cost: {subScores.cost.toFixed(0)}%</div>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
