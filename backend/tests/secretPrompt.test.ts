import { PassThrough, Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { promptSecret } from "../src/lib/secretPrompt.js";

describe("hidden administrator password prompt", () => {
  it("returns exact input while never echoing it to the real output", async () => {
    const input = new PassThrough();
    let printed = "";
    const output = new Writable({ write(chunk, _encoding, done) { printed += chunk.toString(); done(); } });
    const pending = promptSecret(input, output, "Password: ");
    input.write(" ExampleTestPassword123 \r");
    expect(await pending).toBe(" ExampleTestPassword123 ");
    expect(printed).toBe("Password: \n");
    expect(printed).not.toContain("ExampleTestPassword123");
    input.destroy();
  });
  it("rejects on Ctrl+C instead of leaving a pending initialization", async () => {
    const input = new PassThrough();
    const output = new Writable({ write(_chunk, _encoding, done) { done(); } });
    const pending = promptSecret(input, output, "Password: ");
    const assertion = expect(pending).rejects.toThrow();
    input.write("\u0003");
    await assertion;
    input.destroy();
  });
});
