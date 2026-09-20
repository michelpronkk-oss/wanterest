export {
  archiveProductCommand,
  createProductCommand,
  getProductQuery,
  listProductsQuery,
  updateProductMetadataCommand,
} from "./product.service";
export { createProductInputSchema, productIdSchema, updateProductMetadataInputSchema } from "./product.schemas";
export type { CreateProductInput, UpdateProductMetadataInput } from "./product.schemas";
