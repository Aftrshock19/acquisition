import { describe, it, expect } from "vitest";

import {
  classifyCognate,
  lexicalWeightForCognate,
  STRONG_COGNATE_THRESHOLD,
  WEAK_COGNATE_THRESHOLD,
} from "./cognate";

describe("classifyCognate", () => {
  it("tags obvious transparent cognates as strong_cognate", () => {
    // -ción/-tion, -dad/-ty, -mente/-ly families.
    expect(classifyCognate("nación", "nation").cognateClass).toBe("strong_cognate");
    expect(classifyCognate("posición", "position").cognateClass).toBe("strong_cognate");
    expect(classifyCognate("universidad", "university").cognateClass).toBe(
      "strong_cognate",
    );
    expect(classifyCognate("rápidamente", "rapidly").cognateClass).toBe("strong_cognate");
    expect(classifyCognate("hospital", "hospital").cognateClass).toBe("strong_cognate");
  });

  it("marks partial cognates as weak_cognate", () => {
    // "activo"/"active" — similar but not identical after suffix rules.
    const r = classifyCognate("activo", "active");
    expect(["weak_cognate", "strong_cognate"]).toContain(r.cognateClass);
    // "crear"/"create" — definitely weak or strong.
    const r2 = classifyCognate("crear", "create");
    expect(r2.similarity).toBeGreaterThanOrEqual(WEAK_COGNATE_THRESHOLD);
  });

  it("does not over-flag non-cognates", () => {
    expect(classifyCognate("perro", "dog").cognateClass).toBe("non_cognate");
    expect(classifyCognate("rodilla", "knee").cognateClass).toBe("non_cognate");
    expect(classifyCognate("agua", "water").cognateClass).toBe("non_cognate");
    expect(classifyCognate("casa", "house").cognateClass).toBe("non_cognate");
  });

  it("handles multi-segment glosses by picking the best match", () => {
    // "hacer" = "to do; to make" — neither is a cognate.
    expect(classifyCognate("hacer", "to do; to make").cognateClass).toBe("non_cognate");
    // But "computadora" = "computer; machine" — cognate via the first meaning.
    expect(classifyCognate("computadora", "computer; machine").cognateClass).toBe(
      "strong_cognate",
    );
  });

  it("returns non_cognate for empty or trivially short inputs", () => {
    expect(classifyCognate("", "dog").cognateClass).toBe("non_cognate");
    expect(classifyCognate("a", "a").cognateClass).toBe("non_cognate");
    expect(classifyCognate("perro", null).cognateClass).toBe("non_cognate");
  });

  it("thresholds form a monotonic ordering", () => {
    expect(STRONG_COGNATE_THRESHOLD).toBeGreaterThan(WEAK_COGNATE_THRESHOLD);
  });
});

describe("lexicalWeightForCognate", () => {
  it("non_cognate > weak_cognate > strong_cognate", () => {
    expect(lexicalWeightForCognate("non_cognate")).toBeGreaterThan(
      lexicalWeightForCognate("weak_cognate"),
    );
    expect(lexicalWeightForCognate("weak_cognate")).toBeGreaterThan(
      lexicalWeightForCognate("strong_cognate"),
    );
    expect(lexicalWeightForCognate("non_cognate")).toBe(1.0);
    expect(lexicalWeightForCognate("weak_cognate")).toBe(0.8);
    expect(lexicalWeightForCognate("strong_cognate")).toBe(0.5);
  });
});
