export function requireSecret(secret: string) {
  const expected = process.env.RESEARCH_WRITE_SECRET;
  if (!expected || secret !== expected) throw new Error("Unauthorized");
}
