import { describe, expect, it } from "vitest";
import { connectedComponents } from "./morphology";

describe("connectedComponents", () => {
  it("uses 8-neighbour connectivity", () => {
    const components = connectedComponents(new Uint8Array([
      1, 0, 0,
      0, 1, 0,
      0, 0, 1,
    ]), 3, 3);
    expect(components).toHaveLength(1);
    expect(components[0]).toHaveLength(3);
  });
});
