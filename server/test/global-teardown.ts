export default async (): Promise<void> => {
  const teardown = (globalThis as Record<string, unknown>).__HARNESS_TEARDOWN__ as (() => Promise<void>) | undefined;
  if (teardown) await teardown();
};
