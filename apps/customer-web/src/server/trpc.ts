// Root tRPC router (app layer). Merges auth + booking sub-routers.
import { router } from "@comop/platform/trpc/server";
import { authRouter } from "./routers/auth";
import { bookingRouter } from "./routers/booking";

export const appRouter = router({
  auth: authRouter,
  booking: bookingRouter,
});

export type AppRouter = typeof appRouter;
