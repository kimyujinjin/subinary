import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { FamilyApiClient } from '../api-client';
import { registerFinanceSummary } from './finance-summary';
import { registerFinanceReview } from './finance-review';
import type { McpConfig } from '../config';
import { registerMemoryForget } from './memory-forget';
import { registerMemoryRead } from './memory-read';
import { registerMemoryRemember } from './memory-remember';
import { registerMemorySearch } from './memory-search';
import { registerMemoryTimeline } from './memory-timeline';

/**
 * Register all six Family Memory tools (Phase 10 spec §1/§2.4) on the server.
 * Each tool calls the existing HTTP API via {@link FamilyApiClient}; ownership
 * and provenance are enforced/returned by the API.
 */
export function registerAllTools(
  server: McpServer,
  client: FamilyApiClient,
  mode: McpConfig['toolMode'] = 'finance-readonly',
): void {
  registerFinanceSummary(server, client);
  registerFinanceReview(server, client, mode === 'finance-review');
  if (mode !== 'all') return;
  registerMemorySearch(server, client);
  registerMemoryRead(server, client);
  registerMemoryRemember(server, client);
  registerMemoryForget(server, client);
  registerMemoryTimeline(server, client);
}
