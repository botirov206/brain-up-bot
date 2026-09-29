import assert from "node:assert/strict";
import test from "node:test";
import { activeWakePayload } from "../dist/time.js";

const zone = "Asia/Tashkent";

test("only today's dated wake link works before noon", () => {
  assert.equal(activeWakePayload("wake_20260930", zone, new Date("2026-09-30T06:59:00Z")), true);
  assert.equal(activeWakePayload("wake_20260930", zone, new Date("2026-09-30T07:00:00Z")), false);
  assert.equal(activeWakePayload("wake_20260929", zone, new Date("2026-09-30T06:59:00Z")), false);
  assert.equal(activeWakePayload("wake", zone, new Date("2026-09-30T06:59:00Z")), false);
});
