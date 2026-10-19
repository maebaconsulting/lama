import assert from "node:assert/strict";
import { test } from "node:test";
import { parPrestations } from "./praticiennes.ts";

const awa = { id: 1, service_ids: [10, 11] };
const grace = { id: 2, service_ids: [11] };
const ines = { id: 3, service_ids: [] as number[] };

test("sans prestation choisie : tout le monde dans « pratiquent », ordre gardé", () => {
  assert.deepEqual(parPrestations([awa, grace, ines], []), { pratiquent: [awa, grace, ines], autres: [] });
});

test("avec prestations : celles qui les pratiquent toutes d'abord, les autres ensuite, ordre gardé", () => {
  assert.deepEqual(parPrestations([awa, grace, ines], [11]), { pratiquent: [awa, grace], autres: [ines] });
  assert.deepEqual(parPrestations([awa, grace, ines], [10, 11]), { pratiquent: [awa], autres: [grace, ines] });
});
