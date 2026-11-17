// Loaded first so env vars exist before other modules read them.
// In GitHub Actions the vars come from secrets and these files don't exist.
import { config } from "dotenv";
config({ path: [".env.local", ".env"], quiet: true });
