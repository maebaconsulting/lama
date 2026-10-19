import assert from "node:assert/strict";
import { test } from "node:test";
import { MOTIF_ORIGINE, MOTIF_SALON, SALONS_RESERVES } from "./motifs.ts";
import { SALONS_RESERVES as REEXPORT } from "./salon.ts";

test("motifs : salon, origine et adresses réservées", () => {
  assert.deepEqual(SALONS_RESERVES, ["api", "gestion", "lama", "assets"]);
  assert.equal(REEXPORT, SALONS_RESERVES);
  assert.equal(MOTIF_SALON.test("institut-eclat"), true);
  assert.equal(MOTIF_SALON.test("-eclat"), false);
  assert.equal(MOTIF_ORIGINE.test("http://localhost:5173"), true);
  assert.equal(MOTIF_ORIGINE.test("https://eclat.cm/"), false);
});
