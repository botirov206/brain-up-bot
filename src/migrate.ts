import { migrate, pool } from "./db.js";
import { logError } from "./log.js";

try {
  await migrate();
  console.log("Migrations complete");
} catch (err) {
  logError("migrate", err);
  process.exitCode = 1;
} finally {
  await pool.end();
}
