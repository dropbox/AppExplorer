import { defineConfig } from 'vite'

export default defineConfig({
  define: {
    'process.env.NODE_ENV': JSON.stringify("production"),

  },
  build: {
    lib: {
      entry: {
        extension: 'src/extension.ts',
        miro: 'index.html',
      },
      formats: ['cjs']
    },
    rollupOptions: {
      external: [
        'child_process',
        'crypto',
        'events',
        'fs',
        'http',
        'https',
        'net',
        'path',
        'querystring',
        'stream',
        'timers',
        'tls',
        'url',
        'util',
        'vscode',
        'ws',
        'zlib',
      ]
    },
  }
  
})