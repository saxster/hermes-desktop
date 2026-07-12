/** Refresh a rebuildable index without changing the outcome of a durable write. */
export async function bestEffortDerivedIndexRefresh<T>(
  refresh: () => Promise<T>,
  onSuccess: (status: T) => void,
  onFailure: (error: unknown) => void,
): Promise<void> {
  try {
    onSuccess(await refresh());
  } catch (error) {
    onFailure(error);
  }
}
