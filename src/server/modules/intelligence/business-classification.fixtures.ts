import type { BusinessClassificationInput } from "./business-classification.engines";
import type { BusinessType, BusinessModel, MarketScope } from "./business-classification.schemas";

export type BusinessClassificationFixture = {
  name: string;
  input: BusinessClassificationInput;
  expected: {
    business_type: BusinessType;
    business_model: BusinessModel;
    market_scope: MarketScope;
    primary_category: string;
  };
};

export const businessClassificationFixtures: BusinessClassificationFixture[] = [
  {
    name: "B2B CRM SaaS",
    input: { productName: "Pipeline CRM", websiteUrl: "https://pipeline.example", snapshotText: "B2B CRM software for sales teams and businesses. Monthly subscription for workflow automation.", sourceReference: "fixture:b2b-crm" },
    expected: { business_type: "b2b_saas", business_model: "b2b", market_scope: "unknown", primary_category: "crm" },
  },
  {
    name: "developer tool",
    input: { productName: "Deploy CLI", websiteUrl: "https://deploy.example", snapshotText: "A developer platform with an API, SDK, and CLI for software engineers and technical teams.", sourceReference: "fixture:developer-tool" },
    expected: { business_type: "developer_tool", business_model: "b2b", market_scope: "unknown", primary_category: "developer tools" },
  },
  {
    name: "consumer app",
    input: { productName: "Stride", websiteUrl: "https://stride.example", snapshotText: "A mobile fitness app for individuals and consumers with a personal running plan.", sourceReference: "fixture:consumer-app" },
    expected: { business_type: "consumer_software", business_model: "b2c", market_scope: "unknown", primary_category: "unknown" },
  },
  {
    name: "ecommerce shoes",
    input: { productName: "Northstar Running", websiteUrl: "https://northstar.example", snapshotText: "Shop running shoes online. Add to cart, checkout, and shipping across the country.", sourceReference: "fixture:ecommerce" },
    expected: { business_type: "ecommerce", business_model: "b2c", market_scope: "unknown", primary_category: "running shoes" },
  },
  {
    name: "marketplace",
    input: { productName: "ProviderHub", websiteUrl: "https://providerhub.example", snapshotText: "A marketplace connecting buyers and service providers so customers can book services.", sourceReference: "fixture:marketplace" },
    expected: { business_type: "marketplace", business_model: "unknown", market_scope: "unknown", primary_category: "marketplace" },
  },
  {
    name: "agency",
    input: { productName: "Bright Studio", websiteUrl: "https://bright.example", snapshotText: "A creative agency delivering marketing and design services for clients.", sourceReference: "fixture:agency" },
    expected: { business_type: "agency", business_model: "unknown", market_scope: "unknown", primary_category: "performance marketing" },
  },
  {
    name: "professional service",
    input: { productName: "Ledger Partners", websiteUrl: "https://ledger.example", snapshotText: "Professional accounting and consulting services for growing companies.", sourceReference: "fixture:service" },
    expected: { business_type: "service_business", business_model: "b2b", market_scope: "unknown", primary_category: "professional services" },
  },
  {
    name: "local dentist",
    input: { productName: "Hoorn Dental", websiteUrl: "https://hoorn-dental.example", snapshotText: "A dentist and dental clinic serving Hoorn and nearby local customers.", sourceReference: "fixture:dentist" },
    expected: { business_type: "local_business", business_model: "b2c", market_scope: "local", primary_category: "dentistry" },
  },
  {
    name: "local restaurant",
    input: { productName: "Canal Cafe", websiteUrl: "https://canal-cafe.example", snapshotText: "A neighborhood restaurant serving local residents in Hoorn.", sourceReference: "fixture:restaurant" },
    expected: { business_type: "local_business", business_model: "b2c", market_scope: "local", primary_category: "restaurant" },
  },
  {
    name: "global SaaS with office",
    input: { productName: "Atlas Cloud", websiteUrl: "https://atlas.example", snapshotText: "Global B2B SaaS software for teams worldwide. The company has a physical office in Amsterdam, Netherlands.", sourceReference: "fixture:global-saas-office" },
    expected: { business_type: "b2b_saas", business_model: "b2b", market_scope: "global", primary_category: "unknown" },
  },
  {
    name: "ambiguous",
    input: { productName: "Nimbus", websiteUrl: "https://nimbus.example", snapshotText: "A new product.", sourceReference: "fixture:ambiguous" },
    expected: { business_type: "other", business_model: "unknown", market_scope: "unknown", primary_category: "unknown" },
  },
  {
    name: "mixed software and consumer",
    input: { productName: "TeamFit", websiteUrl: "https://teamfit.example", snapshotText: "Software for businesses and consumers: a fitness app used by company teams and individual users.", sourceReference: "fixture:mixed" },
    expected: { business_type: "consumer_software", business_model: "b2b2c", market_scope: "unknown", primary_category: "unknown" },
  },
];
