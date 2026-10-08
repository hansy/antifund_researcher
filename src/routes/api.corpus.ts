import { createFileRoute } from "@tanstack/react-router";
import { corpus, failure } from "../server/research";

export const Route = createFileRoute("/api/corpus")({
  server: {
    handlers: {
      GET: async () => {
        try {
          return Response.json(await corpus(), {
            headers: { "Cache-Control": "public, max-age=30" },
          });
        } catch (error) {
          return failure(error);
        }
      },
    },
  },
});
