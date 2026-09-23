export type RegionShape = { code: string; name: string; d: string };

export type RegionGeometry = {
  countryCode: string;
  countryName: string;
  viewBox: string;
  outline: string;
  regions: RegionShape[];
  source: string;
};
