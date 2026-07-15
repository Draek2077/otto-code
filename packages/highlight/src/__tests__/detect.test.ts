import { describe, it, expect } from "vitest";
import { detectLanguage } from "../detect.js";
import { getParserForFile } from "../parsers.js";

describe("detectLanguage", () => {
  it("detects shell from common commands and pipes", () => {
    const code = `cd /tmp
export TOKEN=abc
npm install && npm run build
cat log.txt | grep error | wc -l`;
    expect(detectLanguage(code)).toBe("sh");
  });

  it("detects shell from a shebang", () => {
    expect(detectLanguage("#!/usr/bin/env bash\nrm -rf build")).toBe("sh");
    expect(detectLanguage("#!/bin/sh\nx=1")).toBe("sh");
  });

  it("detects SQL from SELECT ... FROM", () => {
    const code = `SELECT id, name
FROM users
WHERE active = true
ORDER BY created_at DESC;`;
    expect(detectLanguage(code)).toBe("sql");
  });

  it("detects SQL regardless of keyword casing", () => {
    expect(detectLanguage("insert into logs (msg) values ('hi');")).toBe("sql");
    expect(detectLanguage("create table t (id int primary key);")).toBe("sql");
  });

  it("detects JSON by structural parse", () => {
    expect(detectLanguage('{"a": 1, "b": [2, 3], "c": {"d": true}}')).toBe("json");
    expect(detectLanguage("[1, 2, 3]")).toBe("json");
  });

  it("detects Python", () => {
    const code = `import os

def main():
    for item in os.listdir("."):
        if item.endswith(".py"):
            print(item)`;
    expect(detectLanguage(code)).toBe("py");
  });

  it("detects Python elif over an ambiguous object literal", () => {
    const code = `def classify(n):
    if n < 0:
        return "neg"
    elif n == 0:
        return "zero"
    else:
        return "pos"`;
    expect(detectLanguage(code)).toBe("py");
  });

  it("detects TypeScript/JavaScript", () => {
    const code = `import { foo } from "./foo";

export const add = (a: number, b: number): number => {
  return a + b;
};`;
    expect(detectLanguage(code)).toBe("ts");
  });

  it("detects Go", () => {
    const code = `package main

import "fmt"

func main() {
    fmt.Println("hi")
}`;
    expect(detectLanguage(code)).toBe("go");
  });

  it("detects Rust", () => {
    const code = `fn main() {
    let mut total = 0;
    println!("{}", total);
}`;
    expect(detectLanguage(code)).toBe("rs");
  });

  it("detects Java", () => {
    const code = `public class Main {
    public static void main(String[] args) {
        System.out.println("hi");
    }
}`;
    expect(detectLanguage(code)).toBe("java");
  });

  it("detects HTML", () => {
    expect(detectLanguage("<!DOCTYPE html>\n<html><body><div>hi</div></body></html>")).toBe("html");
  });

  it("detects CSS", () => {
    const code = `.btn {
  color: red;
  padding: 4px 8px;
}`;
    expect(detectLanguage(code)).toBe("css");
  });

  it("returns null for plain prose", () => {
    expect(
      detectLanguage("This is just a paragraph of English text with no code in it at all."),
    ).toBeNull();
  });

  it("returns null for trivially short input", () => {
    expect(detectLanguage("")).toBeNull();
    expect(detectLanguage("ok")).toBeNull();
  });

  it("only returns extensions the parser table knows", () => {
    const samples = [
      "cd /tmp && ls",
      "SELECT * FROM t;",
      "def f():\n    return 1",
      "package main\nfunc main() {}",
    ];
    for (const s of samples) {
      const ext = detectLanguage(s);
      if (ext) expect(getParserForFile(`x.${ext}`)).not.toBeNull();
    }
  });
});
