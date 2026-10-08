import { createFileRoute } from "@tanstack/react-router";
import { question, failure } from "../server/research";

export const Route = createFileRoute("/api/questions/$id")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        try {
          const result = await question(params.id);
          return Response.json(result || { error: "Question not found." }, {
            status: result ? 200 : 404,
            headers: { "Cache-Control": "no-store" },
          });
        } catch (error) {
          return failure(error);
        }
      },
    },
  },
});
