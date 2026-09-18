import { runMigrations } from "../migrate.js";

runMigrations().catch((err) => {
  console.error(err);
  process.exit(1);
});
