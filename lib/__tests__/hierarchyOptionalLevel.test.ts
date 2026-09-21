import { describe, it, expect } from "vitest";
import {
  effectiveLeafLevel,
  effectiveLeafNode,
  leafLevels,
  optionalLevel,
  selectableLeafNodes,
  setOptionalLevel,
  validateOptionalLevels,
} from "@/lib/hierarchyLogic";
import type { HierarchyLevelDef, HierarchyNode } from "@/types";

const levels: HierarchyLevelDef[] = [
  { key: "bu", label: "BU", order: 0 },
  { key: "dept", label: "Département", order: 1 },
  { key: "cc", label: "Centre de coût", order: 2, optional: true },
];
const node = (id: string, levelKey: string, parentId: string | null): HierarchyNode => ({
  id,
  companyId: "c",
  levelKey,
  code: id,
  label: id,
  parentId,
});
const nodes = [node("bu1", "bu", null), node("d1", "dept", "bu1"), node("cc1", "cc", "d1")];

describe("niveau optionnel", () => {
  it("effectiveLeafLevel : niveau non-optionnel le plus fin", () => {
    expect(effectiveLeafLevel(levels)?.key).toBe("dept");
    expect(effectiveLeafLevel(levels.map((l) => ({ ...l, optional: undefined })))?.key).toBe("cc");
    expect(effectiveLeafLevel([])).toBeUndefined();
  });

  it("leafLevels / optionalLevel", () => {
    expect(leafLevels(levels).map((l) => l.key)).toEqual(["cc", "dept"]);
    expect(leafLevels(levels.slice(0, 2)).map((l) => l.key)).toEqual(["dept"]);
    expect(optionalLevel(levels)?.key).toBe("cc");
  });

  it("effectiveLeafNode remonte du niveau optionnel, et accepte le niveau obligatoire seul", () => {
    expect(effectiveLeafNode("cc1", nodes, levels)?.id).toBe("d1");
    expect(effectiveLeafNode("d1", nodes, levels)?.id).toBe("d1");
    expect(effectiveLeafNode("bu1", nodes, levels)?.id).toBe("bu1");
    expect(effectiveLeafNode("inconnu", nodes, levels)).toBeUndefined();
  });

  it("selectableLeafNodes : niveau optionnel + obligatoire", () => {
    expect(selectableLeafNodes(nodes, levels).map((n) => n.id)).toEqual(["d1", "cc1"]);
  });

  it("un seul niveau optionnel", () => {
    const both = levels.map((l) => ({ ...l, optional: true }));
    expect(validateOptionalLevels(both)).not.toBeNull();
    expect(validateOptionalLevels(levels)).toBeNull();
    const next = setOptionalLevel(both, "dept", true);
    expect(next.filter((l) => l.optional).map((l) => l.key)).toEqual(["dept"]);
    expect(setOptionalLevel(levels, "cc", false).some((l) => l.optional)).toBe(false);
  });
});
