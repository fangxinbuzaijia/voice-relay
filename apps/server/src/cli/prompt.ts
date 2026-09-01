import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";

export async function promptText(label: string): Promise<string> {
  const readline = createInterface({ input: stdin, output: stdout });
  try {
    return (await readline.question(label)).trim();
  } finally {
    readline.close();
  }
}

export async function promptHidden(label: string): Promise<string> {
  if (!stdin.isTTY) return promptText(label);
  stdout.write(label);
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding("utf8");
  return new Promise<string>((resolve, reject) => {
    let value = "";

    const cleanup = (): void => {
      stdin.off("data", onData);
      stdin.off("error", onError);
      stdin.off("end", onEnd);
      stdin.setRawMode(false);
      stdin.pause();
    };
    const finish = (result: string): void => {
      cleanup();
      stdout.write("\n");
      resolve(result);
    };
    const fail = (error: Error): void => {
      cleanup();
      stdout.write("\n");
      reject(error);
    };
    const onError = (error: Error): void => fail(error);
    const onEnd = (): void => finish(value);
    const onData = (chunk: string | Buffer): void => {
      for (const character of String(chunk)) {
        if (character === "\r" || character === "\n") {
          finish(value);
          return;
        }
        if (character === "\u0003") {
          fail(new Error("Cancelled"));
          return;
        }
        if (character === "\u007f" || character === "\b") value = value.slice(0, -1);
        else value += character;
      }
    };

    stdin.on("data", onData);
    stdin.once("error", onError);
    stdin.once("end", onEnd);
  });
}
