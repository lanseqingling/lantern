import { recordCurrentWebBuild } from "./web-build-state";
import { repositoryRoot, runCommand } from "./runtime-init";

await runCommand(["--filter", "@lantern/web", "build"]);
await recordCurrentWebBuild(repositoryRoot);
