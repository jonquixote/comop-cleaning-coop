// Root tRPC router (app layer). Merges auth + booking + worker + transparency +
// governance + invites sub-routers.
import { router } from "@comop/platform/trpc/server";
import { authRouter } from "./routers/auth";
import { bookingRouter } from "./routers/booking";
import { workerRouter } from "./routers/worker";
import { transparencyRouter } from "./routers/transparency";
import { governanceRouter } from "./routers/governance";
import { invitesRouter } from "./routers/invites";

export const appRouter = router({
  auth: authRouter,
  booking: bookingRouter,
  worker: workerRouter,
  transparency: transparencyRouter,
  governance: governanceRouter,
  invites: invitesRouter,
});

export type AppRouter = typeof appRouter;
