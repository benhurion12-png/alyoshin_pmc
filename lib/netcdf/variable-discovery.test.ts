import { describe, expect, it } from "vitest";
import { discoverVariables } from "./variable-discovery";

describe("discoverVariables", () => {
  it("scores geolocation datasets dynamically", () => {
    const candidates = discoverVariables({
      name: "/", path: "/", kind: "group", children: [{
        name: "GEOLOCATIONS", path: "/PRODUCT/SUPPORT_DATA/GEOLOCATIONS", kind: "group", children: [
          { name: "latitude", path: "/PRODUCT/SUPPORT_DATA/GEOLOCATIONS/latitude", kind: "dataset", shape: [1, 10, 5] },
        ],
      }],
    });
    expect(candidates[0].semanticType).toBe("latitude");
    expect(candidates[0].score).toBeGreaterThan(100);
  });
});
