import assert from "node:assert/strict";
import { test } from "node:test";
import { setupApp } from "./test-support.ts";

test("tableau de bord : « aujourd'hui » est le jour de Douala, pas celui d'UTC (V1-74)", async (t) => {
  const ctx = await setupApp(t, { demo: false });
  // 23:30 UTC le 04/03 : il est déjà 00:30 le 05/03 à Douala.
  ctx.clock.now = Date.parse("2031-03-04T23:30:00Z");
  const client = Number(ctx.db.prepare("INSERT INTO clients (name) VALUES ('Aïcha Mbarga')").run().lastInsertRowid);
  const book = (identifier: string, date: string) =>
    ctx.db.prepare("INSERT INTO appointments (identifier, client_id, scheduled_date, start_time, end_time, booked_at) VALUES (?, ?, ?, '10:00', '11:00', ?)")
      .run(identifier, client, date, ctx.clock.now);
  book("APT-901", "2031-03-04");
  book("APT-902", "2031-03-05");
  book("APT-903", "2031-03-05");
  const gerante = await ctx.as("manager");
  const res = await gerante("GET", "/api/stats");
  assert.equal(res.status, 200);
  assert.equal(res.body.today_appointments, 2, "les deux rendez-vous du 05/03, jour de Douala");
  assert.equal(res.body.upcoming_appointments, 2, "celui du 04/03 est déjà passé à Douala");
});
