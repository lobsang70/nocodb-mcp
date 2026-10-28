# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

- **Build**: `npm run build` - Compiles TypeScript to JavaScript in dist/
- **Development**: `npm run dev` - Runs server with hot-reloading using tsx
- **Lint**: `npm run lint` - Run ESLint on TypeScript files
- **Format**: `npm run format` - Format code with Prettier
- **Start**: `npm start` - Run compiled server from dist/index.js
- **Test**: `npm test` - Build and run isolated Jest tests in test/unit/

## Architecture Overview

This is an MCP (Model Context Protocol) server that provides a standardized interface to NocoDB. The architecture follows these patterns:

1. **Tool-Based Organization**: Each category of NocoDB operations is organized into separate tool modules in `src/tools/`:
   - `database.ts` - Base/database operations
   - `table.ts` - Table management
   - `record.ts` - CRUD operations
   - `query.ts` - Query and aggregation
   - `view.ts` - View management
   - `attachment.ts` - File upload/attachment

2. **Client Abstraction**: The `NocoDBClient` class in `src/nocodb-api.ts` encapsulates all API interactions. Key features:
   - Dynamic table name to ID resolution
   - Support for both API tokens and auth tokens
   - Consistent error handling with `NocoDBError`
   - Client-side aggregation/grouping operations

3. **MCP Server Setup**: The main entry point `src/index.ts` sets up the MCP server using stdio transport and registers all tools from the tool modules.

4. **Type Safety**: All data structures are defined in `src/types.ts` with comprehensive TypeScript interfaces.

## Key Implementation Notes

- **Table ID Resolution**: NocoDB API requires table IDs, but the client automatically resolves table names to IDs
- **Client-Side Operations**: Aggregation and grouping are implemented client-side for compatibility
- **File Uploads**: Supports both local file paths and URLs through FormData
- **Environment Configuration**: Requires `NOCODB_BASE_URL` and either `NOCODB_API_TOKEN` or `NOCODB_AUTH_TOKEN`

## Testing Approach

`npm test` builds the project and runs `test/unit/**/*.test.js` with Jest.
The HTTP adapter is mocked; the tests need no server or credentials. Keep manual
integration scripts in `test/` excluded from the automated suite. Add assertions
for resulting data and outgoing API requests, including pagination and errors.

## Publishing to NPM

Before publishing:
1. Ensure `dist/` is built with latest changes
2. Update version in package.json
3. Verify package.json has correct main/types entries
4. Consider adding `.npmignore` if needed
5. Ensure README.md is comprehensive for npm users