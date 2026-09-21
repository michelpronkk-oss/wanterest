import type { DemandProfileV2Input } from "./demand-profile-v2.engines";

export type DemandProfileV2Fixture = {
  name: string;
  input: DemandProfileV2Input;
  expectations: {
    minimumPainCount?: number;
    minimumOutcomeCount?: number;
    minimumJobCount?: number;
    minimumAlternativeCount?: number;
    requiresCompetitor?: string;
    forbidsCompetitors?: boolean;
  };
};

export const demandProfileV2Fixtures: DemandProfileV2Fixture[] = [
  {
    name: "B2B CRM SaaS",
    input: { productName: "Pipeline CRM", websiteUrl: "https://pipeline.example", snapshotText: "B2B CRM software for small sales teams. Reduce onboarding time, centralize fragmented workflows, and support approval workflows. Teams need a simple CRM instead of spreadsheets.", sourceReference: "fixture:v2:b2b-crm" },
    expectations: { minimumOutcomeCount: 2, minimumJobCount: 1, minimumAlternativeCount: 1 },
  },
  {
    name: "developer tool",
    input: { productName: "Deploy CLI", websiteUrl: "https://deploy.example", snapshotText: "A developer platform with an API, SDK, and SSO for software engineers. Manage engineering work without heavyweight project-management overhead and ship faster.", sourceReference: "fixture:v2:developer" },
    expectations: { minimumOutcomeCount: 1, minimumJobCount: 1 },
  },
  {
    name: "consumer app",
    input: { productName: "Stride", websiteUrl: "https://stride.example", snapshotText: "A mobile fitness app for individual consumers looking for a personal running plan and a recommendation.", sourceReference: "fixture:v2:consumer" },
    expectations: { minimumJobCount: 0 },
  },
  {
    name: "ecommerce running-shoe brand",
    input: { productName: "Northstar Running", websiteUrl: "https://northstar.example", snapshotText: "Shop running shoes online for wide feet and long-distance training. Customers want wide sizing, faster delivery, and clear shipping cost before checkout.", sourceReference: "fixture:v2:ecommerce" },
    expectations: { minimumJobCount: 1, minimumOutcomeCount: 1 },
  },
  {
    name: "marketplace",
    input: { productName: "ProviderHub", websiteUrl: "https://providerhub.example", snapshotText: "A marketplace connecting buyers and service providers. Compare providers and book the right service instead of doing nothing.", sourceReference: "fixture:v2:marketplace" },
    expectations: { minimumAlternativeCount: 1 },
  },
  {
    name: "agency",
    input: { productName: "Bright Studio", websiteUrl: "https://bright.example", snapshotText: "A creative agency delivering marketing and design services for clients. Prospects compare agencies and freelancers when they need help.", sourceReference: "fixture:v2:agency" },
    expectations: { minimumAlternativeCount: 1 },
  },
  {
    name: "generic service business",
    input: { productName: "Ledger Partners", websiteUrl: "https://ledger.example", snapshotText: "Professional accounting and consulting services for growing companies. Recommend a service provider that can lower support workload.", sourceReference: "fixture:v2:service" },
    expectations: { minimumOutcomeCount: 1 },
  },
  {
    name: "local dentist",
    input: { productName: "Hoorn Dental", websiteUrl: "https://hoorn-dental.example", snapshotText: "A dentist and dental clinic serving Hoorn and nearby local customers. Patients want a recommendation near me.", sourceReference: "fixture:v2:dentist" },
    expectations: { minimumOutcomeCount: 0 },
  },
  {
    name: "global SaaS with local HQ",
    input: { productName: "Atlas Cloud", websiteUrl: "https://atlas.example", snapshotText: "Global B2B SaaS software for teams worldwide with a physical office in Amsterdam, Netherlands. The product helps teams centralize workflows.", sourceReference: "fixture:v2:global-saas" },
    expectations: { minimumOutcomeCount: 1 },
  },
  {
    name: "explicit competitor page",
    input: { productName: "SimpleCRM", websiteUrl: "https://simplecrm.example/compare", snapshotText: "An explicit comparison page: SimpleCRM is an alternative to Salesforce for small teams. Migrate from Salesforce without migration pain.", sourceReference: "fixture:v2:explicit-competitor" },
    expectations: { requiresCompetitor: "Salesforce" },
  },
  {
    name: "alternative to page",
    input: { productName: "InboxLite", websiteUrl: "https://inboxlite.example/alternative", snapshotText: "Looking for an alternative to Intercom? Replace Intercom with a simpler support workflow and avoid tool switching.", sourceReference: "fixture:v2:alternative-page" },
    expectations: { requiresCompetitor: "Intercom" },
  },
  {
    name: "integration partners and customer logos",
    input: { productName: "ConnectFlow", websiteUrl: "https://connectflow.example", snapshotText: "Integrates with Slack and Notion. Trusted by Acme and Globex customer logos. API access helps teams connect their workflow.", sourceReference: "fixture:v2:partners" },
    expectations: { forbidsCompetitors: true },
  },
  {
    name: "manual process alternative",
    input: { productName: "OpsBoard", websiteUrl: "https://opsboard.example", snapshotText: "Replace manual data entry and spreadsheet workflows. Teams can build it in-house, hire a freelancer, or keep doing nothing.", sourceReference: "fixture:v2:manual-alternatives" },
    expectations: { minimumPainCount: 1, minimumAlternativeCount: 4 },
  },
  {
    name: "ambiguous minimal landing page",
    input: { productName: "Nimbus", websiteUrl: "https://nimbus.example", snapshotText: "A new product.", sourceReference: "fixture:v2:ambiguous" },
    expectations: {},
  },
  {
    name: "mixed business model",
    input: { productName: "TeamFit", websiteUrl: "https://teamfit.example", snapshotText: "Software for businesses and consumers: a fitness app used by company teams and individual users. Need team permissions and a simple recommendation.", sourceReference: "fixture:v2:mixed" },
    expectations: { minimumJobCount: 0 },
  },
];
