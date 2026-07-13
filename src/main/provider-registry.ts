export {
  PROVIDER_BASE_URLS,
  canonicalProviderBaseUrl,
} from "../shared/provider-catalog";

/**
 * Look up the canonical inference base URL for a built-in provider id.
 * Returns null when the provider isn't in the registry (e.g. `custom`,
 * `auto`, or anything user-defined).
 */
