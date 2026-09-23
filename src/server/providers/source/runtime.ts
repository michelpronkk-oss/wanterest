export type SourceRuntimeConfiguration = {
  sourceKey: string;
  configured: boolean;
  reason: string;
};

const present = (value: string | undefined): boolean => Boolean(value?.trim());

export function getSourceRuntimeConfiguration(sourceKey: string): SourceRuntimeConfiguration {
  switch (sourceKey) {
    case "product-hunt":
      return process.env.PRODUCT_HUNT_API_TOKEN?.trim()
        ? { sourceKey, configured: true, reason: "server_token_configured" }
        : { sourceKey, configured: false, reason: "credentials_missing" };
    case "stack-exchange":
      return { sourceKey, configured: true, reason: present(process.env.STACK_EXCHANGE_API_KEY) ? "request_key_configured" : "public_api_access" };
    case "public-web":
      return { sourceKey, configured: true, reason: "safe_url_fetcher_available" };
    case "g2":
      return process.env.G2_API_KEY?.trim()
        ? { sourceKey, configured: true, reason: "approved_api_token_configured" }
        : { sourceKey, configured: false, reason: "approved_api_token_missing" };
    case "trustpilot":
      return process.env.TRUSTPILOT_API_KEY?.trim() && process.env.TRUSTPILOT_BUSINESS_UNIT_ID?.trim()
        ? { sourceKey, configured: true, reason: "api_key_and_business_unit_configured" }
        : { sourceKey, configured: false, reason: "missing_credentials" };
    case "youtube":
      return present(process.env.YOUTUBE_API_KEY)
        ? { sourceKey, configured: true, reason: "api_key_configured" }
        : { sourceKey, configured: false, reason: "missing_credentials" };
    case "gitlab":
      return present(process.env.GITLAB_TOKEN)
        ? { sourceKey, configured: true, reason: "token_configured" }
        : { sourceKey, configured: false, reason: "missing_credentials" };
    default:
      return { sourceKey, configured: true, reason: "provider_available" };
  }
}

export const sourceRuntimeConfigurations = [
  "fixture",
  "hacker-news",
  "bluesky",
  "reddit",
  "github",
  "x",
  "product-hunt",
  "stack-exchange",
  "public-web",
  "g2",
  "trustpilot",
  "youtube",
  "gitlab",
].map(getSourceRuntimeConfiguration);
