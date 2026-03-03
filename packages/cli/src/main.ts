import { runCli } from "./index";

const exitCode = await runCli();
process.exitCode = exitCode;
