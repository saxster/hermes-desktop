const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Launch an Electron smoke app with one bounded retry for transient startup
 * failures (single-instance teardown, inspector-port allocation, OS pressure). */
export async function launchElectronSmoke(
  electron,
  options,
  { label = "Electron smoke", retryDelayMs = 750 } = {},
) {
  try {
    return await electron.launch(options);
  } catch (firstError) {
    console.warn(
      `ELECTRON_LAUNCH_RETRY: ${label} failed to launch; retrying once`,
    );
    await sleep(retryDelayMs);
    try {
      return await electron.launch(options);
    } catch (secondError) {
      throw new AggregateError(
        [firstError, secondError],
        `${label} failed to launch twice`,
      );
    }
  }
}
