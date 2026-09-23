export const marketContextCalibrationFixtures = [
  { name: "toward scanned product", body: "We are leaving Jira and moving to Linear.", expectedDirection: "toward_product", expectedTarget: "Linear" },
  { name: "away from scanned product", body: "We are leaving Linear and moving to Orbit.", repository: "acme/orbit", expectedDirection: "away_from_product", expectedTarget: "Orbit" },
  { name: "third-party importer", body: "Orbit needs import for users coming from Jira or Linear.", repository: "acme/orbit", expectedDirection: "contextual", expectedTarget: "Orbit" },
  { name: "host Jira alternative", body: "Awesome Product X, best Jira alternative.", repository: "acme/product-x", expectedDirection: "contextual", expectedTarget: "Product-x" },
  { name: "category demand", body: "We need a Jira alternative for our engineering team.", expectedDirection: "toward_category" },
  { name: "implementation only", body: "We need alternative OAuth authentication for Jira.", expectedTargetType: "implementation" },
  { name: "competitive loss", body: "Linear is too expensive; we're evaluating Plane.", expectedDirection: "away_from_product", expectedTarget: "Plane" },
  { name: "direct feature demand", body: "Does Linear support feature X?", expectedDirection: "toward_product", expectedTarget: "Linear" },
  { name: "generic article", body: "Project management teams use planning boards to coordinate work.", expectedDirection: "unknown" },
  { name: "promotional comparison", body: "Best Jira alternative: sign up for a free demo and use our discount code.", promotional: true },
] as const;
