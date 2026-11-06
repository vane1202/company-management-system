import { spawn } from "node:child_process";

function run(name, args) {
  const child = spawn("npm", args, { stdio: "inherit", shell: false });
  child.on("exit", (code) => {
    if (code && code !== 0) process.exit(code);
  });
  return child;
}

const backend = run("backend", ["run", "dev", "-w", "backend"]);
const frontend = run("frontend", ["run", "dev", "-w", "frontend"]);

function shutdown() {
  backend.kill("SIGTERM");
  frontend.kill("SIGTERM");
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
