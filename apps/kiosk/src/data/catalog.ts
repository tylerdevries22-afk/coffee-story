/**
 * The kiosk's menu.
 *
 * Reads the pure model and stops there. Onboarding separately generates the
 * static menu-media map consumed by `KioskMenuImage`, which keeps this model
 * framework-free while giving the kiosk the exact offline WebPs the customer
 * app ships. Live-only items can still carry `menu_items.image_url`.
 */
export {
  CATALOG_ITEMS as MENU_ITEMS,
  MENU_CATEGORY_META,
  type CatalogItemData as MenuItem,
  type MenuCategoryId,
} from './catalog-data';
