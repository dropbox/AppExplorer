/**
 * Test workspace configuration for E2E tests
 */

export const TEST_WORKSPACE_CONFIG = {
  /**
   * Expected workspace structure for E2E tests
   */
  expectedFiles: [
    "src/components/UserProfile.ts",
    "src/services/ApiService.ts", 
    "src/utils/helpers.ts",
    "example.ts",
  ],

  /**
   * Expected symbols in test files
   */
  expectedSymbols: {
    "src/components/UserProfile.ts": [
      "UserProfile",
      "render",
      "updateProfile", 
      "getUserId",
    ],
    "src/services/ApiService.ts": [
      "ApiService",
      "fetchData",
      "postData",
      "setApiKey",
    ],
    "src/utils/helpers.ts": [
      "formatDate",
      "debounce",
      "generateId",
      "deepClone",
      "isValidEmail",
    ],
    "example.ts": [
      "TestClass",
      "testMethod",
      "testFunction",
    ],
  },

  /**
   * Test timeouts for different operations
   */
  timeouts: {
    connection: 10000,      // MockMiroClient connection
    navigation: 15000,      // Card navigation
    fileOpen: 10000,        // File opening
    symbolPosition: 5000,   // Cursor positioning at symbol
    cleanup: 10000,         // Test cleanup
  },

  /**
   * Performance benchmarks
   */
  performance: {
    maxNavigationTime: 10000,  // Maximum acceptable navigation time
    maxMemoryUsage: 100 * 1024 * 1024, // 100MB max memory usage
  },
} as const;

/**
 * Validate that the test workspace has the expected structure
 */
export async function validateTestWorkspace(): Promise<{
  valid: boolean;
  missingFiles: string[];
  errors: string[];
}> {
  const missingFiles: string[] = [];
  const errors: string[] = [];

  try {
    const vscode = await import("vscode");
    
    // Check workspace folders
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      errors.push("No workspace folders found");
      return { valid: false, missingFiles, errors };
    }

    // Check each expected file
    for (const filePath of TEST_WORKSPACE_CONFIG.expectedFiles) {
      try {
        const uri = vscode.Uri.joinPath(workspaceFolders[0].uri, filePath);
        await vscode.workspace.fs.stat(uri);
      } catch {
        missingFiles.push(filePath);
      }
    }

    if (missingFiles.length > 0) {
      errors.push(`Missing test files: ${missingFiles.join(", ")}`);
    }

  } catch (error) {
    errors.push(`Workspace validation error: ${error instanceof Error ? error.message : String(error)}`);
  }

  return {
    valid: missingFiles.length === 0 && errors.length === 0,
    missingFiles,
    errors,
  };
}
