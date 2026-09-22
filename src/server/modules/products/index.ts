export {
  archiveProductCommand,
  createProductCommand,
  getProductQuery,
  listProductsQuery,
  listDashboardProductsQuery,
  updateProductMetadataCommand,
} from "./product.service";
export type { ProductContextRow } from "./product.service";
export { createProductInputSchema, productIdSchema, updateProductMetadataInputSchema } from "./product.schemas";
export type { CreateProductInput, UpdateProductMetadataInput } from "./product.schemas";
