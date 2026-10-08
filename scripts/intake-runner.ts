import { intakeMain } from "./intake";
import { createIntakeSync } from "./intake-sync";
const url = process.env.CONVEX_URL,
  secret = process.env.RESEARCH_WRITE_SECRET;
const sync = url && secret ? createIntakeSync(url, secret) : null;
const state = await intakeMain(process.argv.slice(2), {
  onCheckpoint: sync
    ? async (state) => {
        await sync(state).catch(() =>
          console.error(
            "Convex checkpoint unavailable; local archive retained",
          ),
        );
      }
    : undefined,
});
if (sync) await sync(state, true);
