import { createFileRoute } from "@tanstack/react-router";
import { enqueue, failure } from "../server/research";

export const Route = createFileRoute("/api/questions")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          return await enqueue(request);
        } catch (error) {
          return failure(error);
        }
      },
    },
  },
});
