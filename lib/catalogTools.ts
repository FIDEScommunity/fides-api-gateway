/**
 * Aggregates all FIDES catalog MCP tools into one registration entry point.
 * See docs/MCP-IMPLEMENTATION-PLAN.md.
 */

import type { ToolServer } from "./catalogClient";
import { registerWalletTools } from "./walletTools";
import { registerCredentialTools } from "./credentialTools";
import { registerOrganizationTools } from "./organizationTools";
import { registerIssuerTools } from "./issuerTools";
import { registerRpTools } from "./rpTools";
import { registerGenericTools } from "./genericTools";
import { registerVocabularyTools } from "./vocabularyTools";
import { isSiteContentEnabled, registerSiteTools } from "./siteTools";

export function registerAllTools(server: ToolServer): void {
  // Catalog-specific tools (rich, typed filters).
  registerWalletTools(server);
  registerCredentialTools(server);
  registerOrganizationTools(server);
  registerIssuerTools(server);
  registerRpTools(server);
  // Generic federated search/fetch (ChatGPT connector / Deep Research shape).
  registerGenericTools(server);
  // Shared vocabulary/glossary lookups (definitions behind the catalog terms).
  registerVocabularyTools(server);
  // Optional WordPress site-content search for conceptual questions.
  // Kill switch: CHAT_SITE_CONTENT_ENABLED=0 removes this tool entirely.
  if (isSiteContentEnabled()) {
    registerSiteTools(server);
  }
}
