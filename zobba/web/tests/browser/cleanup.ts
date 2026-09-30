/** Restoration may fail precisely when resource cleanup matters most. */
export async function restoreAndClose(
  runtime: { restoreDatabase: () => void; sql: (statement: string) => void; close: () => Promise<void> },
  statement: string,
): Promise<void> {
  try {
    runtime.restoreDatabase();
    runtime.sql(statement);
  } finally {
    await runtime.close();
  }
}
