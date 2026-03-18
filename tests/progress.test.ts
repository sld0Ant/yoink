import { describe, it, expect } from "bun:test";
import { Progress, SilentProgress } from "../src/progress";

describe("Progress", () => {
  it("tracks totals and counts", () => {
    const p = new Progress();
    p.addTotal(5);
    p.tick("css", "a.css", 100);
    p.tick("js", "b.js", 200);
    p.tickFail();

    expect(p.done).toBe(3);
    expect(p.total).toBe(5);
    expect(p.failed).toBe(1);
    expect(p.bytes).toBe(300);
    expect(p.counts.css).toBe(1);
    expect(p.counts.js).toBe(1);
  });

  it("tracks current file", () => {
    const p = new Progress();
    p.addTotal(2);
    p.tick("img", "photo.jpg");
    expect(p.currentFile).toBe("photo.jpg");
    p.tick("font", "roboto.woff2");
    expect(p.currentFile).toBe("roboto.woff2");
  });

  it("tracks phase", () => {
    const p = new Progress();
    p.setPhase("Downloading");
    expect(p.phase).toBe("Downloading");
  });
});

describe("SilentProgress", () => {
  it("implements ProgressReporter without side effects", () => {
    const p = new SilentProgress();
    p.start();
    p.setPhase("test");
    p.addTotal(10);
    p.tick("css", "a.css", 100);
    p.tickFail();
    p.stop();
  });
});
