import * as assert from "assert";
import { TestPortManager } from "../helpers/test-port-manager";

suite("Dynamic Port Allocation Tests", () => {
  teardown(() => {
    // Clean up after each test
    TestPortManager.releasePort();
  });

  test("allocates available port in test range", async function () {
    this.timeout(10000);

    const port = await TestPortManager.allocateTestPort();

    // Verify port is in expected range
    assert.ok(port >= 9043, `Port ${port} should be >= 9043`);
    assert.ok(port <= 9999, `Port ${port} should be <= 9999`);

    // Verify port is not the production port
    assert.notStrictEqual(
      port,
      9042,
      "Test port should not be the production port 9042",
    );
  });

  test("provides correct test server URL", async function () {
    this.timeout(10000);

    const port = await TestPortManager.allocateTestPort();
    const serverUrl = TestPortManager.getTestServerUrl();

    const expectedUrl = `http://localhost:${port}`;
    assert.strictEqual(
      serverUrl,
      expectedUrl,
      `Server URL should be ${expectedUrl}`,
    );
  });

  test("handles port allocation consistently", async function () {
    this.timeout(10000);

    const port1 = await TestPortManager.allocateTestPort();
    const port2 = await TestPortManager.allocateTestPort();

    // Should return the same port when called multiple times
    assert.strictEqual(
      port1,
      port2,
      "Should return same port on subsequent calls",
    );
  });

  test("provides diagnostic information", async function () {
    this.timeout(10000);

    const port = await TestPortManager.allocateTestPort();
    const diagnostics = await TestPortManager.getDiagnostics();

    assert.strictEqual(
      diagnostics.allocatedPort,
      port,
      "Diagnostics should show allocated port",
    );
    assert.ok(
      typeof diagnostics.allocatedPortAvailable === "boolean",
      "Should report port availability",
    );
    assert.strictEqual(
      diagnostics.testServerUrl,
      `http://localhost:${port}`,
      "Should provide correct server URL",
    );
  });

  test("releases port correctly", async function () {
    this.timeout(10000);

    const port = await TestPortManager.allocateTestPort();
    assert.ok(port, "Should allocate a port");

    TestPortManager.releasePort();

    // After release, getAllocatedPort should throw
    assert.throws(
      () => {
        TestPortManager.getAllocatedPort();
      },
      /No test port has been allocated/,
      "Should throw when no port is allocated",
    );
  });

  test("avoids production port conflicts", async function () {
    this.timeout(10000);

    // Allocate multiple ports to ensure none conflict with production
    const ports: number[] = [];

    for (let i = 0; i < 5; i++) {
      TestPortManager.releasePort(); // Release previous allocation
      const port = await TestPortManager.allocateTestPort();
      ports.push(port);

      assert.notStrictEqual(
        port,
        9042,
        `Port ${port} should not conflict with production port 9042`,
      );
    }
  });
});
