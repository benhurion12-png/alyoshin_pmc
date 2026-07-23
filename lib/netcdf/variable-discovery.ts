import type { Candidate, DatasetNode } from "@/types/netcdf";

const TERMS = {
  latitude: ["latitude", "lat"],
  longitude: ["longitude", "lon"],
  radiance: ["radiance", "radiance_band"],
  wavelength: ["wavelength", "lambda"],
} as const;

export function discoverVariables(root: DatasetNode): Candidate[] {
  const found: Candidate[] = [];
  const walk = (node: DatasetNode) => {
    if (node.kind === "dataset") {
      const haystack = `${node.name} ${node.path} ${String(node.attributes?.long_name ?? "")} ${String(node.attributes?.standard_name ?? "")}`.toLowerCase();
      for (const [semanticType, terms] of Object.entries(TERMS)) {
        let score = 0;
        const reasons: string[] = [];
        for (const term of terms) {
          if (node.name.toLowerCase() === term) {
            score += 100;
            reasons.push(`точное имя: ${term}`);
          } else if (haystack.includes(term)) {
            score += 35;
            reasons.push(`метаданные содержат: ${term}`);
          }
        }
        if (node.path.includes("GEOLOCATIONS") && (semanticType === "latitude" || semanticType === "longitude")) {
          score += 25;
          reasons.push("группа GEOLOCATIONS");
        }
        if (score > 0) found.push({ semanticType: semanticType as Candidate["semanticType"], path: node.path, score, reasons, shape: node.shape ?? [] });
      }
    }
    node.children?.forEach(walk);
  };
  walk(root);
  return found.sort((a, b) => b.score - a.score);
}
