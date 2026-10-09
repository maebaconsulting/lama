import assert from "node:assert/strict";
import { test } from "node:test";
import { parseLocalAddress } from "./reseau-local.ts";

test("adresse du réseau local : port par défaut selon l'appareil, refus hors réseau local", () => {
  assert.deepEqual(parseLocalAddress("192.168.1.50", 8080), { host: "192.168.1.50", port: 8080 });
  assert.deepEqual(parseLocalAddress(" 10.0.0.7:9000 ", 8080), { host: "10.0.0.7", port: 9000 });
  assert.deepEqual(parseLocalAddress("172.16.0.1", 9100), { host: "172.16.0.1", port: 9100 });
  for (const bad of ["8.8.8.8", "127.0.0.1", "172.32.0.1", "telephone.local", "192.168.1.300", "192.168.1.5:0", "192.168.1.5:70000", "http://192.168.1.5", ""]) {
    assert.equal(parseLocalAddress(bad, 8080), null, bad);
  }
  assert.deepEqual(parseLocalAddress("127.0.0.1:8081", 8080, true), { host: "127.0.0.1", port: 8081 }, "boucle locale permise aux seuls essais");
});
