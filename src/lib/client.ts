import { createElement, useState, type ReactNode } from "react";
import {
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQuery,
} from "@tanstack/react-query";
import { corpusSchema, type Answer } from "./contracts";

export function ResearchProvider({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 60_000, retry: 1, refetchOnWindowFocus: false },
        },
      }),
  );
  return createElement(QueryClientProvider, { client }, children);
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  const data = (await response.json()) as T & { error?: string };
  if (!response.ok)
    throw new Error(data.error || "Something went wrong. Try again.");
  return data;
}

export function useCorpus() {
  return useQuery({
    queryKey: ["corpus"],
    queryFn: async () => corpusSchema.parse(await request("/api/corpus")),
  });
}

export interface Question {
  id: string;
  status: "queued" | "running" | "complete" | "failed";
  answer?: Answer;
  error?: string;
}

export function useQuestion() {
  const [id, setId] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: (text: string) =>
      request<{ id: string }>("/api/questions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      }),
    onSuccess: (result) => setId(result.id),
  });
  const query = useQuery({
    queryKey: ["question", id],
    enabled: Boolean(id),
    queryFn: () =>
      request<Question>(`/api/questions/${encodeURIComponent(id!)}`),
    refetchInterval: (query) =>
      ["complete", "failed"].includes(query.state.data?.status || "")
        ? false
        : 2000,
  });
  const error = mutation.error || query.error;
  const question: Question | null = error
    ? { id: id || "failed", status: "failed", error: error.message }
    : query.data || (id ? { id, status: "queued" } : null);
  return {
    ask: async (text: string) => {
      setId(null);
      await mutation.mutateAsync(text);
    },
    question,
    isPending:
      mutation.isPending ||
      question?.status === "queued" ||
      question?.status === "running",
    reset: () => {
      setId(null);
      mutation.reset();
    },
  };
}
