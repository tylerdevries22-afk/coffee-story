/**
 * The kiosk's menu.
 *
 * Reads the pure model and stops there. The other two apps zip bundled
 * photography onto each item, which means shipping ~60 webp files inside the
 * binary; a third copy of those is duplication with no upside, and the schema
 * already carries `menu_items.image_url` for imagery that should come from the
 * server anyway. When the kiosk moves off this compiled catalog (C1) it gets
 * the images with the rows.
 */
export {
  CATALOG_ITEMS as MENU_ITEMS,
  MENU_CATEGORY_META,
  type CatalogItemData as MenuItem,
  type MenuCategoryId,
} from './catalog-data';
