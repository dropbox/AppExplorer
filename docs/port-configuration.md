# AppExplorer Server Port Configuration

## Overview

AppExplorer uses a sophisticated port configuration system that supports both production stability and isolated test execution. The system uses **runtime port injection** for testing, eliminating conflicts between parallel test instances while maintaining production reliability.

## Architecture

The port configuration system operates with the following priority hierarchy:

1. **Runtime Port Override** (highest priority) - Process-scoped, for testing
2. **VSCode Configuration Setting** - For manual configuration
3. **Production Default (9042)** - For normal operation

## Configuration Setting

### `appExplorer.internal.serverPort`

- **Type**: `integer`
- **Default**: `9042`
- **Range**: `1024-65535`
- **Scope**: `application`
- **Purpose**: ⚠️ **INTERNAL USE ONLY** - For E2E testing purposes

## Important Notes

### ⚠️ Production Requirements

**The production Miro integration MUST always use port 9042.** This is a hard requirement for proper integration with Miro boards. Only modify this setting for automated testing purposes.

### Testing Context

The port configuration system was redesigned to solve critical testing challenges:

1. **Prevent conflicts** with running production AppExplorer instances during E2E tests
2. **Enable parallel testing** by allowing different test suites to use different ports simultaneously
3. **Isolate test environments** from production environments and each other
4. **Eliminate global state** - tests no longer modify VSCode settings that could affect other processes
5. **Support CI/CD pipelines** - multiple test jobs can run concurrently without port conflicts

## Usage

### Normal Operation (Production)

In normal operation, you should **never** modify the `appExplorer.internal.serverPort` setting. The extension will automatically use port 9042, which is required for Miro integration.

### E2E Testing (Recommended Approach)

For E2E testing, use **runtime port injection** for isolated, parallel-safe testing:

```typescript
import { PortConfig } from "./src/port-config";
import { TestPortManager } from "./src/test/helpers/test-port-manager";

// Allocate a unique test port (process-scoped)
const testPort = await TestPortManager.allocateTestPort();
// This automatically sets a runtime port override

// Your test code here - all server components will use the allocated port

// Clean up when done
TestPortManager.releasePort();
// This clears the runtime override and returns to production default
```

### Manual Testing (VSCode Settings)

For manual testing, you can still use VSCode settings (not recommended for automated tests):

```typescript
import { PortConfig } from "./src/port-config";

// Set a test port via VSCode settings
await PortConfig.setServerPort(9043, true);

// Reset to production default
await PortConfig.resetToProductionPort(true);
```

### VSCode Settings

You can also configure the port through VSCode settings (not recommended for manual use):

```json
{
  "appExplorer.internal.serverPort": 9043
}
```

## Implementation Details

### Port Configuration Utility (`PortConfig`)

The `PortConfig` class provides centralized port management with runtime override support:

#### Core Methods

- **`getServerPort()`**: Returns the configured port (checks runtime override first, then VSCode setting, then default 9042)
- **`isUsingTestPort()`**: Checks if using a non-production port
- **`getDiagnostics()`**: Returns comprehensive port configuration details

#### Runtime Override Methods (Recommended for Testing)

