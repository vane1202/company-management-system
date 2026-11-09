import { createInterface } from "node:readline/promises";
import { Writable, type Readable } from "node:stream";

/** 提示输出与 readline 回显分开，口令字符和终端重绘内容不会写入实际输出。 */
export async function promptSecret(input: Readable, output: Writable, prompt: string): Promise<string> {
  const silent = new Writable({ write(_chunk, _encoding, done) { done(); } });
  const rl = createInterface({ input, output: silent, terminal: true, historySize: 0 });
  const controller = new AbortController();
  rl.once("SIGINT", () => controller.abort());
  output.write(prompt);
  try {
    return await rl.question("", { signal: controller.signal });
  } finally {
    rl.close();
    silent.end();
    output.write("\n");
  }
}
