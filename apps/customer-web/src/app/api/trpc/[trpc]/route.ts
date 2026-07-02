import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { createContext } from "@comop/platform/trpc/context";
import { appRouter } from "../../../../server/trpc";

const handler = (req: Request) =>
  fetchRequestHandler({
    router: appRouter,
    req,
    endpoint: "/api/trpc",
    createContext,
  });

export const GET = handler;
export const POST = handler;