- **`setRuntimePortOverride(port)`**: Sets a process-scoped port override (doesn't persist to VSCode settings)
- **`getRuntimePortOverride()`**: Gets the current runtime override
- **`hasRuntimePortOverride()`**: Checks if a runtime override is active

#### VSCode Settings Methods (For Manual Configuration)

- **`setServerPort(port, global)`**: Sets the port in VSCode configuration
- **`resetToProductionPort(global)`**: Resets VSCode configuration to default

### Validation

The port configuration includes validation for:

- **Valid port range**: 1024-65535 (avoids system/privileged ports)
- **Integer values**: Ensures port is a valid integer
- **Reserved port warnings**: Warns about commonly reserved ports

### Error Handling

The system includes comprehensive error handling:

- **Invalid port values**: Clear error messages with valid range information
- **Configuration read errors**: Fallback to production default with logging
- **User notifications**: Appropriate error/warning messages in VSCode

## Integration Points

### Server Components

All server components use the centralized port configuration:

1. **`MiroServer`**: Uses `PortConfig.getServerPort()` for server startup
2. **`ServerDiscovery`**: Uses configured port for health checks and discovery
3. **`ServerLauncher`**: Ensures consistent port usage across components
4. **`WorkspaceWebsocketClient`**: Connects to the configured server port

### Test Integration

The test utilities provide isolated, parallel-safe port management:

- **`TestPortManager`**: Allocates dynamic test ports with runtime overrides
- **`E2ETestUtils`**: Provides test lifecycle management and cleanup
- **Process isolation**: Each test process gets its own unique port
- **Parallel execution**: Multiple test suites can run simultaneously without conflicts
- **No global state**: Tests don't modify VSCode settings that could affect other processes

## Debugging

### Port Configuration Diagnostics

Use `PortConfig.getDiagnostics()` to get detailed port information:

```typescript
const diagnostics = PortConfig.getDiagnostics();
console.log(diagnostics);
// Output:
// {
//   currentPort: 9043,
//   isTestPort: true,
//   productionPort: 9042,
//   configSource: "appExplorer.internal.serverPort"
// }
```

### Logging

The port configuration system includes comprehensive logging:

- **Debug mode**: Additional logging when `appExplorer.migration.debugMode` is enabled
- **Warning notifications**: User warnings when using non-production ports in debug mode
- **Error logging**: Detailed error information for troubleshooting

## Parallel Test Execution

### How It Works

The new runtime port injection system enables true parallel test execution:

1. **Process Isolation**: Each `vscode-test` process gets its own runtime port override
2. **No Global State**: Tests don't modify VSCode settings that could affect other processes
3. **Dynamic Allocation**: Ports are allocated from a safe range (9043-9999) automatically
4. **Automatic Cleanup**: Ports are released when tests complete or fail

### Example: Parallel Test Setup

```typescript
// test-setup.ts
import { TestPortManager } from "./src/test/helpers/test-port-manager";
import { E2ETestUtils } from "./src/test/helpers/e2e-test-utils";

suite("My Test Suite", () => {
  setup(async () => {
    // Allocate unique port for this test process
    await TestPortManager.allocateTestPort();
    await E2ETestUtils.startTestMiroServer();
  });

  teardown(async () => {
    // Clean up resources
    await E2ETestUtils.cleanup();
  });

  // Your tests here - each process uses its own isolated port
});
```

### Benefits

- **CI/CD Friendly**: Multiple test jobs can run concurrently
- **Developer Productivity**: Faster test execution through parallelization
- **Reliability**: No race conditions or port conflicts between test suites
- **Isolation**: Tests can't accidentally affect each other

## Best Practices

### For Developers

1. **Never hardcode ports** - Always use `PortConfig.getServerPort()`
2. **Use runtime overrides for tests** - Prefer `TestPortManager.allocateTestPort()` over VSCode settings
3. **Test with different ports** - Ensure your code works with any valid port
4. **Clean up properly** - Always call `TestPortManager.releasePort()` in test teardown
5. **Check test isolation** - Ensure tests don't interfere with each other
6. **Support parallel execution** - Design tests to work when run simultaneously

### For Users

1. **Don't modify the setting** - The port configuration is for internal use only
2. **Use production default** - Always use port 9042 for real Miro integration
3. **Report issues** - If you see port-related errors, report them with diagnostics

## Troubleshooting

### Common Issues

1. **Port already in use**: Another AppExplorer instance or service is using the port
2. **Invalid port configuration**: Check that the port is in the valid range (1024-65535)
3. **Permission denied**: Ports below 1024 require elevated privileges

### Resolution Steps

1. **Check port availability**: Use `netstat` or similar tools to check port usage
2. **Reset configuration**: Use `PortConfig.resetToProductionPort()` to reset
3. **Check diagnostics**: Use `PortConfig.getDiagnostics()` for detailed information
4. **Review logs**: Check extension logs for detailed error information

## Security Considerations

- **Port range restriction**: Only allows ports 1024-65535 to avoid privileged ports
- **Reserved port warnings**: Warns about commonly used system ports
- **Production protection**: Clear warnings when using non-production ports
- **Configuration scope**: Uses application scope to prevent workspace-specific overrides
