import assert from "node:assert/strict";
import test from "node:test";
import { chooseAssignments } from "../dist/assign.js";
import { cardLimitsReached, wakeCardBand } from "../dist/accountability.js";
import { classifySendError, completionAction, shouldOpenCase } from "../dist/decisions.js";
import { classifyChatMember } from "../dist/membership.js";
import { navigationLabels, paginate } from "../dist/pages.js";
import { sslFor } from "../dist/pg-ssl.js";
import { parseTodoList } from "../dist/todo-parse.js";
import { parseCommand } from "../dist/commands.js";
import { zonedTimeToUtc } from "../dist/time.js";
import { canonicalYoutubeUrl } from "../dist/youtube.js";

test("membership statuses", () => {
  assert.equal(classifyChatMember({ status: "member" }).kind, "member");
  assert.equal(classifyChatMember({ status: "administrator" }).kind, "member");
  assert.equal(classifyChatMember({ status: "creator" }).kind, "member");
  assert.equal(classifyChatMember({ status: "restricted", is_member: true }).kind, "member");
  assert.equal(classifyChatMember({ status: "restricted", is_member: false }).kind, "non_member");
  assert.equal(classifyChatMember({ status: "left" }).kind, "non_member");
  assert.equal(classifyChatMember({ status: "kicked" }).kind, "non_member");
  assert.equal(classifyChatMember({ status: "weird" }).kind, "unavailable");
});

test("youtube links accept videos and reject lookalikes", () => {
  assert.equal(canonicalYoutubeUrl("https://youtu.be/abcdefghijk"), "https://youtu.be/abcdefghijk");
  assert.equal(canonicalYoutubeUrl("https://www.youtube.com/watch?v=abcdefghijk"), "https://www.youtube.com/watch?v=abcdefghijk");
  assert.equal(canonicalYoutubeUrl("https://m.youtube.com/shorts/abcdefghijk"), "https://www.youtube.com/shorts/abcdefghijk");
  assert.equal(canonicalYoutubeUrl("https://www.youtube.com/live/abcdefghijk"), "https://www.youtube.com/live/abcdefghijk");
  assert.equal(canonicalYoutubeUrl("https://youtube.com.evil.com/watch?v=abcdefghijk"), null);
  assert.equal(canonicalYoutubeUrl("https://www.youtube.com/channel/abcdefghijk"), null);
  assert.equal(canonicalYoutubeUrl("http://youtu.be/abcdefghijk"), null);
});

test("commands for another bot are ignored", () => {
  assert.equal(parseCommand("/start@OtherBot hello", "BrainUpTestBot"), null);
  assert.equal(parseCommand("/start@BrainUpTestBot hello", "BrainUpTestBot")?.body, "hello");
});

test("todo parser keeps informal wording and explicit times", () => {
  const parsed = parseTodoList("Salom\n06:00–06:30 | Piyoda sayr\nKitob o‘qish — 20 bet\n19:00 | Ishga borish\n8 dan 12 gacha dars");
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.tasks.length, 3);
  assert.deepEqual(parsed.tasks[0], { title: "Piyoda sayr", start: "06:00", end: "06:30" });
  assert.equal(parsed.tasks[1]?.start, "19:00");
  assert.deepEqual(parsed.tasks[2], { title: "dars", start: "08:00", end: "12:00" });
});

test("spoken uzbek times become ranges", () => {
  const parsed = parseTodoList(
    "Assalomu alaykum. Boshlagan kunila xayrli bo'lsin\n" +
      "5 dan 6 gacha kichik ishlar qilindi.\n" +
      "6 dan 6 yarimgacha kitob mutolaa qilindi\n" +
      "6:30 dan 7:00 gacha nonushta\n" +
      "22:30 da uxlash",
  );
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.deepEqual(parsed.tasks[0], { title: "kichik ishlar qilindi", start: "05:00", end: "06:00" });
  assert.deepEqual(parsed.tasks[1], { title: "kitob mutolaa qilindi", start: "06:00", end: "06:30" });
  assert.deepEqual(parsed.tasks[2], { title: "nonushta", start: "06:30", end: "07:00" });
  assert.deepEqual(parsed.tasks[3], { title: "uxlash", start: "22:30", end: null });
});

