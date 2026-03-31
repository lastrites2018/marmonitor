#!/usr/bin/env node
import("../dist/collector/entrypoints.js").then(async ({ shouldUseThinStatuslineClient }) => {
  if (shouldUseThinStatuslineClient(process.argv.slice(2))) {
    const { main } = await import("../dist/statusline-client.js");
    await main();
    return;
  }

  await import("../dist/cli.js");
});