test("assignments stay stable and avoid recent prompts when possible", () => {
  const topics = [1, 2, 3].map((id) => ({ id, text: `t${id}` }));
  const first = chooseAssignments({
    participantIds: [10, 11],
    topics,
    recentByUser: new Map([[10, [1, 2, 3, 4, 5, 6, 7]]]),
    already: new Map(),
    random: () => 0,
  });
  const second = chooseAssignments({
    participantIds: [10, 11],
    topics,
    recentByUser: new Map(),
    already: first,
    random: () => 0.9,
  });
  assert.equal(second.get(10), first.get(10));
  assert.equal(second.get(11), first.get(11));
  assert.notEqual(first.get(10), undefined);
});

test("40 topics make 8 pages and arrows hide on one page", () => {
  const page = paginate(Array.from({ length: 40 }, (_, index) => index), 0, 5);
  assert.equal(page.pages, 8);
  assert.equal(page.items.length, 5);
  assert.deepEqual(navigationLabels(0, 1), { prev: false, next: false });
  assert.deepEqual(navigationLabels(0, 8), { prev: false, next: true });
});

test("checkbox presses use the requested state and revision", () => {
  assert.equal(completionAction({ completed: false, revision: 3, requested: true, expectedRevision: 3 }), "apply");
  assert.equal(completionAction({ completed: true, revision: 4, requested: true, expectedRevision: 3 }), "refresh");
  assert.equal(completionAction({ completed: true, revision: 3, requested: true, expectedRevision: 3 }), "refresh");
});

test("wake cards use the on-time hour and the next hour", () => {
  assert.equal(wakeCardBand("05:59", "06:00"), "green");
  assert.equal(wakeCardBand("06:00", "06:00"), "green");
  assert.equal(wakeCardBand("06:01", "06:00"), "orange");
  assert.equal(wakeCardBand("07:00", "06:00"), "orange");
  assert.equal(wakeCardBand("07:01", "06:00"), "red");
  assert.equal(cardLimitsReached({ red: 2, orange: 4 }), null);
  assert.equal(cardLimitsReached({ red: 3, orange: 0 }), "red");
  assert.equal(cardLimitsReached({ red: 0, orange: 5 }), "orange");
});

test("accountability skips drafts, failed delivery, new admissions, and outages", () => {
  const deadline = new Date("2026-09-30T04:00:00Z");
  assert.equal(shouldOpenCase({
    requirement: "plan", membership: "member", blocked: false, admittedAt: null, deadline, met: false, assignmentPostedAt: null,
  }), true);
  assert.equal(shouldOpenCase({
    requirement: "plan", membership: "unavailable", blocked: false, admittedAt: null, deadline, met: false, assignmentPostedAt: null,
  }), false);
  assert.equal(shouldOpenCase({
    requirement: "topic_response", membership: "member", blocked: false, admittedAt: null, deadline, met: false, assignmentPostedAt: null,
  }), false);
  assert.equal(shouldOpenCase({
    requirement: "wake", membership: "member", blocked: false, admittedAt: new Date("2026-09-30T05:00:00Z"), deadline, met: false, assignmentPostedAt: null,
  }), false);
});

test("tls follows the connection string and verifies neon without sslmode", () => {
  assert.equal(sslFor("postgresql://u:p@ep-x.neon.tech/db?sslmode=require"), undefined);
  assert.deepEqual(sslFor("postgresql://u:p@ep-x.neon.tech/db"), { rejectUnauthorized: true });
  assert.equal(sslFor("postgresql://u:p@localhost/db"), undefined);
});

test("tashkent wall time converts to utc", () => {
  assert.equal(zonedTimeToUtc("2026-09-30", "09:00", "Asia/Tashkent").toISOString(), "2026-09-30T04:00:00.000Z");
});

test("uncertain send errors are not retried as success", () => {
  assert.equal(classifySendError(new Error("network timeout"), 1).kind, "uncertain");
  assert.equal(classifySendError(new Error("retry after 3"), 1).kind, "retry");
});
